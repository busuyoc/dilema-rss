local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager       = require("ui/uimanager")
local logger          = require("logger")

local BASE_URL    = "https://busuyoc.github.io/dilema-rss/"
local CATALOG_URL = BASE_URL .. "catalog.xml"
local BOOKS_DIR   = "/mnt/ext1/books/"

-- Each issue is saved under its dated filename (dilema-2026-W29.epub), never
-- overwriting a fixed path. KOReader keys cover thumbnails (bookinfo cache)
-- and reading progress (the .sdr sidecar) on the file path, so re-using one
-- path made every new issue inherit the previous issue's cover, title and
-- reading position. A dated file is a genuinely new book; "already have this
-- week" becomes a simple file-exists check and no .lastmod state is needed.

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

    local filename = table.concat(catalog_body)
        :match('href="(dilema%-%d%d%d%d%-W%d%d%.epub)"')
    if not filename then
        logger.warn("Dilema: no issue href found in catalog")
        return
    end

    local dest = BOOKS_DIR .. filename
    if fileExists(dest) then
        logger.info("Dilema: already have " .. filename)
        return
    end

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

    logger.info("Dilema: GET " .. tostring(dl_code))
    if dl_code ~= 200 then return end

    local data = table.concat(body)
    if #data < 1000 then
        logger.warn("Dilema: response too small (" .. #data .. " bytes)")
        return
    end

    local tmp = dest .. ".tmp"
    if not writeFile(tmp, data) then
        logger.warn("Dilema: write failed to " .. tmp)
        return
    end
    local renamed, rerr = os.rename(tmp, dest)
    if not renamed then
        logger.warn("Dilema: rename failed: " .. tostring(rerr))
        return
    end
    logger.info("Dilema: saved " .. #data .. " bytes -> " .. dest)
end

function Dilema:init()
    -- passive plugin: listens for RSSFetchComplete via the broadcast event below
end

function Dilema:onRSSFetchComplete()
    logger.info("Dilema: received RSSFetchComplete")
    UIManager:scheduleIn(0, sync)
end

return Dilema
