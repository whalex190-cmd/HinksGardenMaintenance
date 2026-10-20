#!/usr/bin/env node
/* Tiny static server for local preview: `npm run dev` -> http://localhost:8080
   (WebGL can't load textures from file://, so the PixiJS sprite layer needs http.) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".gif": "image/gif", ".ico": "image/x-icon",
};
const BLOCKED = /^\/(\.env|\.git|node_modules|assets-src\/raw)(\/|$)/;

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (BLOCKED.test(url)) { res.writeHead(404); res.end(); return; }
  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
