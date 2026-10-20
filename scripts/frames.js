#!/usr/bin/env node
/*
 * npm run frames                       composite every frame from assets/frames.json (no API calls)
 * npm run frames -- --only=mower       just these stations (others are left out of the picture)
 * npm run frames -- --from=10 --to=20  a frame range
 *
 * Output: assets/masters/frame_###.png (PNG masters) and public/frames/frame_###.webp (lossless), both on the
 * scene's native 480x272 grid; the website scales them up with smoothing off. Whole-pixel positions only.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const px = require("./lib/pixel");
const sh = require("./lib/sheets");

const cfg = px.readJson("assets/config.json");
const cat = px.readJson("assets/sprites.json");
const plan = px.readJson("assets/frames.json");
const regions = px.readJson(cfg.scene.regions);
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const STATIONS = typeof args.only === "string" ? args.only.split(",") : ["tree", "hedge", "mower", "planter"];
const [W, H] = cfg.scene.native;
const sheetDef = Object.fromEntries(cat.sheets.map((s) => [s.id, s]));
const pal = sh.palette(cfg);

const untidy = px.toNative(px.readPng(cfg.scene.untidy), W, H);
const tidy = px.toNative(px.readPng(cfg.scene.tidy), W, H);

/* ── geometry ── */
const L = regions.lawn;
const halfW = (y) => (L.halfNear * (y - L.vpY)) / (L.nearY - L.vpY);
const edgeX = (k, y) => L.vpX - halfW(y) + (2 * halfW(y) * k) / L.stripes;     // stripe edge k at scene-fraction y
const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const regionPts = (name) => { const d = regions.regions[name]; if (!d) return null; return d.rect ? [[d.rect[0], d.rect[1]], [d.rect[0] + d.rect[2], d.rect[1]], [d.rect[0] + d.rect[2], d.rect[1] + d.rect[3]], [d.rect[0], d.rect[1] + d.rect[3]]] : d.poly; };

/* Station-owned areas (tidied by their gardener, not by the global sweep). */
const M = cfg.mower;
const inMowerStripe = (fx, fy) => fy <= L.nearY + 0.004 && fy >= L.farY && fx >= edgeX(M.stripe, fy) && fx <= edgeX(M.stripe + 1, fy);
const owned = [
  (fx, fy) => inMowerStripe(fx, fy),
  (fx, fy) => { const p = regionPts("hedges-r"); return p && inPoly(fx, fy, p); },
  (fx, fy) => Math.abs(fx - (cfg.planter.x + 0.02)) < 0.045 && fy > cfg.planter.y - 0.04 && fy < cfg.planter.y + 0.012,
  (fx, fy) => { const p = regionPts("canopy-r"); return p && inPoly(fx, fy, p); },
];

/* ── background ── */
function background(fr) {
  const img = { w: W, h: H, data: new Uint8Array(untidy.data) };
  const put = (x, y, t) => {           // blend tidy over untidy at weight t (0..1), whole pixels only
    if (t <= 0) return;
    const i = (y * W + x) * 4;
    if (t >= 1) { img.data[i] = tidy.data[i]; img.data[i + 1] = tidy.data[i + 1]; img.data[i + 2] = tidy.data[i + 2]; return; }
    // dithered feather (keeps exact palette colours: no blended in-between colours)
    if (hash(x, y) < t) { img.data[i] = tidy.data[i]; img.data[i + 1] = tidy.data[i + 1]; img.data[i + 2] = tidy.data[i + 2]; }
  };
  // global front-to-back sweep over unowned areas
  const t = fr.scenery.tidyProgress.unassigned, feather = cfg.global.maskFeather;
  const topY = 0.12, frontY = topY + (1.02 - topY) * (1 - t);   // rows below frontY are tidy
  if (t > 0) for (let y = 0; y < H; y++) {
    const fy = (y + 0.5) / H, w = t >= 1 ? 1 : (fy * H - frontY * H) / feather + 0.5;
    if (w <= 0) continue;
    for (let x = 0; x < W; x++) { const fx = (x + 0.5) / W; if (!owned.some((o) => o(fx, fy))) put(x, y, Math.min(1, w)); }
  }
  // mower stripe: cut up to the mower's front edge, with a 1-2 px ragged cut line
  if (STATIONS.includes("mower") && fr.mower.props.cutStripe) {
    const cutY = fr.mower.props.cutStripe.cutFrontY;
    if (cutY !== undefined) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / W, fy = (y + 0.5) / H;
      if (!inMowerStripe(fx, fy)) continue;
      const rag = 1 + Math.floor(hash(x, 7) * 2);               // 1-2 px, fixed per column so the line doesn't flicker
      if (y >= cutY + rag) {
        put(x, y, 1);
        const i = (y * W + x) * 4, b = M.cutBrighten || 1;   // fresh cut reads a touch lighter
        img.data[i] = Math.min(255, img.data[i] * b); img.data[i + 1] = Math.min(255, img.data[i + 1] * b); img.data[i + 2] = Math.min(255, img.data[i + 2] * b);
      }
    }
  }
  if (t >= 1) for (let i = 0; i < img.data.length; i++) img.data[i] = tidy.data[i];   // fully tidy at the end
  return img;
}

/* ── drawing ── */
function blit(dst, f, x0, y0, alpha = 1) {     // f = index-map frame; (x0,y0) = its top-left
  for (let y = 0; y < f.h; y++) {
    const dy = y0 + y; if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < f.w; x++) {
      const dx = x0 + x; if (dx < 0 || dx >= W) continue;
      const v = f.idx[y * f.w + x]; if (v < 0) continue;
      if (alpha < 1 && hash(dx, dy) > alpha) continue;
      const i = (dy * W + dx) * 4; dst.data[i] = pal[v][0]; dst.data[i + 1] = pal[v][1]; dst.data[i + 2] = pal[v][2];
    }
  }
}
function placeSprite(dst, sheetId, poseIndex, heightPx, feetX, feetY, alpha = 1) {
  const sheet = sh.loadSheet(sheetDef[sheetId], cfg);
  if (!sheet) throw new Error(`sheet ${sheetId} is not generated yet (npm run sprites)`);
  const f = sh.frame(sheet, poseIndex, Math.max(4, heightPx));
  blit(dst, f, Math.round(feetX - f.ax), Math.round(feetY - f.h), alpha);
  return f;
}
function shadow(dst, cx, cy, rx, ry, strength) {        // darken an elliptical patch (dithered, stays crisp)
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x / rx) ** 2 + (y / ry) ** 2; if (d > 1) continue;
    const X = Math.round(cx + x), Y = Math.round(cy + y); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    if (hash(X, Y) > strength * (1.2 - d)) continue;
    const i = (Y * W + X) * 4; dst.data[i] = dst.data[i] * 0.62; dst.data[i + 1] = dst.data[i + 1] * 0.66; dst.data[i + 2] = dst.data[i + 2] * 0.6;
  }
}
function dot(dst, x, y, rgb) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; dst.data[i] = rgb[0]; dst.data[i + 1] = rgb[1]; dst.data[i + 2] = rgb[2]; }
const nearestPal = (rgb) => pal.reduce((b, c) => (px.dist2(...c, ...rgb) < px.dist2(...b, ...rgb) ? c : b));
const CLIP = [[143, 191, 74], [167, 211, 90], [111, 159, 58]].map(nearestPal);
const SMOKE = [[205, 205, 200], [170, 172, 168]].map(nearestPal);

/* ── the mower station ── */
function drawMower(img, fr, frIndex) {
  const m = fr.mower, fit = cfg.spriteFit.default, s = m.scale;
  const fx = m.x * W, fy = m.y * H;
  const manH = Math.round(fit * s), mowH = Math.round(cfg.spriteFit["prop-mower"] * s), ahead = Math.round(M.mowerAheadPx * s);
  const [shW, shH, shS] = M.shadow;
  // settled clippings lie on the cut stripe behind him; flying ones are drawn on top
  const flying = [];
  for (let k = 1; k <= frIndex; k++) {
    const p = plan.frames[k - 1].mower;
    if (!p.props.clippings) continue;
    const r = px.rng(cfg.ambient.seed * 31 + k), n = M.clippingsPerStep[0] + Math.floor(r() * (M.clippingsPerStep[1] - M.clippingsPerStep[0] + 1));
    const sx = p.x * W, sy = p.y * H - Math.round(M.mowerAheadPx * p.scale);
    for (let j = 0; j < n; j++) {
      const side = r() < 0.5 ? -1 : 1, life = cfg.particles.clippingLife;
      const vx = side * (0.6 + r() * 0.9), vy = -(0.8 + r() * 0.8), land = 2 + r() * 6;
      const age = frIndex - k;
      const c = CLIP[Math.floor(r() * CLIP.length)];
      if (age >= life) { if (age < life + 40) dot(img, sx + side * 2 + vx * life * 0.5, Math.min(sy + land, L.nearY * H - 1), c); continue; }   // settled on the lawn (fades after 40 frames)
      const tt = age / life;
      flying.push([sx + side * 3 + vx * age * 0.9, sy - 3 + vy * age + (land + 3) * tt * tt * 1.4, c]);
    }
  }
  shadow(img, fx, fy - ahead / 2, Math.round(shW * s / 2), Math.max(1, Math.round(shH * s / 2)), shS);
  const jit = m.props.jitterPx || 0;
  placeSprite(img, "prop-mower", m.props.mower.index, mowH, fx + jit, fy - ahead);
  // exhaust puff: grows and rises for 4 frames after each puff frame
  let lastPuff = -1;
  for (let k = frIndex; k >= Math.max(1, frIndex - 3); k--) if (plan.frames[k - 1].mower.props.exhaust) { lastPuff = k; break; }
  if (lastPuff > 0) {
    const age = frIndex - lastPuff, ex = fx + jit + Math.round(3 * s), ey = fy - ahead - mowH + Math.round(6 * s) - age * 2;
    for (let j = 0; j <= age; j++) { dot(img, ex + j, ey - j, SMOKE[age > 1 ? 1 : 0]); dot(img, ex + j + 1, ey - j, SMOKE[1]); }
  }
  placeSprite(img, m.sheet, m.index, manH, fx, fy);
  for (const [x, y, c] of flying) dot(img, x, y, c);
}

/* ── main ── */
(async () => {
  for (const d of ["assets/masters", "public/frames"]) px.ensureDir(path.join(px.ROOT, d));
  // cut line: front edge of the mower deck = top of its deck (about 40% of the prop's height above its base)
  for (const fr of plan.frames) {
    const m = fr.mower, moving = fr.frame >= M.ranges.easeIn[0];
    m.props.cutStripe.cutFrontY = moving ? Math.round(m.y * H - M.mowerAheadPx * m.scale - cfg.spriteFit["prop-mower"] * m.scale * 0.4) : undefined;
  }
  const from = +args.from || 1, to = +args.to || plan.frameCount;
  const t0 = Date.now();
  for (let f = from; f <= to; f++) {
    const fr = plan.frames[f - 1];
    const img = background(fr);
    if (STATIONS.includes("mower")) drawMower(img, fr, f);
    const name = "frame_" + String(f).padStart(3, "0");
    px.writePng(`assets/masters/${name}.png`, img);
    await sharp(Buffer.from(img.data.buffer), { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true }).toFile(path.join(px.ROOT, "public", "frames", name + ".webp"));
  }
  const kb = fs.readdirSync(path.join(px.ROOT, "public", "frames")).reduce((a, f) => a + fs.statSync(path.join(px.ROOT, "public", "frames", f)).size, 0) / 1024;
  console.log(`Frames ${from}-${to} written (stations: ${STATIONS.join(", ")}) in ${((Date.now() - t0) / 1000).toFixed(1)} s. public/frames: ${(kb / 1024).toFixed(1)} MB`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
