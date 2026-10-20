/* Shared pixel-art helpers for the scroll-hero pipeline (sprites.js, frames.js, preview.js).
   Images are handled as { w, h, data: Uint8Array RGBA } or index maps { w, h, idx: Int16Array } (-1 = transparent). */
"use strict";
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const ROOT = path.resolve(__dirname, "..", "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), "utf8").replace(/^﻿/, ""));
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

function readPng(f) {
  const p = PNG.sync.read(fs.readFileSync(path.resolve(ROOT, f)));
  return { w: p.width, h: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.length) };
}
function writePng(f, img) {
  const p = new PNG({ width: img.w, height: img.h });
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  ensureDir(path.dirname(path.resolve(ROOT, f)));
  fs.writeFileSync(path.resolve(ROOT, f), PNG.sync.write(p));
}

/* The x4 masters are exact 4x4 blocks: sample one pixel per block to get the native-grid image. */
function toNative(img, nw, nh) {
  const s = img.w / nw, out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const si = ((Math.floor(y * s + s / 2)) * img.w + Math.floor(x * s + s / 2)) * 4, o = (y * nw + x) * 4;
    out[o] = img.data[si]; out[o + 1] = img.data[si + 1]; out[o + 2] = img.data[si + 2]; out[o + 3] = 255;
  }
  return { w: nw, h: nh, data: out };
}

const dist2 = (r1, g1, b1, r2, g2, b2) => {      // "redmean" weighted RGB distance
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
};

/* Shared palette from the backgrounds: k-means plus the darkest and brightest colours. */
function buildPalette(images, size = 64) {
  const pts = [];
  for (const im of images) for (let i = 0; i < im.data.length; i += 4) pts.push([im.data[i], im.data[i + 1], im.data[i + 2]]);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sample = pts.length > 60000 ? Array.from({ length: 60000 }, () => pts[Math.floor(rnd() * pts.length)]) : pts;
  const cents = [sample[0].slice()];
  while (cents.length < size) {
    const d = sample.map((p) => Math.min(...cents.map((c) => dist2(p[0], p[1], p[2], c[0], c[1], c[2]))));
    let r = rnd() * d.reduce((a, b) => a + b, 0), i = 0;
    while (r > d[i] && i < d.length - 1) r -= d[i++];
    cents.push(sample[i].slice());
  }
  for (let it = 0; it < 10; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const p of sample) {
      let best = 0, bd = Infinity;
      cents.forEach((c, j) => { const dd = dist2(p[0], p[1], p[2], c[0], c[1], c[2]); if (dd < bd) { bd = dd; best = j; } });
      const a = acc[best]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    }
    acc.forEach((a, j) => { if (a[3]) cents[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const lum = (p) => 0.3 * p[0] + 0.6 * p[1] + 0.1 * p[2];
  const dark = pts.reduce((a, p) => (lum(p) < lum(a) ? p : a)), light = pts.reduce((a, p) => (lum(p) > lum(a) ? p : a));
  const pal = cents.map((c) => c.map(Math.round));
  for (const x of [dark, light]) if (Math.min(...pal.map((c) => dist2(...c, ...x))) > 900) pal.push(x.slice());
  return pal;
}

function makeSnapper(pal) {
  const cache = new Map();
  return (r, g, b) => {
    const k = (r << 16) | (g << 8) | b;
    let hit = cache.get(k);
    if (hit === undefined) {
      let bd = Infinity; hit = 0;
      pal.forEach((c, j) => { const dd = dist2(r, g, b, c[0], c[1], c[2]); if (dd < bd) { bd = dd; hit = j; } });
      cache.set(k, hit);
    }
    return hit;
  };
}

/* Key out #FF00FF (and the magenta fringe the model leaves), snap the rest to the palette. */
const isKey = (r, g, b) => (r - 255) ** 2 + g * g + (b - 255) ** 2 < 110 * 110 || (r > 150 && b > 150 && g < 0.6 * Math.min(r, b));
function keyAndSnap(img, snap) {
  const idx = new Int16Array(img.w * img.h);
  for (let p = 0, i = 0; p < idx.length; p++, i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    idx[p] = img.data[i + 3] < 128 || isKey(r, g, b) ? -1 : snap(r, g, b);
  }
  return { w: img.w, h: img.h, idx };
}

function bbox(m, x0 = 0, x1 = m.w) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < m.h; y++) for (let x = x0; x < x1; x++) if (m.idx[y * m.w + x] >= 0) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* Split a one-row sheet into n frames along empty columns (merging specks, splitting touching frames). */
function splitFrames(m, n) {
  const col = new Int32Array(m.w);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.idx[y * m.w + x] >= 0) col[x]++;
  let runs = [];
  for (let x = 0; x < m.w;) {
    if (col[x] <= 1) { x++; continue; }
    const s = x; let mass = 0;
    while (x < m.w && col[x] > 1) mass += col[x++];
    runs.push({ s, e: x, mass });
  }
  const maxMass = Math.max(0, ...runs.map((r) => r.mass));
  runs = runs.filter((r) => r.mass > maxMass * 0.02);
  while (runs.length > n) {
    let gi = 0, gmin = Infinity;
    for (let i = 0; i < runs.length - 1; i++) { const g = runs[i + 1].s - runs[i].e; if (g < gmin) { gmin = g; gi = i; } }
    runs.splice(gi, 2, { s: runs[gi].s, e: runs[gi + 1].e, mass: runs[gi].mass + runs[gi + 1].mass });
  }
  while (runs.length < n && runs.length) {
    let wi = 0; runs.forEach((r, i) => { if (r.e - r.s > runs[wi].e - runs[wi].s) wi = i; });
    const r = runs[wi];
    if (r.e - r.s < (m.w / n) * 1.3) break;
    const a = r.s + Math.floor((r.e - r.s) * 0.2), b = r.e - Math.floor((r.e - r.s) * 0.2);
    let cut = a; for (let x = a; x < b; x++) if (col[x] < col[cut]) cut = x;
    runs.splice(wi, 1, { s: r.s, e: cut, mass: 0 }, { s: cut + 1, e: r.e, mass: 0 });
  }
  if (runs.length === n) return { ranges: runs.map((r) => [r.s, r.e]), method: "gaps" };
  const cw = m.w / n;
  return { ranges: Array.from({ length: n }, (_, i) => [Math.round(i * cw), Math.round((i + 1) * cw)]), method: "equal-cells" };
}

/* Downscale a box of an index map by block majority (no blending, no new colours). */
function downscale(m, b, s, nColors) {
  const ow = Math.max(1, Math.round(b.w * s)), oh = Math.max(1, Math.round(b.h * s));
  const out = new Int16Array(ow * oh).fill(-1), counts = new Int32Array(nColors);
  for (let y = 0; y < oh; y++) {
    const sy0 = b.y + Math.floor((y * b.h) / oh), sy1 = Math.max(sy0 + 1, b.y + Math.floor(((y + 1) * b.h) / oh));
    for (let x = 0; x < ow; x++) {
      const sx0 = b.x + Math.floor((x * b.w) / ow), sx1 = Math.max(sx0 + 1, b.x + Math.floor(((x + 1) * b.w) / ow));
      counts.fill(0); let opaque = 0, total = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        total++; const v = m.idx[yy * m.w + xx];
        if (v >= 0) { counts[v]++; opaque++; }
      }
      if (opaque * 2 < total) continue;
      let best = 0; for (let j = 1; j < nColors; j++) if (counts[j] > counts[best]) best = j;
      out[y * ow + x] = best;
    }
  }
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {        // drop isolated pixels
    const i = y * ow + x; if (out[i] < 0) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
      const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < ow && yy < oh && out[yy * ow + xx] >= 0;
    }).length;
    if (nb === 0) out[i] = -1;
  }
  return { w: ow, h: oh, idx: out };
}

function trim(m) {
  const b = bbox(m);
  if (!b) return { w: 1, h: 1, idx: new Int16Array([-1]), ox: 0, oy: 0 };
  const out = new Int16Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out[y * b.w + x] = m.idx[(b.y + y) * m.w + b.x + x];
  return { w: b.w, h: b.h, idx: out };
}

/* Horizontal anchor: mean x of the upper 45% (head + torso), steadier than the bbox centre while legs move. */
function anchorX(m) {
  let sx = 0, n = 0;
  for (let y = 0; y < Math.max(1, Math.floor(m.h * 0.45)); y++) for (let x = 0; x < m.w; x++) if (m.idx[y * m.w + x] >= 0) { sx += x; n++; }
  return n ? sx / n : m.w / 2;
}

/* Index map -> RGBA using the palette. */
function idxToRgba(m, pal) {
  const out = new Uint8Array(m.w * m.h * 4);
  for (let i = 0; i < m.idx.length; i++) {
    const v = m.idx[i]; if (v < 0) continue;
    out[i * 4] = pal[v][0]; out[i * 4 + 1] = pal[v][1]; out[i * 4 + 2] = pal[v][2]; out[i * 4 + 3] = 255;
  }
  return { w: m.w, h: m.h, data: out };
}

/* Seeded RNG (mulberry32), so particles are identical on every render. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

module.exports = { ROOT, readJson, ensureDir, readPng, writePng, toNative, buildPalette, makeSnapper, keyAndSnap, bbox, splitFrames, downscale, trim, anchorX, idxToRgba, rng, dist2 };
