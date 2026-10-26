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

/* Each character has its own locked palette, extracted from its reference sheet (model-<name>) and saved to
   assets/sprites/palette-<name>.json. Every frame of that character is snapped to it. */
const charPals = new Map();
const isKey = (r, g, b) => (r - 255) ** 2 + g * g + (b - 255) ** 2 < 110 * 110 || (r > 150 && b > 150 && g < 0.6 * Math.min(r, b));
function charPalette(name, size = 16) {
  if (charPals.has(name)) return charPals.get(name);
  const out = path.join(px.ROOT, "assets", "sprites", `palette-${name}.json`);
  const model = cachedFile("model-" + name);
  if (!model) throw new Error(`model-${name} is not generated yet`);
  const ix = loadIndex().sheets["model-" + name] || {};
  let pal = null;
  if (fs.existsSync(out)) { const j = px.readJson(out); if (j.from === ix.file) pal = j.colors.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))); }
  if (!pal) {
    // magenta-key fringe pixels (dark purples too) never belong to a character
    const purple = (r, g, b) => r > g * 1.6 && b > g * 1.6 && Math.max(r, b) > 40;
    const img = px.readPng(model), keep = [];
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (img.data[i + 3] >= 128 && !isKey(r, g, b) && !purple(r, g, b)) keep.push(r, g, b, 255);
    }
    pal = px.buildPalette([{ w: keep.length / 4, h: 1, data: Uint8Array.from(keep) }], size).filter((c) => !purple(c[0], c[1], c[2]));
    fs.writeFileSync(out, JSON.stringify({ character: name, from: ix.file, colors: pal.map((c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("")) }, null, 1) + "\n");
  }
  charPals.set(name, pal);
  return pal;
}

/* A loaded sheet: keyed + snapped index map and one box per pose. Character sheets snap to the character's
   palette; props snap to the scene palette. `fidelity[i]` = share of a pose's raw pixels already within reach of
   that palette before snapping (low values mean the generation drifted in colour). */
const loaded = new Map();
function loadSheet(sheetDef, cfg) {
  if (loaded.has(sheetDef.id)) return loaded.get(sheetDef.id);
  const file = cachedFile(sheetDef.id);
  if (!file) return null;
  const pal = sheetDef.character ? charPalette(sheetDef.character) : palette(cfg);
  const raw = px.readPng(file);
  const m = px.keyAndSnap(raw, px.makeSnapper(pal));
  const n = sheetDef.poses.length;
  const { ranges, method } = px.splitFrames(m, n);
  const boxes = ranges.map(([a, b]) => px.bbox(m, a, b));
  if (boxes.some((b) => !b)) throw new Error(`${sheetDef.id}: an empty frame`);
  const fidelity = boxes.map((b) => {
    let ok = 0, all = 0;
    for (let y = b.y; y < b.y + b.h; y += 2) for (let x = b.x; x < b.x + b.w; x += 2) {
      const p = y * raw.w + x; if (m.idx[p] < 0) continue;
      const i = p * 4, r = raw.data[i], g = raw.data[i + 1], bl = raw.data[i + 2];
      all++; if (Math.min(...pal.map((c) => px.dist2(r, g, bl, c[0], c[1], c[2]))) < 2500) ok++;
    }
    return all ? ok / all : 0;
  });
  const sheet = { def: sheetDef, m, boxes, method, fidelity, tallest: Math.max(...boxes.map((b) => b.h)), sizes: new Map(), pal };
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
  f.pal = sheet.pal;
  sheet.sizes.set(key, f);
  return f;
}

module.exports = { CACHE, loadIndex, saveIndex, cachedFile, palette, charPalette, loadSheet, frame };
