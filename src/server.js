import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFilteredGoods, loadConfig } from "./lib/fetchGoods.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const cachePath = path.join(root, "data", "filtered-list.json");

let fetching = null;

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return null;
  }
}

async function getGoods(force = false) {
  if (!force) {
    const cached = readCache();
    if (cached?.list) return cached;
  }
  if (fetching) return fetching;
  fetching = fetchFilteredGoods(loadConfig())
    .finally(() => {
      fetching = null;
    });
  return fetching;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

const cfg = loadConfig();
const port = Number(cfg.port) || 3780;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/api/goods") {
    try {
      const force = url.searchParams.get("refresh") === "1";
      const data = await getGoods(force);
      sendJson(res, 200, data);
    } catch (err) {
      sendJson(res, 500, { error: err.message || String(err) });
    }
    return;
  }

  if (url.pathname === "/api/config") {
    sendJson(res, 200, {
      filters: cfg.filters,
      action: cfg.action,
      gameId: cfg.gameId,
      goodsCatalogueId: cfg.goodsCatalogueId,
    });
    return;
  }

  const filePath =
    url.pathname === "/"
      ? path.join(publicDir, "index.html")
      : path.join(publicDir, path.normalize(url.pathname).replace(/^[/\\]+/, ""));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  sendFile(res, filePath);
});

server.listen(port, () => {
  console.log(`数据页已启动: http://127.0.0.1:${port}`);
  console.log("筛选: QQ + 可二次实名 + 无封号");
});
