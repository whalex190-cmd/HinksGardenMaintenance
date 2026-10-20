/* Loading generated sprite sheets from the cache and turning them into pixel-grid frames at any height.
   Used by sprites.js (QC at scale 1) and frames.js (perspective-scaled sizes, re-sampled from the raw image
   so a smaller figure is a clean redraw, not a nearest-neighbour squash). */
"use strict";
const fs = require("fs");
const path = require("path");
const px = require("./pixel");

const CACHE = path.join(px.ROOT, "assets", "cache");
const INDEX = path.join(CACHE, "index.json");
const loadIndex = () => (fs.existsSync(INDEX) ? px.readJson(INDEX) : { sheets: {}, calls: [] });
const saveIndex = (ix) => { px.ensureDir(CACHE); fs.writeFileSync(INDEX, JSON.stringify(ix, null, 2) + "\n"); };
const cachedFile = (id) => { const e = loadIndex().sheets[id]; return e && e.file && fs.existsSync(path.join(CACHE, e.file)) ? path.join(CACHE, e.file) : null; };

/* One palette for everything, from the native-grid backgrounds. */
let palCache = null;
function palette(cfg) {
  if (palCache) return palCache;
  const [nw, nh] = cfg.scene.native;
  palCache = px.buildPalette([px.toNative(px.readPng(cfg.scene.untidy), nw, nh), px.toNative(px.readPng(cfg.scene.tidy), nw, nh)], 64);
  return palCache;
}

/* A loaded sheet: keyed + snapped index map and one box per pose. */
const loaded = new Map();
function loadSheet(sheetDef, cfg) {
  if (loaded.has(sheetDef.id)) return loaded.get(sheetDef.id);
  const file = cachedFile(sheetDef.id);
  if (!file) return null;
  const pal = palette(cfg);
  const m = px.keyAndSnap(px.readPng(file), px.makeSnapper(pal));
  const n = sheetDef.poses.length;
  const { ranges, method } = px.splitFrames(m, n);
  const boxes = ranges.map(([a, b]) => px.bbox(m, a, b));
  if (boxes.some((b) => !b)) throw new Error(`${sheetDef.id}: an empty frame`);
  const sheet = { def: sheetDef, m, boxes, method, tallest: Math.max(...boxes.map((b) => b.h)), sizes: new Map(), pal };
  loaded.set(sheetDef.id, sheet);
  return sheet;
}

/* Pose `i` of a sheet with the sheet's tallest frame = `height` native px. Returns { w, h, idx, ax } where
   ax is the horizontal anchor (feet line = bottom row). Cached per (pose, height). */
function frame(sheet, i, height) {
  const key = i + "@" + height;
  if (sheet.sizes.has(key)) return sheet.sizes.get(key);
  const b = sheet.boxes[i], s = height / sheet.tallest;
  const f = px.trim(px.downscale(sheet.m, b, s, sheet.pal.length));
  f.ax = Math.round(px.anchorX(f));
  sheet.sizes.set(key, f);
  return f;
}

module.exports = { CACHE, loadIndex, saveIndex, cachedFile, palette, loadSheet, frame };
