#!/usr/bin/env node
/*
 * npm run frames                          composite every frame from assets/frames.json (no API calls)
 * npm run frames -- --only=mower,planter  just these stations (others are left out of the picture)
 * npm run frames -- --from=10 --to=20     a frame range
 *
 * Output: assets/masters/frame_###.png (PNG masters) and public/frames/frame_###.webp (lossless), both on the
 * scene's native 480x272 grid; the website scales them up with smoothing off. Whole-pixel positions only.
 * Layers: background (untidy/tidy blend) -> ambient (clouds, wind, sun glow) -> stations back to front -> particles.
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
const K = W / 480;                      // grid factor: the pipeline was tuned on a 480x272 grid; hand-placed px distances scale by K
const sheetDef = Object.fromEntries(cat.sheets.map((s) => [s.id, s]));
const pal = sh.palette(cfg);
const A = cfg.ambient;

const untidy = px.toNative(px.readPng(cfg.scene.untidy), W, H);
const tidy = px.toNative(px.readPng(cfg.scene.tidy), W, H);

/* ── geometry ── */
const L = regions.lawn;
const halfW = (y) => (L.halfNear * (y - L.vpY)) / (L.nearY - L.vpY);
const edgeX = (k, y) => L.vpX - halfW(y) + (2 * halfW(y) * k) / L.stripes;     // stripe edge k at scene-fraction y
const persp = (y) => (y - L.vpY) / (cfg.mower.start.y - L.vpY);                 // figure scale at scene y (1 at the mower's start)
const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const regionPts = (name) => {
  if (name === "lawn") return [[edgeX(0, L.nearY), L.nearY], [edgeX(L.stripes, L.nearY), L.nearY], [edgeX(L.stripes, L.farY), L.farY], [edgeX(0, L.farY), L.farY]];
  const d = regions.regions[name]; if (!d) return null;
  return d.rect ? [[d.rect[0], d.rect[1]], [d.rect[0] + d.rect[2], d.rect[1]], [d.rect[0] + d.rect[2], d.rect[1] + d.rect[3]], [d.rect[0], d.rect[1] + d.rect[3]]] : d.poly;
};
const maskOf = (names) => {           // per-pixel boolean mask of named regions
  const polys = names.map(regionPts).filter(Boolean), m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (polys.some((p) => inPoly((x + 0.5) / W, (y + 0.5) / H, p))) m[y * W + x] = 1;
  return m;
};

/* Station-owned areas: tidied by their gardener, not by the global front-to-back sweep. */
const M = cfg.mower, P = cfg.planter, HG = cfg.hedge;
const inMowerStripe = (fx, fy) => fy <= L.nearY + 0.004 && fy >= L.farY && fx >= edgeX(M.stripe, fy) && fx <= edgeX(M.stripe + 1, fy);
const inHedgeTrim = (fx, fy) => fx >= HG.trim.x[0] && fx <= HG.trim.x[1] && fy >= HG.trim.top[0] && fy <= HG.trim.face[1];
const inPlanterArea = (fx, fy) => fx >= P.area[0] && fx <= P.area[2] && fy >= P.area[1] && fy <= P.area[3];
const owned = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = (x + 0.5) / W, fy = (y + 0.5) / H;
  // (the planter's patch is not owned: the lawn around him tidies with the sweep, his planting shows through the props)
  if ((STATIONS.includes("mower") && inMowerStripe(fx, fy)) || (STATIONS.includes("hedge") && inHedgeTrim(fx, fy))) owned[y * W + x] = 1;
}

/* ── ambient set-up (computed once) ── */
const lum = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
const isFoliage = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; return g >= r - 12 && g > b + 8 && lum(d, i) < 200; };
// sky: upper rows, light and not leafy. The cloud plate fills tree gaps per row so drifting never pulls in foliage.
const skyMaxRow = Math.round(A.clouds.maxY * H);
const isSky = new Uint8Array(W * H), skyPlate = new Uint8Array(tidy.data);
for (let y = 0; y < skyMaxRow; y++) {
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, d = tidy.data; const leafy = d[i + 1] > d[i + 2] + 15 && d[i + 1] >= d[i] * 0.85; if (!isFoliage(d, i) && !leafy && lum(d, i) > 105) isSky[y * W + x] = 1; }
  let last = -1;
  for (let x = 0; x <= W; x++) {
    if (x < W && !isSky[y * W + x]) continue;
    if (last + 1 < x) for (let g = last + 1; g < x; g++) {           // interpolate across the gap [last+1, x-1]
      const a = last >= 0 ? last : x, b = x < W ? x : last, t = a === b ? 0 : (g - a) / (b - a);
      for (let c = 0; c < 3; c++) skyPlate[(y * W + g) * 4 + c] = Math.round(tidy.data[(y * W + a) * 4 + c] * (1 - t) + tidy.data[(y * W + b) * 4 + c] * t);
    }
    last = x;
  }
}
// sun: centroid of the brightest pixels in the sky
let sunX = 0, sunY = 0, sunN = 0;
for (let y = 0; y < Math.round(0.45 * H); y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (lum(tidy.data, i) > 238) { sunX += x; sunY += y; sunN++; } }
sunX = sunN ? sunX / sunN : W * 0.36; sunY = sunN ? sunY / sunN : H * 0.27;
for (let y = 0; y < skyMaxRow; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - sunX, y - sunY) < A.clouds.sunKeepPx) isSky[y * W + x] = 0;   // the sun stays put
{ // erode by 2 scene px: only open sky drifts, so leaf tips at canopy edges are never copied out into the sky
  const src = isSky.slice(), E = Math.round(2 * K);
  for (let y = 0; y < skyMaxRow; y++) for (let x = 0; x < W; x++) {
    if (!src[y * W + x]) continue;
    for (let dy = -E; dy <= E && isSky[y * W + x]; dy++) for (let dx = -E; dx <= E; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < W && Y >= 0 && Y < skyMaxRow && !src[Y * W + X]) { isSky[y * W + x] = 0; break; }
    }
  }
}
// wind: foliage outside lawn, pool, patio and the clipped hedges
const windBlock = maskOf(A.wind.exclude);
const windOk = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) if (!windBlock[p] && (isFoliage(tidy.data, p * 4) || isFoliage(untidy.data, p * 4))) windOk[p] = 1;

function ambient(img, f) {
  const src = new Uint8Array(img.data);
  // clouds drift right, upper rows a little faster (parallax), mirror-wrapped so there is no seam
  const base = f * A.clouds.pxPerFrame;
  for (let y = 0; y < skyMaxRow; y++) {
    const off = Math.round(base * (1.3 - 0.6 * (y / skyMaxRow)));
    for (let x = 0; x < W; x++) {
      if (!isSky[y * W + x]) continue;
      let sx = x - off; sx = ((sx % (2 * W)) + 2 * W) % (2 * W); if (sx >= W) sx = 2 * W - 1 - sx;
      if (!isSky[y * W + sx]) continue;                     // only sky moves into sky: tree edges stay put
      const i = (y * W + x) * 4, j = (y * W + sx) * 4;
      img.data[i] = tidy.data[j]; img.data[i + 1] = tidy.data[j + 1]; img.data[i + 2] = tidy.data[j + 2];
    }
  }
  // wind: foliage rows shift sideways in a slow travelling wave (leaf clumps move together in bands)
  const cur = new Uint8Array(img.data), ph = (2 * Math.PI * f) / A.wind.periodFrames;
  for (let y = 0; y < H; y++) {
    const band = Math.floor(y / (3 * K));
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (!windOk[p]) continue;
      const d = Math.round(A.wind.amplitude * Math.sin(ph + band * 0.55 + (x * 0.045) / K) * (y < H * 0.45 ? 1.4 : 1));
      if (!d) continue;
      const sx = Math.min(W - 1, Math.max(0, x - d)), q = y * W + sx;
      if (!windOk[q] && !isSky[q] && !windOk[p]) continue;
      img.data[p * 4] = cur[q * 4]; img.data[p * 4 + 1] = cur[q * 4 + 1]; img.data[p * 4 + 2] = cur[q * 4 + 2];
    }
  }
  // sun glow: banded warm rings that breathe slowly (crisp bands, no smooth gradient)
  const G = A.sunGlow, pulse = 0.5 + 0.5 * Math.sin((2 * Math.PI * f) / G.pulseFrames);
  const R = G.radius * (0.9 + 0.1 * pulse);
  for (let y = Math.floor(sunY - R); y <= Math.ceil(sunY + R); y++) for (let x = Math.floor(sunX - R); x <= Math.ceil(sunX + R); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const d = Math.hypot(x - sunX, (y - sunY) * 1.1) / R; if (d >= 1) continue;
    const band = Math.ceil((1 - d) * G.bands), add = band * G.strength * (0.8 + 0.4 * pulse);
    const i = (y * W + x) * 4;
    img.data[i] = Math.min(255, img.data[i] + add); img.data[i + 1] = Math.min(255, img.data[i + 1] + add * 0.78); img.data[i + 2] = Math.min(255, img.data[i + 2] + add * 0.35);
  }
}

/* ── background ── */
function background(fr) {
  const img = { w: W, h: H, data: new Uint8Array(untidy.data) };
  const take = (x, y) => { const i = (y * W + x) * 4; img.data[i] = tidy.data[i]; img.data[i + 1] = tidy.data[i + 1]; img.data[i + 2] = tidy.data[i + 2]; };
  const put = (x, y, t) => { if (t >= 1 || (t > 0 && hash(x, y) < t)) take(x, y); };   // dithered feather: exact palette colours only
  const t = fr.scenery.tidyProgress.unassigned, feather = cfg.global.maskFeather;
  if (t >= 1) img.data.set(tidy.data);
  else if (t > 0) {
    const frontY = 0.12 + 0.9 * (1 - t);
    for (let y = 0; y < H; y++) {
      const w = (y + 0.5 - frontY * H) / feather + 0.5; if (w <= 0) continue;
      for (let x = 0; x < W; x++) if (!owned[y * W + x]) put(x, y, Math.min(1, w));
    }
  }
  // mower stripe: cut up to the mower's front edge, 1-2 px ragged line, a touch lighter
  if (STATIONS.includes("mower") && fr.mower.props.cutStripe.cutFrontY !== undefined) {
    const cutY = fr.mower.props.cutStripe.cutFrontY, b = M.cutBrighten || 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = (x + 0.5) / W, fy = (y + 0.5) / H;
      const rag = M.cutLineRaggedPx[0] + Math.floor(hash(x, 7) * (M.cutLineRaggedPx[1] - M.cutLineRaggedPx[0] + 1));   // ragged cut line, fixed per column
      if (!inMowerStripe(fx, fy) || y < cutY + rag) continue;
      take(x, y); const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, img.data[i] * b); img.data[i + 1] = Math.min(255, img.data[i + 1] * b); img.data[i + 2] = Math.min(255, img.data[i + 2] * b);
    }
  }
  // hedge: each snip trims one section of the top; the face below follows one snip later; fresh cuts read lighter
  if (STATIONS.includes("hedge")) {
    const h = fr.hedge.props, n = HG.sections, x0 = HG.trim.x[0] * W, sw = ((HG.trim.x[1] - HG.trim.x[0]) * W) / n;
    for (let y = Math.floor(HG.trim.top[0] * H); y < Math.ceil(HG.trim.face[1] * H); y++) {
      const isTop = y < HG.trim.face[0] * H;
      for (let x = Math.floor(x0); x < Math.ceil(x0 + sw * n); x++) {
        const s = Math.floor((x - x0) / sw); if (s < 0 || s >= n) continue;
        if (s < (isTop ? h.sectionsTrimmed : h.faceTidied) && inHedgeTrim((x + 0.5) / W, (y + 0.5) / H)) {
          take(x, y);
          if (isTop && s === h.sectionsTrimmed - 1 && h.freshness > 0) {
            const i = (y * W + x) * 4, k = 1 + (HG.freshBrighten - 1) * h.freshness;
            img.data[i] = Math.min(255, img.data[i] * k); img.data[i + 1] = Math.min(255, img.data[i + 1] * k); img.data[i + 2] = Math.min(255, img.data[i + 2] * k * 0.95);
          }
        }
      }
    }
  }
  // stray shoots sticking up out of every untrimmed hedge section (removed by that section's snip)
  if (STATIONS.includes("hedge")) {
    const h = fr.hedge.props, n = HG.sections, x0 = HG.trim.x[0] * W, sw = ((HG.trim.x[1] - HG.trim.x[0]) * W) / n, topRow = Math.round(HG.topEdgeY * H);
    for (let s = h.sectionsTrimmed; s < n; s++) {
      const r = px.rng(A.seed * 13 + s);
      for (let k = 0; k < 3; k++) {
        const x = Math.round(x0 + sw * (s + 0.1 + r() * 0.8)), tall = 3 + Math.floor(r() * 4), lean = r() < 0.5 ? -1 : 1, sway = (fr.frame + s) % 12 < 6 ? 0 : lean;
        for (let j = 0; j < tall; j++) blk(img, x + ((j === tall - 1 ? sway : 0) + (j > 1 ? lean : 0)) * K, topRow - j * K, SHOOT[(j + s) % SHOOT.length]);
      }
    }
  }
  ambient(img, fr.frame);
  return img;
}

/* ── drawing helpers ── */
function blit(dst, f, x0, y0, alpha = 1) {
  for (let y = 0; y < f.h; y++) {
    const dy = y0 + y; if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < f.w; x++) {
      const dx = x0 + x; if (dx < 0 || dx >= W) continue;
      const v = f.idx[y * f.w + x]; if (v < 0) continue;
      if (alpha < 1 && hash(dx, dy) > alpha) continue;
      const P = f.pal || pal;    // characters carry their own locked palette; props use the scene's
      const i = (dy * W + dx) * 4; dst.data[i] = P[v][0]; dst.data[i + 1] = P[v][1]; dst.data[i + 2] = P[v][2];
    }
  }
}
function placeSprite(dst, sheetId, poseIndex, heightPx, feetX, feetY, alpha = 1) {
  const sheet = sh.loadSheet(sheetDef[sheetId], cfg);
  if (!sheet) throw new Error(`sheet ${sheetId} is not generated yet (npm run sprites)`);
  const f = sh.frame(sheet, poseIndex, Math.max(3, Math.round(heightPx)));
  blit(dst, f, Math.round(feetX - f.ax), Math.round(feetY - f.h), alpha);
  return f;
}
const poseIdx = (sheetId, name) => sheetDef[sheetId].poses.findIndex((p) => (p.name || p) === name);
const fit = (id) => cfg.spriteFit[id] ?? cfg.spriteFit.default;
function shadow(dst, cx, cy, rx, ry, strength) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x / rx) ** 2 + (y / ry) ** 2; if (d > 1) continue;
    const X = Math.round(cx + x), Y = Math.round(cy + y); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    if (hash(X, Y) > strength * (1.2 - d)) continue;
    const i = (Y * W + X) * 4; dst.data[i] *= 0.62; dst.data[i + 1] *= 0.66; dst.data[i + 2] *= 0.6;
  }
}
function dot(dst, x, y, rgb) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; dst.data[i] = rgb[0]; dst.data[i + 1] = rgb[1]; dst.data[i + 2] = rgb[2]; }
function blk(dst, x, y, rgb) { for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) dot(dst, Math.round(x) + i, Math.round(y) + j, rgb); }   // one "old grid" pixel
const nearestPal = (rgb) => pal.reduce((b, c) => (px.dist2(...c, ...rgb) < px.dist2(...b, ...rgb) ? c : b));
const CLIP = [[143, 191, 74], [167, 211, 90], [111, 159, 58]].map(nearestPal);
const LEAF = [[96, 150, 60], [70, 120, 48], [130, 170, 70]].map(nearestPal);
const SOIL = [[110, 76, 50], [86, 60, 40]].map(nearestPal);
const SMOKE = [[205, 205, 200], [170, 172, 168]].map(nearestPal);
const DUST = [[200, 180, 150]].map(nearestPal);
const SHOOT = [[176, 196, 84], [146, 176, 66], [196, 206, 98]].map(nearestPal);   // sun-lit tips, so they read against the dark trees

/* ── mower ── */
function drawMower(img, fr, f) {
  const m = fr.mower, s = m.scale, fx = m.x * W, fy = m.y * H;
  const manH = fit("default") * s, mowH = fit("prop-mower") * s, ahead = Math.round(M.mowerAheadPx * s);
  const [shW, shH, shS] = M.shadow;
  const flying = [];
  for (let k = 1; k <= f; k++) {
    const p = plan.frames[k - 1].mower;
    if (!p.props.clippings) continue;
    const r = px.rng(A.seed * 31 + k), n = M.clippingsPerStep[0] + Math.floor(r() * (M.clippingsPerStep[1] - M.clippingsPerStep[0] + 1));
    const sx = p.x * W, sy = p.y * H - Math.round(M.mowerAheadPx * p.scale);
    for (let j = 0; j < n; j++) {
      const side = r() < 0.5 ? -1 : 1, life = cfg.particles.clippingLife;
      const vx = side * (0.6 + r() * 0.9) * K, vy = -(0.8 + r() * 0.8) * K, land = (2 + r() * 6) * K, age = f - k, c = CLIP[Math.floor(r() * CLIP.length)];
      if (age >= life) { if (age < life + 40) dot(img, sx + side * 2 * K + vx * life * 0.5, Math.min(sy + land, L.nearY * H - 1), c); continue; }
      const tt = age / life;
      flying.push([sx + side * 3 * K + vx * age * 0.9, sy - 3 * K + vy * age + (land + 3 * K) * tt * tt * 1.4, c]);
    }
  }
  shadow(img, fx, fy - ahead / 2, Math.round((shW * s) / 2), Math.max(1, Math.round((shH * s) / 2)), shS);
  const jit = m.props.jitterPx || 0;
  placeSprite(img, "prop-mower", m.props.mower.index, mowH, fx + jit, fy - ahead);
  let lastPuff = -1;
  for (let k = f; k >= Math.max(1, f - 3); k--) if (plan.frames[k - 1].mower.props.exhaust) { lastPuff = k; break; }
  if (lastPuff > 0) {
    const age = f - lastPuff, ex = fx + jit + Math.round(3 * s * K), ey = fy - ahead - mowH + Math.round(6 * s * K) - age * 2 * K;
    for (let j = 0; j <= age; j++) { blk(img, ex + j * K, ey - j * K, SMOKE[age > 1 ? 1 : 0]); blk(img, ex + (j + 1) * K, ey - j * K, SMOKE[1]); }
  }
  placeSprite(img, m.sheet, m.index, manH, fx, fy);
  for (const [x, y, c] of flying) dot(img, x, y, c);
}

/* ── planter: kneels on the lawn edge, planting into the border in front of the box edging ── */
function planterPos(offsetPx) {
  const s = persp(P.y);
  return { x: P.x * W + P.shuffleDir[0] * offsetPx, y: P.y * H + P.shuffleDir[1] * offsetPx, s };
}
function drawPlanter(img, fr, f) {
  const p = fr.planter, pr = p.props, pos = planterPos(p.offsetPx), s = pos.s;
  const hole1 = planterPos(0), hole2 = planterPos(P.shufflePx);
  const soilH = fit("prop-soil") * s;
  const at = (base, dx) => [base.x + dx * s, base.y];
  // ground layer: holes, mounds, planted plants, tray and pots
  const soilPose = (name) => poseIdx("prop-soil", name);
  const drawHole = (base, state, plantName) => {
    const [hx, hy] = at(base, P.holeOffsetPx);
    if (state === "planted") placeSprite(img, "prop-planting", poseIdx("prop-planting", plantName), fit("prop-planting") * s, hx, hy + K);
    else if (state) placeSprite(img, "prop-soil", soilPose(state), soilH, hx, hy + K);
  };
  drawHole(hole1, pr.hole1, "lavender-planted");
  drawHole(hole2, pr.hole2, "geranium-planted");
  if (pr.mound1) placeSprite(img, "prop-soil", soilPose(pr.mound1), soilH, ...at(hole1, P.moundOffsetPx));
  if (pr.mound2) placeSprite(img, "prop-soil", soilPose(pr.mound2), soilH, ...at(hole2, P.moundOffsetPx));
  placeSprite(img, "prop-tray", poseIdx("prop-tray", pr.tray), fit("prop-tray") * s, ...at(hole1, P.trayOffsetPx));
  // the plants still in the tray sit on top of it
  const [tx, ty] = at(hole1, P.trayOffsetPx), trayTop = ty - Math.round(fit("prop-tray") * s * 0.5);
  if (pr.lavender === "lavender-pot" && pr.tray === "tray-two") placeSprite(img, "prop-planting", poseIdx("prop-planting", "lavender-pot"), fit("prop-planting") * s * 0.8, tx - 3 * s * K, trayTop);
  if (pr.geranium === "geranium-pot" && pr.tray !== "tray-empty") placeSprite(img, "prop-planting", poseIdx("prop-planting", "geranium-pot"), fit("prop-planting") * s * 0.8, tx + 3 * s * K, trayTop);
  if (pr.pot) placeSprite(img, "prop-tray", poseIdx("prop-tray", pr.pot), fit("prop-tray") * s, ...at(hole1, P.potOffsetPx));
  // the gardener (kneeling sheets are drawn at their own, lower, fit)
  shadow(img, pos.x + 2 * s * K, pos.y, Math.round(9 * s * K), Math.max(1, Math.round(2 * s * K)), 0.35);
  placeSprite(img, p.sheet, p.index, fit(p.sheet) * s, pos.x, pos.y);
  // particles: soil kicks while digging, dust when knees touch / palms press / gloves clap
  const r = px.rng(A.seed * 17 + f);
  if (pr.soilKick) for (let j = 0; j < 3; j++) blk(img, pos.x + P.holeOffsetPx * s + (2 + r() * 5) * s * K, pos.y - (2 + r() * 4) * s * K, SOIL[j % 2]);
  if (pr.dustPuff || (p.sheet === "planter-finish" && p.pose === "clap-2")) for (let j = 0; j < 4; j++) blk(img, pos.x + (r() * 10 - 3) * s * K, pos.y - (p.sheet === "planter-finish" ? 14 : 1) * s * K - r() * 3 * K, DUST[0]);
}

/* ── hedge trimmer: tall A-frame ladder on the patio, against the hedge ── */
function drawHedge(img, fr, f) {
  const h = fr.hedge, pr = h.props;
  const baseX = HG.x * W, baseY = HG.y * H, topY = HG.ladderTopY * H, ladderH = baseY - topY;
  const s = persp(HG.y), wob = pr.ladderWobblePx || 0;
  if (pr.pile) placeSprite(img, "prop-ladder", poseIdx("prop-ladder", pr.pile), fit("prop-ladder") * s * 0.32, baseX + HG.pileOffsetPx * s, baseY + K);
  shadow(img, baseX + 2 * K, baseY, Math.round(10 * s * K), Math.round(2 * K), 0.35);
  placeSprite(img, "prop-ladder", poseIdx("prop-ladder", "ladder"), ladderH, baseX + wob * K, baseY);
  const feetY = topY + HG.manFeetBelowTopPx, manX = baseX + HG.manOffsetPx + (wob + (h.reachPx || 0)) * K;
  placeSprite(img, h.sheet, h.index, fit(h.sheet) * s, manX, feetY);
  // leaf burst on each close; clippings tumble down the hedge face for a few frames after
  const tipX = manX + 7 * s * K, tipY = HG.trim.top[0] * H + 4 * K;
  if (pr.leafBurst) { const r = px.rng(A.seed * 7 + f); for (let j = 0; j < 4 + Math.floor(r() * 5); j++) blk(img, tipX + (r() * 8 - 4) * K, tipY + (r() * 5 - 3) * K, LEAF[j % 3]); }
  for (let k = Math.max(1, f - 6); k < f; k++) {
    if (!plan.frames[k - 1].hedge.props.leafBurst) continue;
    const r = px.rng(A.seed * 7 + k), age = f - k;
    for (let j = 0; j < 3; j++) blk(img, tipX + ((r() * 8 - 4) + Math.sin(age + j)) * K, tipY + age * ((baseY - tipY) / 6) * (0.6 + r() * 0.4), LEAF[j % 3]);
  }
}

/* ── tree cutter: sits on a plank seat hung from the branch above by two ropes, sawing a dead branch to his right ── */
const T = cfg.tree;
const ROPE = nearestPal([206, 172, 110]), KERF = nearestPal([40, 30, 24]), FLASH = nearestPal([250, 246, 230]);
const SAWDUST = [[226, 196, 140], [200, 170, 120]].map(nearestPal);
function line(dst, x0, y0, x1, y1, c, thick = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) for (let t = 0; t < thick; t++) dot(dst, x0 + ((x1 - x0) * i) / n + t, y0 + ((y1 - y0) * i) / n, c);
}
// where the two seat ropes leave the top of a sprite frame: the opaque runs in its top row (fallback: plank ends)
function ropeTops(frame) {
  const runs = [];
  for (let x = 0, start = -1; x <= frame.w; x++) {
    const on = x < frame.w && frame.idx[x] >= 0;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { runs.push((start + x - 1) / 2); start = -1; }
  }
  if (runs.length >= 2) return [runs[0], runs[runs.length - 1]];
  return [frame.w * 0.3, frame.w * 0.7];
}
function drawTree(img, fr, f) {
  const t = fr.tree, pr = t.props, h = T.heightPx;
  const fx = T.x * W, fy = T.y * H;
  const [cx, cy] = [T.cut[0] * W, T.cut[1] * H];
  // dead twigs in the canopy give way to healthy foliage once the branch is gone
  const cp = T.canopy, heal = pr.canopyHealed, spring = pr.canopySpringPx || 0;
  if (heal < 1) placeSprite(img, "prop-canopy", poseIdx("prop-canopy", "dead"), cp.heightPx, cp.x * W, cp.y * H - spring, 1 - heal);
  // the branch (attached / sagging / swinging on the lowering rope / on the lawn, then cleared)
  const b = pr.branch;
  if (b.alpha > 0) {
    const attached = b.pose === "attached" || b.pose === "sag";
    const px2 = b.x * W, py2 = b.y * H + (attached ? b.sagPx || 0 : -(b.bouncePx || 0));   // plan.js gives the path
    if (b.pose !== "on-ground" && !attached) line(img, cx, cy - 2 * K, px2, py2 - T.branchHeightPx * 0.5, ROPE);   // lowering rope
    placeSprite(img, "prop-branch", b.index, T.branchHeightPx, px2, py2, b.alpha);
    // the saw cut through the branch: undercut grows up from below, top cut grows down to meet it
    if (attached) {
      const thick = Math.round(4 * K), u = Math.round(pr.kerf.under * 3 * thick), d = Math.round(pr.kerf.top * 1.5 * thick);
      for (let j = 0; j < Math.min(thick, u); j++) blk(img, cx, cy + (b.sagPx || 0) * K - j, KERF);
      for (let j = 0; j < Math.min(thick, d); j++) blk(img, cx, cy - thick + 1 + j, KERF);
    }
  }
  // the man on his plank seat; the two seat ropes continue from the top of the sprite up to the branch above
  const fr2 = placeSprite(img, t.sheet, t.index, h, fx, fy);
  const [r1, r2] = ropeTops(fr2), left = Math.round(fx - fr2.ax), top = Math.round(fy - fr2.h);
  const [a1, a2] = T.ropeAnchors;
  line(img, left + r1, top, a1[0] * W, a1[1] * H, ROPE, Math.round(K));
  line(img, left + r2, top, a2[0] * W, a2[1] * H, ROPE, Math.round(K));
  const r = px.rng(A.seed * 23 + f);
  if (pr.sawdust) for (let k = Math.max(1, f - 7); k <= f; k++) {              // a stream drifting down from the cut
    const rr = px.rng(A.seed * 29 + k), age = f - k;
    for (let j = 0; j < 3; j++) dot(img, cx + (rr() * 3 - 1) * K + age * 0.3 * K, cy + K + age * 2 * K + rr() * 2 * K, SAWDUST[j % 2]);
  }
  if (pr.crackFlash) for (let j = 0; j < 5; j++) blk(img, cx + (r() * 4 - 2) * K, cy - 2 * K + r() * 4 * K, FLASH);
  if (pr.crackFlash) for (let j = 0; j < 4; j++) blk(img, cx + (3 + r() * 8) * K, cy + (r() * 6 - 4) * K, LEAF[j % 3]);
}

function drawButterfly(img, fr) {
  const b = fr.ambient.butterfly;
  if (!b) return;
  placeSprite(img, "ambient-butterfly", poseIdx("ambient-butterfly", b.pose), A.butterfly.heightPx, b.x * W, b.y * H);
}

/* ── main ── */
(async () => {
  for (const d of ["assets/masters", "public/frames"]) px.ensureDir(path.join(px.ROOT, d));
  for (const fr of plan.frames) {
    const m = fr.mower, moving = fr.frame >= M.ranges.easeIn[0];
    m.props.cutStripe.cutFrontY = moving ? Math.round(m.y * H - M.mowerAheadPx * m.scale - fit("prop-mower") * m.scale * 0.4) : undefined;
  }
  const draw = { mower: drawMower, planter: drawPlanter, hedge: drawHedge, tree: drawTree };
  const depth = (st, fr) => ({ mower: fr.mower.y, planter: P.y, hedge: HG.y - 0.001, tree: 0 }[st]);   // farther (smaller y) first
  const from = +args.from || 1, to = +args.to || plan.frameCount, t0 = Date.now();
  for (let f = from; f <= to; f++) {
    const fr = plan.frames[f - 1], img = background(fr);
    for (const st of STATIONS.filter((x) => draw[x]).sort((a, b) => depth(a, fr) - depth(b, fr))) draw[st](img, fr, f);
    drawButterfly(img, fr);
    const name = "frame_" + String(f).padStart(3, "0");
    px.writePng(`assets/masters/${name}.png`, img);
    await sharp(Buffer.from(img.data.buffer), { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true }).toFile(path.join(px.ROOT, "public", "frames", name + ".webp"));
  }
  const kb = fs.readdirSync(path.join(px.ROOT, "public", "frames")).reduce((a, x) => a + fs.statSync(path.join(px.ROOT, "public", "frames", x)).size, 0) / 1024;
  console.log(`Frames ${from}-${to} written (stations: ${STATIONS.join(", ")}) in ${((Date.now() - t0) / 1000).toFixed(1)} s. public/frames: ${(kb / 1024).toFixed(1)} MB`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
