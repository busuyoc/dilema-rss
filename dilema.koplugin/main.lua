local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager       = require("ui/uimanager")
local logger          = require("logger")

local BASE_URL    = "https://busuyoc.github.io/dilema-rss/"
local CATALOG_URL = BASE_URL .. "catalog.xml"
local BOOKS_DIR   = "/mnt/ext1/books/"

-- How many of the newest catalog entries to consider per sync. Only the first
-- was checked originally, which made any missed week permanent: when the Pages
-- deploy for 2026-08-06 failed, W32 never reached the device and the next
-- successful sync jumped straight to W33. Walking a few entries turns a failed
-- deploy or a skipped run into an issue that arrives late instead of never.
local MAX_ISSUES  = 4

-- Each issue is saved under its dated filename (dilema-2026-W29.epub), never
-- overwriting a fixed path. KOReader keys cover thumbnails (bookinfo cache)
-- and reading progress (the .sdr sidecar) on the file path, so re-using one
-- path made every new issue inherit the previous issue's cover, title and
-- reading position. A dated file is a genuinely new book, so freshness is a
-- question about names rather than about HTTP validators — the old
-- Last-Modified/.lastmod dance is gone.

local Dilema = WidgetContainer:extend{
    name = "dilema",
}

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

-- High-water mark: the newest issue this plugin has ever fetched. Kept because
-- "is the file on disk?" cannot tell "never had it" from "read it and deleted
-- it" — and issues do get deleted after reading. Without this, walking several
-- catalog entries would re-download books that were deliberately removed. The
-- marker only ever moves forward, so the plugin catches up on missed weeks but
-- never resurrects an issue you are done with.
--
-- Filenames sort correctly as plain strings: dilema-YYYY-Www.epub is fixed
-- width with a zero-padded week, so 2026-W09 < 2026-W33 < 2027-W01.
local function stateFile()
    local ok, DataStorage = pcall(require, "datastorage")
    if ok and DataStorage and DataStorage.getSettingsDir then
        return DataStorage:getSettingsDir() .. "/dilema_last_issue.txt"
    end
    return BOOKS_DIR .. ".dilema_last_issue"
end

local function readMark()
    local f = io.open(stateFile(), "r")
    if not f then return nil end
    local mark = f:read("*l")
    f:close()
    if mark and mark:match("^dilema%-%d%d%d%d%-W%d%d%.epub$") then return mark end
    return nil
end

local function writeMark(name)
    local f = io.open(stateFile(), "w")
    if not f then
        logger.warn("Dilema: could not write state file " .. stateFile())
        return
    end
    f:write(name, "\n")
    f:close()
end

-- Fetch one issue to its dated path. Written to a .tmp and renamed so a dropped
-- connection can never leave a truncated book at the real filename.
local function downloadIssue(https, ltn12, socketutil, filename, dest)
    local url = BASE_URL .. filename
    logger.info("Dilema: downloading " .. url)

    local body = {}
    socketutil:set_timeout(15, 60)
    local _, dl_code = https.request{
        url     = url,
        method  = "GET",
        sink    = ltn12.sink.table(body),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    socketutil:reset_timeout()

    logger.info("Dilema: GET " .. tostring(dl_code) .. " " .. filename)
    if dl_code ~= 200 then return false end

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

local function sync()
    logger.info("Dilema: sync starting")

    local ok1, https      = pcall(require, "ssl.https")
    local ok2, ltn12      = pcall(require, "ltn12")
    local ok3, socketutil = pcall(require, "socketutil")
    if not (ok1 and ok2 and ok3) then
        logger.warn("Dilema: missing ssl/ltn12/socketutil")
        return
    end

    -- The OPDS catalog lists issues newest-first; the first href is the
    -- current issue's real filename.
    local catalog_body = {}
    socketutil:set_timeout(8, 15)
    local _, cat_code = https.request{
        url     = CATALOG_URL,
        method  = "GET",
        sink    = ltn12.sink.table(catalog_body),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    socketutil:reset_timeout()

    logger.info("Dilema: catalog GET " .. tostring(cat_code))
    if cat_code ~= 200 then return end

    -- The catalog lists issues newest-first; consider the newest few.
    local newest = {}
    for name in table.concat(catalog_body):gmatch('href="(dilema%-%d%d%d%d%-W%d%d%.epub)"') do
        newest[#newest + 1] = name
        if #newest >= MAX_ISSUES then break end
    end
    if #newest == 0 then
        logger.warn("Dilema: no issue href found in catalog")
        return
    end

    -- Nothing fetched before (fresh install): take only the current issue
    -- rather than dumping the whole back catalogue onto the device.
    local mark = readMark()
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
        return
    end

    local fetched = 0
    for _, filename in ipairs(pending) do
        local dest = BOOKS_DIR .. filename
        if fileExists(dest) then
            logger.info("Dilema: already have " .. filename)
            writeMark(filename)
            fetched = fetched + 1
        elseif downloadIssue(https, ltn12, socketutil, filename, dest) then
            writeMark(filename)
            fetched = fetched + 1
        else
            -- Stop at the first failure so the mark never skips past an issue
            -- that was not actually saved; the next sync retries from here.
            logger.warn("Dilema: stopping at " .. filename .. ", will retry next sync")
            break
        end
    end

    logger.info(string.format("Dilema: sync done — %d of %d new issue(s) fetched, now at %s",
        fetched, #pending, tostring(readMark())))
end

function Dilema:init()
    -- passive plugin: listens for RSSFetchComplete via the broadcast event below
end

function Dilema:onRSSFetchComplete()
    logger.info("Dilema: received RSSFetchComplete")
    UIManager:scheduleIn(0, sync)
end

return Dilema
