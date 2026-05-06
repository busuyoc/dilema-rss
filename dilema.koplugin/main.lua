local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager       = require("ui/uimanager")
local logger          = require("logger")

local EPUB_URL   = "https://busuyoc.github.io/dilema-rss/dilema-latest.epub"
local DEST_FILE  = "/mnt/ext1/books/dilema-latest.epub"
local STATE_FILE = "/mnt/ext1/applications/koreader/plugins/dilema.koplugin/.lastmod"

local Dilema = WidgetContainer:extend{
    name = "dilema",
}

local function readFile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

local function writeFile(path, content)
    local f = io.open(path, "wb")
    if not f then return false end
    f:write(content)
    f:flush()
    f:close()
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

    socketutil:set_timeout(8, 15)
    local _, code, resp_headers = https.request{
        url     = EPUB_URL,
        method  = "HEAD",
        sink    = ltn12.sink.null(),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    socketutil:reset_timeout()

    logger.info("Dilema: HEAD " .. tostring(code))
    if code ~= 200 or not resp_headers then return end

    local lastmod = resp_headers["last-modified"] or ""
    if lastmod == "" then
        logger.warn("Dilema: no Last-Modified header")
        return
    end

    local stored = readFile(STATE_FILE) or ""
    local dest_f = io.open(DEST_FILE, "r")
    local dest_exists = dest_f ~= nil
    if dest_f then dest_f:close() end
    if stored == lastmod and dest_exists then
        logger.info("Dilema: already up to date")
        return
    end
    if not dest_exists then
        logger.info("Dilema: dest file missing, forcing download")
    end

    logger.info("Dilema: downloading " .. EPUB_URL)
    local body = {}
    socketutil:set_timeout(15, 60)
    local _, dl_code = https.request{
        url     = EPUB_URL,
        method  = "GET",
        sink    = ltn12.sink.table(body),
        headers = { ["User-Agent"] = "KOReader/dilema-sync" },
    }
    socketutil:reset_timeout()

    logger.info("Dilema: GET " .. tostring(dl_code))
    if dl_code ~= 200 then return end

    local data = table.concat(body)
    if #data < 1000 then
        logger.warn("Dilema: response too small (" .. #data .. " bytes)")
        return
    end

    local tmp = DEST_FILE .. ".tmp"
    if not writeFile(tmp, data) then
        logger.warn("Dilema: write failed to " .. tmp)
        return
    end
    local renamed, rerr = os.rename(tmp, DEST_FILE)
    if not renamed then
        logger.warn("Dilema: rename failed: " .. tostring(rerr))
        return
    end
    writeFile(STATE_FILE, lastmod)
    logger.info("Dilema: saved " .. #data .. " bytes -> " .. DEST_FILE)
end

function Dilema:init()
    -- passive plugin: listens for RSSFetchComplete via the broadcast event below
end

function Dilema:onRSSFetchComplete()
    logger.info("Dilema: received RSSFetchComplete")
    UIManager:scheduleIn(0, sync)
end

return Dilema
