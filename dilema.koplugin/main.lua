local ConfirmBox      = require("ui/widget/confirmbox")
local DataStorage     = require("datastorage")
local Dispatcher      = require("dispatcher")
local InfoMessage     = require("ui/widget/infomessage")
local LuaSettings     = require("luasettings")
local NetworkMgr      = require("ui/network/manager")
local Notification    = require("ui/widget/notification")
local UIManager       = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local lfs             = require("libs/libkoreader-lfs")
local logger          = require("logger")
local T               = require("ffi/util").template
local _               = require("gettext")

local BASE_URL    = "https://busuyoc.github.io/dilema-rss/"
local CATALOG_URL = BASE_URL .. "catalog.xml"
local BOOKS_DIR   = "/mnt/ext1/books/"

-- How many of the newest catalog entries to consider per sync. Only the first
-- was checked originally, which made any missed week permanent: when the Pages
-- deploy for 2026-08-06 failed, W32 never reached the device and the next
-- successful sync jumped straight to W33. Walking a few entries turns a failed
-- deploy or a skipped run into an issue that arrives late instead of never.
local MAX_ISSUES = 4

-- A background sync rides on NetworkConnected, which fires several times per
-- session. One attempt per this interval is plenty for a weekly magazine.
local BACKGROUND_INTERVAL = 6 * 60 * 60

-- Each issue is saved under its dated filename (dilema-2026-W33.epub), never
-- overwriting a fixed path. KOReader keys cover thumbnails (bookinfo cache)
-- and reading progress (the .sdr sidecar) on the file path, so re-using one
-- path made every new issue inherit the previous issue's cover, title and
-- reading position. A dated file is a genuinely new book, so freshness is a
-- question about names rather than about HTTP validators — the old
-- Last-Modified/.lastmod dance is gone.
--
-- Filenames sort correctly as plain strings: dilema-YYYY-Www.epub is fixed
-- width with a zero-padded week, so 2026-W09 < 2026-W33 < 2027-W01.
local ISSUE_PATTERN = "dilema%-%d%d%d%d%-W%d%d%.epub"

local Dilema = WidgetContainer:extend{
    name = "dilema",
    is_doc_only = false,
}

-- ---------------------------------------------------------------------------
-- state
-- ---------------------------------------------------------------------------

-- last_issue is a high-water mark: the newest issue ever fetched. It is kept
-- because "is the file on disk?" cannot tell "never had it" from "read it and
-- deleted it", and issues do get deleted after reading. Without it, walking
-- several catalog entries would re-download books that were deliberately
-- removed. The mark only moves forward, so a missed week still arrives late
-- while a finished one stays gone.
function Dilema:settings()
    if not self._settings then
        self._settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/dilema.lua")
    end
    return self._settings
end

function Dilema:mark()
    local m = self:settings():readSetting("last_issue")
    if type(m) == "string" and m:match("^" .. ISSUE_PATTERN .. "$") then return m end
    return nil
end

function Dilema:recordIssue(name)
    self:settings():saveSetting("last_issue", name)
    self:settings():flush()
end

function Dilema:recordSync(result)
    self:settings():saveSetting("last_sync_time", os.time())
    self:settings():saveSetting("last_sync_result", result)
    self:settings():flush()
end

-- ---------------------------------------------------------------------------
-- filesystem
-- ---------------------------------------------------------------------------

local function writeFile(path, content)
    local f = io.open(path, "wb")
    if not f then return false end
    f:write(content)
    f:flush()
    f:close()
    return true
end

local function fileExists(path)
    local f = io.open(path, "r")
    if f then f:close() return true end
    return false
end

-- Newest issue actually present on disk. Used for "open the latest issue" so
-- the action still works when the mark points at something since deleted.
local function newestOnDisk()
    local newest
    local ok, iter, dir_obj = pcall(lfs.dir, BOOKS_DIR)
    if not ok then return nil end
    for entry in iter, dir_obj do
        if entry:match("^" .. ISSUE_PATTERN .. "$") then
            if not newest or entry > newest then newest = entry end
        end
    end
    return newest
end

-- ---------------------------------------------------------------------------
-- network
-- ---------------------------------------------------------------------------

local function httpModules()
    local ok1, https      = pcall(require, "ssl.https")
    local ok2, ltn12      = pcall(require, "ltn12")
    local ok3, socketutil = pcall(require, "socketutil")
    if not (ok1 and ok2 and ok3) then
        logger.warn("Dilema: missing ssl/ltn12/socketutil")
        return nil
    end
    return { https = https, ltn12 = ltn12, socketutil = socketutil }
end

local function fetchCatalog(net)
    local body = {}
    net.socketutil:set_timeout(8, 15)
    local _unused, code = net.https.request{
        url     = CATALOG_URL,
        method  = "GET",
        sink    = net.ltn12.sink.table(body),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    net.socketutil:reset_timeout()

    logger.info("Dilema: catalog GET " .. tostring(code))
    if code ~= 200 then return nil, code end
    return table.concat(body)
end

-- Fetch one issue to its dated path. Written to a .tmp and renamed so a dropped
-- connection can never leave a truncated book at the real filename.
local function downloadIssue(net, filename, dest)
    local url = BASE_URL .. filename
    logger.info("Dilema: downloading " .. url)

    local body = {}
    net.socketutil:set_timeout(15, 60)
    local _unused, code = net.https.request{
        url     = url,
        method  = "GET",
        sink    = net.ltn12.sink.table(body),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    net.socketutil:reset_timeout()

    logger.info("Dilema: GET " .. tostring(code) .. " " .. filename)
    if code ~= 200 then return false end

    local data = table.concat(body)
    if #data < 1000 then
        logger.warn("Dilema: response too small (" .. #data .. " bytes) for " .. filename)
        return false
    end

    local tmp = dest .. ".tmp"
    if not writeFile(tmp, data) then
        logger.warn("Dilema: write failed to " .. tmp)
        return false
    end
    local renamed, rerr = os.rename(tmp, dest)
    if not renamed then
        logger.warn("Dilema: rename failed: " .. tostring(rerr))
        os.remove(tmp)
        return false
    end
    logger.info("Dilema: saved " .. #data .. " bytes -> " .. dest)
    return true
end

-- ---------------------------------------------------------------------------
-- sync — returns a result table, shows nothing itself
-- ---------------------------------------------------------------------------

function Dilema:performSync()
    logger.info("Dilema: sync starting")

    local net = httpModules()
    if not net then
        return { status = "error", message = _("Networking libraries are missing.") }
    end

    local catalog, code = fetchCatalog(net)
    if not catalog then
        return { status = "error", code = code,
                 message = _("Could not reach the Dilema catalogue.") }
    end

    -- The catalog lists issues newest-first; consider the newest few.
    local newest = {}
    for name in catalog:gmatch('href="(' .. ISSUE_PATTERN .. ')"') do
        newest[#newest + 1] = name
        if #newest >= MAX_ISSUES then break end
    end
    if #newest == 0 then
        logger.warn("Dilema: no issue href found in catalog")
        return { status = "error", message = _("The catalogue lists no issues.") }
    end

    -- Nothing fetched before (fresh install): take only the current issue
    -- rather than dumping the whole back catalogue onto the device.
    local mark = self:mark()
    if not mark then
        logger.info("Dilema: no sync history, starting from the current issue")
        newest = { newest[1] }
    end

    -- Oldest-first, so an interrupted sync still leaves the mark truthful.
    local pending = {}
    for i = #newest, 1, -1 do
        local name = newest[i]
        if not mark or name > mark then pending[#pending + 1] = name end
    end

    if #pending == 0 then
        logger.info("Dilema: up to date at " .. tostring(mark))
        return { status = "uptodate", newest = mark }
    end

    local fetched = {}
    for _i, filename in ipairs(pending) do
        local dest = BOOKS_DIR .. filename
        if fileExists(dest) then
            logger.info("Dilema: already have " .. filename)
            self:recordIssue(filename)
            fetched[#fetched + 1] = filename
        elseif downloadIssue(net, filename, dest) then
            self:recordIssue(filename)
            fetched[#fetched + 1] = filename
        else
            -- Stop at the first failure so the mark never skips past an issue
            -- that was not actually saved; the next sync retries from here.
            logger.warn("Dilema: stopping at " .. filename .. ", will retry next sync")
            break
        end
    end

    if #fetched == 0 then
        return { status = "error", message = _("The new issue could not be downloaded.") }
    end

    logger.info(string.format("Dilema: sync done — %d of %d fetched, now at %s",
        #fetched, #pending, tostring(self:mark())))
    return { status = "fetched", fetched = fetched, newest = fetched[#fetched] }
end

-- ---------------------------------------------------------------------------
-- presentation
-- ---------------------------------------------------------------------------

-- "dilema-2026-W33.epub" -> "2026-W33"
local function issueLabel(filename)
    return (filename or ""):match("(%d%d%d%d%-W%d%d)") or "?"
end

function Dilema:openIssue(filename)
    local path = BOOKS_DIR .. filename
    if not fileExists(path) then
        UIManager:show(InfoMessage:new{
            text = T(_("That issue is no longer on the device:\n%1"), path),
        })
        return
    end
    local ReaderUI = require("apps/reader/readerui")
    ReaderUI:showReader(path)
end

function Dilema:openLatest()
    local latest = newestOnDisk()
    if not latest then
        UIManager:show(InfoMessage:new{
            text = T(_("No Dilema issue on the device yet.\nFetch one first — they are saved in %1"), BOOKS_DIR),
        })
        return
    end
    self:openIssue(latest)
end

-- Every interactive run ends in a message that names the issue and says where
-- it landed: a button that appears to do nothing is indistinguishable from a
-- broken one, which is exactly how this failed silently for weeks.
function Dilema:report(result)
    if result.status == "fetched" then
        local label = issueLabel(result.newest)
        local text
        if #result.fetched > 1 then
            text = T(_("Fetched %1 issues, up to Dilema %2.\n\nSaved in %3"),
                #result.fetched, label, BOOKS_DIR)
        else
            text = T(_("Dilema %1 downloaded.\n\nSaved in %2"), label, BOOKS_DIR)
        end
        UIManager:show(ConfirmBox:new{
            text = text,
            ok_text = _("Read now"),
            ok_callback = function() self:openIssue(result.newest) end,
            cancel_text = _("Later"),
        })
    elseif result.status == "uptodate" then
        UIManager:show(ConfirmBox:new{
            text = T(_("No new issue — you already have Dilema %1.\n\nIssues are in %2"),
                issueLabel(result.newest), BOOKS_DIR),
            ok_text = _("Read it"),
            ok_callback = function() self:openIssue(result.newest) end,
            cancel_text = _("Close"),
        })
    else
        UIManager:show(InfoMessage:new{
            text = T(_("Dilema sync failed.\n\n%1"), result.message or _("Unknown error.")),
            icon = "notice-warning",
        })
    end
end

-- ---------------------------------------------------------------------------
-- entry points
-- ---------------------------------------------------------------------------

function Dilema:syncInteractive()
    NetworkMgr:runWhenOnline(function()
        local info = InfoMessage:new{ text = _("Checking for a new Dilema…"), timeout = 30 }
        UIManager:show(info)
        UIManager:nextTick(function()
            local result = self:performSync()
            UIManager:close(info)
            self:recordSync(result.status)
            self:report(result)
        end)
    end)
end

function Dilema:syncInBackground()
    local last = self:settings():readSetting("last_sync_time") or 0
    if os.time() - last < BACKGROUND_INTERVAL then
        logger.info("Dilema: background sync skipped (checked recently)")
        return
    end
    local result = self:performSync()
    self:recordSync(result.status)
    -- Quiet unless something actually arrived; a weekly magazine has nothing
    -- new on most days and a toast every time the wifi comes up is noise.
    if result.status == "fetched" then
        Notification:notify(T(_("Dilema %1 downloaded"), issueLabel(result.newest)))
    end
end

function Dilema:statusText()
    local when = self:settings():readSetting("last_sync_time")
    if not when then return _("Never synced") end
    local result = self:settings():readSetting("last_sync_result")
    local outcome = result == "fetched" and _("new issue")
        or result == "uptodate" and _("up to date")
        or _("failed")
    return T(_("Last sync: %1 (%2)"), os.date("%d %b, %H:%M", when), outcome)
end

-- ---------------------------------------------------------------------------
-- KOReader plumbing
-- ---------------------------------------------------------------------------

-- Registering with the Dispatcher is what makes these bindable to a gesture,
-- a profile or a hotkey — all stock KOReader. A launcher-style plugin (zenUI
-- and friends) can adopt the same action as a button, but nothing here depends
-- on one being installed.
function Dilema:onDispatcherRegisterActions()
    Dispatcher:registerAction("dilema_fetch",
        { category = "none", event = "DilemaFetch", title = _("Dilema: fetch new issue"), general = true })
    Dispatcher:registerAction("dilema_open",
        { category = "none", event = "DilemaOpen", title = _("Dilema: open latest issue"), general = true, separator = true })
end

function Dilema:init()
    self:onDispatcherRegisterActions()
    -- The plugin loads in both the file browser and the reader; only register
    -- where a menu exists, as the bundled plugins do.
    if self.ui and self.ui.menu and self.ui.menu.registerToMainMenu then
        self.ui.menu:registerToMainMenu(self)
    end
end

function Dilema:addToMainMenu(menu_items)
    menu_items.dilema = {
        text = _("Dilema"),
        sorting_hint = "tools",
        sub_item_table = {
            {
                text_func = function() return self:statusText() end,
                keep_menu_open = true,
                callback = function() end,
                separator = true,
            },
            {
                text = _("Fetch new issue"),
                keep_menu_open = false,
                callback = function() self:syncInteractive() end,
            },
            {
                text = _("Open latest issue"),
                keep_menu_open = false,
                callback = function() self:openLatest() end,
            },
        },
    }
end

function Dilema:onDilemaFetch()
    self:syncInteractive()
    return true
end

function Dilema:onDilemaOpen()
    self:openLatest()
    return true
end

-- Native KOReader event: no other plugin has to be patched for this to fire.
function Dilema:onNetworkConnected()
    logger.info("Dilema: NetworkConnected")
    UIManager:scheduleIn(2, function() self:syncInBackground() end)
end

-- Kept for continuity with the QuickRSS patch. Harmless if the patch is gone —
-- the event simply never fires, and the triggers above cover it.
function Dilema:onRSSFetchComplete()
    logger.info("Dilema: received RSSFetchComplete")
    UIManager:scheduleIn(0, function() self:syncInBackground() end)
end

return Dilema
