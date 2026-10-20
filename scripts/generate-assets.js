#!/usr/bin/env node
/*
 * Build-time pixel-art asset generator for the Hinks hero animation.
 *
 *   npm run assets                      generate any missing sheets, then post-process everything
 *   npm run assets:process              post-process cached sheets only (no API calls)
 *   node scripts/generate-assets.js --only=planter-dig,planter-unpot
 *   node scripts/generate-assets.js --regenerate=hedge-snip   (max 2 attempts per sheet, then use a fallback)
 *
 * Generation runs only here, locally. The key is read from OPENAI_API_KEY (or .env) and is never printed,
 * logged or written anywhere. The website only loads the static PNG/JSON files written to public/assets.
 *
 * Pipeline per sheet: OpenAI image edit (reference images attached) -> key out #FF00FF -> snap to the
 * background palette -> split the single row into frames -> nearest-neighbour (block-majority) downscale to
 * the scene's 480x272 pixel grid -> trim + bottom-centre anchor into equal cells -> sheet PNG + JSON.
 * Then: one PixiJS atlas for everything, plus QC contact sheets and preview GIFs in qc/.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { PNG } = require("pngjs");
const { GIFEncoder } = require("gifenc");
const { drawFallback } = require("./fallback-sprites");

const ROOT = path.resolve(__dirname, "..");
const P = (...p) => path.join(ROOT, ...p);
const argDir = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? path.resolve(a.split("=")[1]) : null; };
const DIR = {
  refs: P("assets-src", "refs"),
  raw: argDir("raw-dir") || P("assets-src", "raw"),     // cache: one file per sheet, never regenerated unless asked
  out: argDir("out-dir") || P("public", "assets", "sprites"),
  qc: argDir("qc-dir") || P("qc"),                      // (the dir overrides are for offline testing)
};
const MANIFEST = P("assets-src", "manifest.json");

/* ─── Settings ─────────────────────────────────────────────────────────────── */
const API = {
  model: "gpt-image-2.5-sunburst",   // newest GPT image model in the official SDK (2026-09-08 snapshot)
  qualities: ["max", "high"],        // highest available first; falls back if the model rejects it
  size: "2304x768",                  // 3:1 strip, so one horizontal row of frames
  maxAttempts: 2,
};
const KEY_RGB = [255, 0, 255];
const BACKGROUNDS = ["d-tidy.png", "d-untidy.png", "p-tidy.png", "p-untidy.png"].map((f) => P("public", "assets", "hero", f));
const PALETTE_SIZE = 64;
/* Sprite pixel density relative to the scene grid. 1 = sprite pixels exactly match the 480x272 background;
   4/3 = one step finer (a sprite pixel is 3 screen px where a scene pixel is 4 at 1920 wide). */
const SPRITE_DENSITY = 4 / 3;

const CHARACTER = "the same gardener as in the reference model sheet: white short-sleeved work shirt, olive-green work trousers, " +
  "dark brown boots, wide-brim straw hat with a dark green band, dark green gloves, short brown hair, friendly face, no sunglasses";

/* One sheet per action. `fit` = height in scene pixels (480x272 grid) of the tallest frame.
   `after` = sheets whose output is used as an extra reference, so a character stays identical across its actions. */
const SHEETS = [
  {
    id: "mower-walk-back", fps: 10, fit: 34, refs: ["gardener-model.png", "mower-model.png", "scene-desktop.png"],
    subject: `${CHARACTER}, seen from directly behind, walking straight away from the viewer while pushing a red petrol lawnmower in front of him. ` +
      "The mower (red deck, black wheels, black handle, black grass box) is identical in every frame and the same distance ahead of him; his gloved hands grip the handle bar in every frame",
    frames: [
      "contact pose: right foot forward with heel down, left foot back on its toes, legs at their widest",
      "down pose: right foot flat taking his weight, left knee bending, body at its lowest",
      "passing pose: left leg swinging forward past the right leg, legs close together, body rising",
      "up pose: left foot lifting forward, right leg straight, body at its highest",
      "contact pose: left foot forward with heel down, right foot back on its toes, legs at their widest",
      "down pose: left foot flat taking his weight, right knee bending, body at its lowest",
      "passing pose: right leg swinging forward past the left leg, legs close together, body rising",
      "up pose: right foot lifting forward, left leg straight, body at its highest",
    ],
  },
  {
    id: "mower-walk-front", fps: 10, fit: 34, refs: ["gardener-model.png", "mower-model.png", "scene-desktop.png"], after: ["mower-walk-back"],
    subject: `${CHARACTER}, seen from directly in front, walking straight towards the viewer while pushing a red petrol lawnmower in front of him. ` +
      "The mower (red deck, black wheels, black engine, black handle) is identical in every frame, in front of his legs and the same distance ahead of him; his gloved hands grip the handle bar in every frame",
    frames: [
      "contact pose: right foot forward with heel down, left foot back, legs at their widest",
      "down pose: right foot flat taking his weight, left knee bending, body at its lowest",
      "passing pose: left leg swinging forward past the right leg, legs close together, body rising",
      "up pose: left foot lifting forward, right leg straight, body at its highest",
      "contact pose: left foot forward with heel down, right foot back, legs at their widest",
      "down pose: left foot flat taking his weight, right knee bending, body at its lowest",
      "passing pose: right leg swinging forward past the left leg, legs close together, body rising",
      "up pose: right foot lifting forward, left leg straight, body at its highest",
    ],
  },
  {
    id: "planter-kneel", fps: 6, fit: 32, refs: ["gardener-model.png", "scene-desktop.png"],
    subject: `${CHARACTER}, seen from the side facing right, getting down to plant`,
    frames: [
      "standing upright, a small potted green plant with yellow flowers held at his waist in his left hand, a trowel in his right hand",
      "bending forward from the hips, knees slightly bent, still holding the pot and trowel",
      "lowering his right knee towards the ground, left foot planted, reaching down with the pot",
      "kneeling on his right knee with his left knee up, setting the pot down on the ground in front of him",
      "kneeling on both knees with his back straight, the pot on the ground in front of him, trowel in his right hand",
    ],
  },
  {
    id: "planter-dig", fps: 7, fit: 24, refs: ["gardener-model.png", "scene-desktop.png"], after: ["planter-kneel"],
    subject: `${CHARACTER}, kneeling on both knees, seen from the side facing right, digging a planting hole in front of his knees with a hand trowel`,
    frames: [
      "trowel raised above the ground at chest height, ready to dig",
      "trowel tip just entering the soil in front of his knees",
      "trowel pushed deep into the soil, wrist bent, soil bulging around it",
      "levering the soil up, a clump of brown soil on the trowel",
      "flicking the soil to his side, the clump of soil in mid-air",
      "trowel held back above the hole, a small heap of soil beside the hole",
    ],
  },
  {
    id: "planter-unpot", fps: 6, fit: 24, refs: ["gardener-model.png", "scene-desktop.png"], after: ["planter-kneel"],
    subject: `${CHARACTER}, kneeling on both knees, seen from the side facing right, taking a small green plant with yellow flowers out of a terracotta pot`,
    frames: [
      "reaching forward with both hands for the terracotta pot on the ground",
      "lifting the pot up to chest height with both hands",
      "tipping the pot upside down, one hand spread under the plant",
      "squeezing the sides of the pot, the root ball sliding out",
      "the plant with its root ball free in one hand, the empty pot in the other",
      "setting the empty pot down to his side, the plant held over the planting hole",
    ],
  },
  {
    id: "planter-backfill", fps: 6, fit: 24, refs: ["gardener-model.png", "scene-desktop.png"], after: ["planter-kneel"],
    subject: `${CHARACTER}, kneeling on both knees, seen from the side facing right, planting a small green plant with yellow flowers and filling the hole`,
    frames: [
      "lowering the plant into the hole with both hands",
      "the plant sitting in the hole, both hands steadying its stem",
      "right hand sweeping soil from a small heap towards the plant",
      "both hands pressing soil in around the stem",
      "leaning forward, firming the soil with flat palms",
      "sitting back on his heels, the plant standing upright in the ground",
    ],
  },
  {
    id: "planter-shuffle", fps: 5, fit: 24, refs: ["gardener-model.png", "scene-desktop.png"], after: ["planter-kneel"],
    subject: `${CHARACTER}, kneeling, seen from the side facing right, shuffling sideways on his knees to the next planting spot`,
    frames: [
      "kneeling upright on both knees, hands resting on his thighs",
      "leaning, lifting his right knee and moving it forward to the right",
      "bringing his left knee up after it, weight centred between them",
      "kneeling upright again in the new spot, hands reaching forward to the ground",
    ],
  },
  {
    id: "planter-standup", fps: 6, fit: 32, refs: ["gardener-model.png", "scene-desktop.png"], after: ["planter-kneel"],
    subject: `${CHARACTER}, seen from the side facing right, getting up after planting`,
    frames: [
      "kneeling on both knees, hands on his thighs",
      "left foot planted forward, right knee still down, hand on his left knee",
      "pushing up, right knee lifting off the ground, body bent forward",
      "rising with knees bent, back straightening",
      "standing upright, brushing his gloved hands together",
    ],
  },
  {
    id: "hedge-ready", fps: 6, fit: 46, refs: ["gardener-model.png", "scene-desktop.png"],
    subject: `${CHARACTER}, standing on the second step of a short wooden stepladder, seen from behind and slightly from his left, holding long-handled hedge shears. ` +
      "The stepladder is drawn identically in every frame. Do not draw the hedge",
    frames: [
      "standing on the step, shears closed and pointing down at his side",
      "lifting the closed shears to waist height with both hands",
      "raising the shears to shoulder height, the blades starting to open",
      "shears level at shoulder height, blades open wide, ready to cut",
    ],
  },
  {
    id: "hedge-snip", fps: 8, fit: 46, refs: ["gardener-model.png", "scene-desktop.png"], after: ["hedge-ready"],
    subject: `${CHARACTER}, standing on the second step of a short wooden stepladder, seen from behind and slightly from his left, ` +
      "cutting the top of a hedge in front of him with long-handled shears held at shoulder height. The stepladder and his feet are identical in every frame. Do not draw the hedge",
    frames: [
      "blades wide open, arms apart",
      "blades closing halfway, arms pulling together",
      "blades snapped fully shut, a small burst of green leaf clippings at the blade tips",
      "blades opening slightly, the clippings falling away",
      "blades half open, arms moving apart",
      "blades nearly wide open again, a few last clippings below",
    ],
  },
  {
    id: "hedge-finish", fps: 5, fit: 46, refs: ["gardener-model.png", "scene-desktop.png"], after: ["hedge-ready"],
    subject: `${CHARACTER} with a short wooden stepladder and long-handled hedge shears, seen from behind and slightly from his left, finishing the job. ` +
      "The stepladder stays in the same place in every frame. Do not draw the hedge",
    frames: [
      "on the second step, closing the shears and lowering them to waist height",
      "on the second step, shears resting on his shoulder, looking at his work",
      "stepping down with one foot onto the bottom step",
      "standing on the ground beside the ladder, shears held at his side",
    ],
  },
  {
    id: "tree-brace", fps: 5, fit: 26, refs: ["gardener-model.png", "scene-desktop.png"],
    subject: `${CHARACTER}, but wearing a red climbing helmet instead of the straw hat and a climbing harness, hanging on a climbing rope in a tree, ` +
      "seen from the front and slightly left. The rope is one thin straight vertical line rising from his harness to about one head-height above his helmet. Do not draw the tree or any branch",
    frames: [
      "hanging on the rope, both hands gripping the rope above the harness",
      "swinging his legs towards the right, knees bending",
      "feet braced against an unseen branch to his right, body leaning back, rope taut",
      "braced, left hand on the rope, right hand reaching down for a handsaw on his harness",
    ],
  },
  {
    id: "tree-sawstart", fps: 5, fit: 26, refs: ["gardener-model.png", "scene-desktop.png"], after: ["tree-brace"],
    subject: `the climbing gardener from the reference sheet (red helmet, harness, white shirt, olive trousers), braced on his rope with his feet against an unseen branch to his right, ` +
      "seen from the front and slightly left. The rope is one thin straight vertical line rising from his harness to about one head-height above his helmet. Do not draw the tree or any branch",
    frames: [
      "pulling a small handsaw out of the holster on his harness",
      "holding the saw out to his right, blade level",
      "resting the blade on the unseen branch, making a short careful stroke",
      "pulling the first stroke back, the blade biting in, a few specks of sawdust",
    ],
  },
  {
    id: "tree-cutting", fps: 9, fit: 26, refs: ["gardener-model.png", "scene-desktop.png"], after: ["tree-brace"],
    subject: `the climbing gardener from the reference sheet (red helmet, harness, white shirt, olive trousers), braced on his rope with his feet against an unseen branch to his right, ` +
      "sawing it with a handsaw held out to his right; his body and feet stay still while his saw arm moves. The rope is one thin straight vertical line rising from his harness. Do not draw the tree or any branch",
    frames: [
      "saw pushed fully forward to the right, arm extended",
      "saw three quarters forward, specks of sawdust falling",
      "saw in the middle of its stroke, more sawdust",
      "saw pulled back towards his body, elbow bent",
      "saw pulled fully back, elbow tucked in, sawdust falling",
      "pushing the saw forward again, arm half extended",
    ],
  },
  {
    id: "tree-finish", fps: 5, fit: 26, refs: ["gardener-model.png", "scene-desktop.png"], after: ["tree-brace"],
    subject: `the climbing gardener from the reference sheet (red helmet, harness, white shirt, olive trousers), hanging on his rope, seen from the front and slightly left, ` +
      "finishing cutting a branch. The rope is one thin straight vertical line rising from his harness. Do not draw the tree or any branch",
    frames: [
      "the final saw stroke pushed fully forward, arm extended",
      "lifting the saw away, looking down as the branch drops",
      "sliding the saw back into the holster on his harness",
      "relaxed, left hand on the rope, giving a thumbs up with his right hand",
    ],
  },
  {
    id: "prop-branch", fps: 6, fit: 30, refs: ["scene-desktop.png"],
    subject: "a single leafy oak branch, the same branch in every frame, falling from a tree",
    frames: [
      "the branch held horizontal, leaves full",
      "the branch tilting down about twenty degrees at its heavy end",
      "the branch tilting about fifty degrees, a few leaves breaking off",
      "the branch nearly vertical, falling, leaves scattering around it",
      "the branch lying flat on the grass, a few loose leaves beside it",
    ],
  },
  {
    id: "prop-plants", fps: 3, fit: 12, refs: ["scene-desktop.png"],
    subject: "the same small garden plant with green leaves and small yellow flowers, in three states, seen from the side",
    frames: [
      "in a small terracotta pot",
      "planted in the ground with a small ring of fresh dark soil around its base, no pot",
      "planted in the ground a little fuller, more yellow flowers open, soil settled",
    ],
  },
  {
    id: "prop-soil", fps: 4, fit: 7, refs: ["scene-desktop.png"],
    subject: "a patch of dark brown garden soil seen from slightly above and to the side, in four stages",
    frames: [
      "a flat soil patch with a small dug hole",
      "a small loose heap of soil beside the hole",
      "a medium heap of soil",
      "a large heap of soil",
    ],
  },
  {
    id: "prop-potstack", fps: 3, fit: 12, refs: ["scene-desktop.png"],
    subject: "empty terracotta plant pots, seen from the side",
    frames: [
      "one empty terracotta pot standing upright",
      "two empty terracotta pots stacked inside each other",
      "three empty terracotta pots stacked inside each other",
    ],
  },
];

/* ─── Small utils ──────────────────────────────────────────────────────────── */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });
const readPng = (f) => PNG.sync.read(fs.readFileSync(f));
const writePng = (f, w, h, rgba) => {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(rgba.buffer ? Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength) : rgba);
  ensureDir(path.dirname(f));
  fs.writeFileSync(f, PNG.sync.write(png));
};
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const loadManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { sheets: {} });
const saveManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + "\n");

/* The key comes from the environment or .env, and only ever goes into the Authorization header. */
function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envFile = P(".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("OPENAI_API_KEY is not set (add it to .env).");
}

/* ─── Generation ───────────────────────────────────────────────────────────── */
function promptFor(sheet) {
  const n = sheet.frames.length;
  const frames = sheet.frames.map((f, i) => `Frame ${i + 1}: ${f}.`).join("\n");
  return [
    `A pixel-art sprite sheet of ${sheet.subject}.`,
    `Exactly ${n} frames in ONE single horizontal row, left to right, in ${n} equal-width cells across the whole image, with clear empty space between frames.`,
    "The background is solid, flat, pure magenta #FF00FF filling the entire image: no gradient, no texture, no ground, no shadow, no grid lines, no borders, no text, no numbers.",
    "Use no magenta or hot pink anywhere in the subject.",
    "Match the pixel-art style, palette and soft sunrise lighting (light from the left) of the reference garden scene, and the character design of the reference model sheet.",
    "Same scale in every frame; every figure stands on the same baseline near the bottom of its cell and is centred in its cell. Every frame shows a different pose; no two frames are the same.",
    frames,
  ].join("\n");
}

async function generate(sheet, refsPaths) {
  const key = apiKey();
  let lastErr;
  for (const quality of API.qualities) {
    const form = new FormData();
    form.append("model", API.model);
    form.append("prompt", promptFor(sheet));
    form.append("size", API.size);
    form.append("quality", quality);
    form.append("n", "1");
    form.append("output_format", "png");
    form.append("background", "opaque");
    for (const r of refsPaths) form.append("image[]", new Blob([fs.readFileSync(r)], { type: "image/png" }), path.basename(r));
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data && body.data[0] && body.data[0].b64_json) return { png: Buffer.from(body.data[0].b64_json, "base64"), quality };
    lastErr = (body.error && body.error.message) || `HTTP ${res.status}`;
    if (!/quality/i.test(lastErr)) break;                    // only retry for an unsupported quality value
  }
  throw new Error(lastErr);
}

/* ─── Image processing ─────────────────────────────────────────────────────── */
const isKey = (r, g, b) => {
  const d = (r - KEY_RGB[0]) ** 2 + (g - KEY_RGB[1]) ** 2 + (b - KEY_RGB[2]) ** 2;
  // the flat key colour, plus the magenta fringe the model leaves around edges
  return d < 110 * 110 || (r > 150 && b > 150 && g < 0.6 * Math.min(r, b));
};
const dist2 = (r1, g1, b1, r2, g2, b2) => {        // "redmean" weighted RGB distance
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
};

/* Shared palette from the backgrounds: k-means over all scene pixels, plus the darkest and brightest colours
   (outlines and highlights get averaged away otherwise). */
function buildPalette() {
  const pts = [];
  for (const f of BACKGROUNDS) {
    const png = readPng(f);
    for (let i = 0; i < png.data.length; i += 4) pts.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
  }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sample = pts.length > 80000 ? Array.from({ length: 80000 }, () => pts[Math.floor(rnd() * pts.length)]) : pts;
  const cents = [sample[0].slice()];
  while (cents.length < PALETTE_SIZE) {                         // k-means++ seeding
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

/* Key + snap: returns an index map (-1 = transparent). */
function keyAndSnap(png, snap) {
  const { width: w, height: h, data } = png;
  const idx = new Int16Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    idx[p] = a < 128 || isKey(r, g, b) ? -1 : snap(r, g, b);
  }
  return { w, h, idx };
}

/* Split the single row into frames using empty columns; falls back to equal cells. */
function splitFrames(img, n) {
  const { w, h, idx } = img;
  const col = new Int32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (idx[y * w + x] >= 0) col[x]++;
  let runs = [];
  for (let x = 0; x < w;) {
    if (col[x] <= 1) { x++; continue; }
    const s = x; let mass = 0;
    while (x < w && col[x] > 1) mass += col[x++];
    runs.push({ s, e: x, mass });
  }
  const maxMass = Math.max(0, ...runs.map((r) => r.mass));
  runs = runs.filter((r) => r.mass > maxMass * 0.02);         // drop specks
  while (runs.length > n) {                                   // merge across the smallest gap
    let gi = 0, gmin = Infinity;
    for (let i = 0; i < runs.length - 1; i++) { const g = runs[i + 1].s - runs[i].e; if (g < gmin) { gmin = g; gi = i; } }
    runs.splice(gi, 2, { s: runs[gi].s, e: runs[gi + 1].e, mass: runs[gi].mass + runs[gi + 1].mass });
  }
  while (runs.length < n && runs.length) {                    // two frames touching (e.g. flying soil): split the widest
    let wi = 0; runs.forEach((r, i) => { if (r.e - r.s > runs[wi].e - runs[wi].s) wi = i; });
    const r = runs[wi], a = r.s + Math.floor((r.e - r.s) * 0.2), b = r.e - Math.floor((r.e - r.s) * 0.2);
    if (r.e - r.s < (w / n) * 1.3) break;                     // not wide enough to hold two frames
    let cut = a; for (let x = a; x < b; x++) if (col[x] < col[cut]) cut = x;
    runs.splice(wi, 1, { s: r.s, e: cut, mass: 0 }, { s: cut + 1, e: r.e, mass: 0 });
  }
  if (runs.length === n) return { ranges: runs.map((r) => [r.s, r.e]), method: "gaps" };
  const cw = w / n;
  return { ranges: Array.from({ length: n }, (_, i) => [Math.round(i * cw), Math.round((i + 1) * cw)]), method: "equal-cells" };
}

function bbox(img, x0, x1) {
  const { w, h, idx } = img;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (idx[y * w + x] >= 0) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* Nearest-neighbour downscale by block majority: each target pixel takes the most common palette colour
   in its source block (no blending, so no new colours); transparent when the block is mostly empty. */
function downscale(img, b, s, nColors) {
  const ow = Math.max(1, Math.round(b.w * s)), oh = Math.max(1, Math.round(b.h * s));
  const out = new Int16Array(ow * oh).fill(-1);
  const counts = new Int32Array(nColors);
  for (let y = 0; y < oh; y++) {
    const sy0 = b.y + Math.floor((y * b.h) / oh), sy1 = Math.max(sy0 + 1, b.y + Math.floor(((y + 1) * b.h) / oh));
    for (let x = 0; x < ow; x++) {
      const sx0 = b.x + Math.floor((x * b.w) / ow), sx1 = Math.max(sx0 + 1, b.x + Math.floor(((x + 1) * b.w) / ow));
      counts.fill(0); let opaque = 0, total = 0;
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) {
        total++; const v = img.idx[yy * img.w + xx];
        if (v >= 0) { counts[v]++; opaque++; }
      }
      if (opaque * 2 < total) continue;
      let best = 0; for (let j = 1; j < nColors; j++) if (counts[j] > counts[best]) best = j;
      out[y * ow + x] = best;
    }
  }
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {      // drop isolated single pixels
    const i = y * ow + x; if (out[i] < 0) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
      const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < ow && yy < oh && out[yy * ow + xx] >= 0;
    }).length;
    if (nb === 0) out[i] = -1;
  }
  return trimIdx({ w: ow, h: oh, idx: out });
}

function trimIdx(f) {
  const b = bbox(f, 0, f.w);
  if (!b) return f;
  const out = new Int16Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) out[y * b.w + x] = f.idx[(b.y + y) * f.w + b.x + x];
  return { w: b.w, h: b.h, idx: out };
}

function processSheet(sheet, pal, snap) {
  const raw = readPng(path.join(DIR.raw, sheet.id + ".png"));
  const img = keyAndSnap(raw, snap);
  const n = sheet.frames.length;
  const { ranges, method } = splitFrames(img, n);
  const boxes = ranges.map(([a, b]) => bbox(img, a, b));
  const warnings = [];
  if (method !== "gaps") warnings.push("frames were not cleanly separated; sliced into equal cells");
  if (boxes.some((b) => !b)) throw new Error(`${sheet.id}: an empty frame (generation failed to fill every cell)`);

  // one scale for the whole sheet: the tallest frame becomes `fit` scene pixels
  const tallest = Math.max(...boxes.map((b) => b.h));
  const s = (sheet.fit * SPRITE_DENSITY) / tallest;     // `fit` is in scene pixels; sprites are drawn SPRITE_DENSITY finer
  const frames = boxes.map((b) => downscale(img, b, s, pal.length));
  return alignFrames(sheet, frames, warnings, { scale: s, method });
}

/* Code-drawn fallback: frames are already on the scene grid in palette colours. */
function fallbackSheet(sheet, pal) {
  const frames = drawFallback(sheet.id, pal).map(trimIdx);
  return alignFrames(sheet, frames, ["code-drawn fallback (OpenAI generation unavailable)"], { scale: 1, method: "fallback" });
}

function alignFrames(sheet, frames, warnings, info) {
  const n = frames.length;
  // equal cells, every frame trimmed and anchored bottom-centre on one baseline
  const cw = Math.max(...frames.map((f) => f.w)) + 2, ch = Math.max(...frames.map((f) => f.h)) + 1;
  const cells = frames.map((f) => {
    const c = new Int16Array(cw * ch).fill(-1), ox = Math.floor((cw - f.w) / 2), oy = ch - f.h;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) c[(oy + y) * cw + ox + x] = f.idx[y * f.w + x];
    return c;
  });

  // drift / repetition checks
  const hs = frames.map((f) => f.h), spread = (Math.max(...hs) - Math.min(...hs)) / Math.max(...hs);
  if (sheet.id.startsWith("mower") || sheet.id === "hedge-snip" || sheet.id === "tree-cutting") {
    if (spread > 0.15) warnings.push(`frame heights vary by ${Math.round(spread * 100)}% in a cycle that should keep its size`);
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let diff = 0; for (let k = 0; k < cells[i].length; k++) if (cells[i][k] !== cells[j][k]) diff++;
    if (diff / cells[i].length < 0.01) warnings.push(`frames ${i + 1} and ${j + 1} are identical`);
  }
  return { id: sheet.id, cw, ch, cells, scale: info.scale, warnings, method: info.method };
}

const toRgba = (cells, cw, ch, pal) => {
  const n = cells.length, W = cw * n, out = new Uint8Array(W * ch * 4);
  cells.forEach((c, f) => {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = c[y * cw + x]; if (v < 0) continue;
      const o = (y * W + f * cw + x) * 4; out[o] = pal[v][0]; out[o + 1] = pal[v][1]; out[o + 2] = pal[v][2]; out[o + 3] = 255;
    }
  });
  return { W, H: ch, rgba: out };
};

/* ─── QC: contact sheet + preview GIF ─────────────────────────────────────── */
const QC_BG = [96, 108, 96], QC_LINE = [70, 80, 70], QC_BASE = [200, 70, 70];
function contactSheet(res, pal, scale = 8) {
  const n = res.cells.length, cw = res.cw * scale, ch = res.ch * scale, gap = 4, W = n * cw + (n + 1) * gap, H = ch + 2 * gap;
  const out = new Uint8Array(W * H * 4);
  const put = (x, y, c) => { const o = (y * W + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, QC_LINE);
  res.cells.forEach((c, f) => {
    const ox = gap + f * (cw + gap);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = c[Math.floor(y / scale) * res.cw + Math.floor(x / scale)];
      put(ox + x, gap + y, v < 0 ? (y === ch - 1 ? QC_BASE : QC_BG) : pal[v]);
    }
  });
  return { W, H, rgba: out };
}

function previewGif(res, pal, fps, scale = 6) {
  const W = res.cw * scale, H = res.ch * scale;
  const palette = [QC_BG, ...pal].map((c) => c.map(Math.round));
  const gif = GIFEncoder();
  for (const c of res.cells) {
    const idx = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = c[Math.floor(y / scale) * res.cw + Math.floor(x / scale)];
      idx[y * W + x] = v < 0 ? 0 : v + 1;
    }
    gif.writeFrame(idx, W, H, { palette, delay: Math.round(1000 / fps) });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

/* ─── PixiJS atlas ─────────────────────────────────────────────────────────── */
function buildAtlas(results, pal) {
  const pad = 1;
  const W = Math.max(...results.map((r) => r.cw * r.cells.length)) + 2 * pad;
  let H = pad; const rows = results.map((r) => { const y = H; H += r.ch + pad; return y; });
  const out = new Uint8Array(W * H * 4);
  const frames = {}, animations = {};
  results.forEach((r, ri) => {
    const sheet = toRgba(r.cells, r.cw, r.ch, pal);
    for (let y = 0; y < sheet.H; y++) out.set(sheet.rgba.subarray(y * sheet.W * 4, (y + 1) * sheet.W * 4), ((rows[ri] + y) * W + pad) * 4);
    animations[r.id] = r.cells.map((_, i) => {
      const name = `${r.id}/${i}`;
      frames[name] = {
        frame: { x: pad + i * r.cw, y: rows[ri], w: r.cw, h: r.ch }, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: r.cw, h: r.ch }, sourceSize: { w: r.cw, h: r.ch }, anchor: { x: 0.5, y: 1 },
      };
      return name;
    });
  });
  const json = {
    frames, animations,
    meta: { app: "scripts/generate-assets.js", version: "1", image: "atlas.png", format: "RGBA8888", size: { w: W, h: H }, scale: "1",
      pixelRatio: 1 / SPRITE_DENSITY,     // one sprite pixel = this many scene (480x272) pixels
      fps: Object.fromEntries(results.map((r) => [r.id, r.fps])),
      note: "Pixel art on the scene's 480x272 grid: scale by the same factor as the background, with nearest-neighbour sampling. Anchor = feet (bottom-centre)." },
  };
  return { W, H, rgba: out, json };
}

/* ─── Main ─────────────────────────────────────────────────────────────────── */
async function main() {
  [DIR.raw, DIR.out, DIR.qc].forEach(ensureDir);
  const manifest = loadManifest();
  const only = list(args.only), regen = list(args.regenerate);
  const selected = SHEETS.filter((s) => !only.length || only.includes(s.id) || regen.includes(s.id));

  if (!args["no-generate"]) {
    // regenerate on request only, and at most API.maxAttempts times per sheet
    for (const id of regen) {
      const m = manifest.sheets[id] || { attempts: 0 };
      const raw = path.join(DIR.raw, id + ".png");
      if (m.attempts >= API.maxAttempts) { console.log(`! ${id}: already generated ${m.attempts} times; not regenerating (use the code-drawn fallback).`); continue; }
      if (fs.existsSync(raw)) fs.renameSync(raw, path.join(DIR.raw, `${id}.rejected-${m.attempts}.png`));
    }
    // chains run in order (a character's later actions use its first sheet as a reference); chains run in parallel
    const pending = selected.filter((s) => !fs.existsSync(path.join(DIR.raw, s.id + ".png")));
    const done = new Set(SHEETS.filter((s) => fs.existsSync(path.join(DIR.raw, s.id + ".png"))).map((s) => s.id));
    const runOne = async (s) => {
      const m = manifest.sheets[s.id] || { attempts: 0 };
      if (m.attempts >= API.maxAttempts) { console.log(`! ${s.id}: attempt limit reached, skipping.`); return; }
      const refs = s.refs.map((r) => path.join(DIR.refs, r)).concat((s.after || []).map((a) => path.join(DIR.raw, a + ".png")).filter(fs.existsSync));
      console.log(`… generating ${s.id} (${s.frames.length} frames, ${refs.length} reference images)`);
      try {
        const { png, quality } = await generate(s, refs);
        fs.writeFileSync(path.join(DIR.raw, s.id + ".png"), png);
        manifest.sheets[s.id] = { attempts: m.attempts + 1, model: API.model, quality, size: API.size, generated: new Date().toISOString() };
        saveManifest(manifest); done.add(s.id);
        console.log(`✓ ${s.id} (${quality})`);
      } catch (e) {
        // account, auth, rate-limit and network problems don't use up one of the sheet's attempts
        const msg = String(e.message || e);
        const counts = !/credit|billing|quota|rate limit|api key|unauthori|network|fetch failed|timeout|aborted/i.test(msg);
        manifest.sheets[s.id] = { ...m, attempts: m.attempts + (counts ? 1 : 0), lastError: msg };
        saveManifest(manifest);
        console.log(`✗ ${s.id}: ${e.message || e}`);
      }
    };
    const roots = pending.filter((s) => !s.after || s.after.every((a) => done.has(a) || !pending.some((p) => p.id === a)));
    const waiting = pending.filter((s) => !roots.includes(s));
    await Promise.all(roots.map(async (r) => {
      await runOne(r);
      for (const w of waiting.filter((x) => (x.after || []).includes(r.id))) await runOne(w);
    }));
  }

  // ── post-process every cached sheet
  const pal = buildPalette();
  if (!args["raw-dir"]) fs.writeFileSync(P("public", "assets", "palette.json"), JSON.stringify({ source: BACKGROUNDS.map(rel), colors: pal.map((c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("")) }, null, 2) + "\n");
  const snap = makeSnapper(pal);
  const results = [];
  for (const s of SHEETS) {
    const hasRaw = fs.existsSync(path.join(DIR.raw, s.id + ".png"));
    if (!hasRaw && !args.fallback) { console.log(`- ${s.id}: not generated (run with --fallback to draw it in code)`); continue; }
    try {
      const r = hasRaw ? processSheet(s, pal, snap) : fallbackSheet(s, pal);
      if (!hasRaw) { manifest.sheets[s.id] = { ...(manifest.sheets[s.id] || { attempts: 0 }), fallback: true }; saveManifest(manifest); }
      r.fps = s.fps; r.frameList = s.frames;
      const sheetImg = toRgba(r.cells, r.cw, r.ch, pal);
      writePng(path.join(DIR.out, s.id + ".png"), sheetImg.W, sheetImg.H, sheetImg.rgba);
      fs.writeFileSync(path.join(DIR.out, s.id + ".json"), JSON.stringify({ id: s.id, frames: r.cells.length, frameWidth: r.cw, frameHeight: r.ch, anchor: { x: 0.5, y: 1 }, fps: s.fps }, null, 2) + "\n");
      const cs = contactSheet(r, pal);
      writePng(path.join(DIR.qc, s.id + "-contact.png"), cs.W, cs.H, cs.rgba);
      fs.writeFileSync(path.join(DIR.qc, s.id + ".gif"), previewGif(r, pal, s.fps));
      results.push(r);
      console.log(`  ${s.id}: ${r.cells.length} frames of ${r.cw}x${r.ch}${r.warnings.length ? "  ⚠ " + r.warnings.join("; ") : ""}`);
    } catch (e) { console.log(`✗ ${s.id}: ${e.message}`); }
  }
  if (results.length) {
    const atlas = buildAtlas(results, pal);
    writePng(path.join(DIR.out, "atlas.png"), atlas.W, atlas.H, atlas.rgba);
    fs.writeFileSync(path.join(DIR.out, "atlas.json"), JSON.stringify(atlas.json, null, 2) + "\n");
    writeQcPage(results, manifest);
    console.log(`Atlas: ${rel(path.join(DIR.out, "atlas.png"))} (${atlas.W}x${atlas.H}), ${Object.keys(atlas.json.frames).length} frames. QC: ${rel(path.join(DIR.qc, "index.html"))}`);
  }
}

function writeQcPage(results, manifest) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = results.map((r) => {
    const m = manifest.sheets[r.id] || {};
    return `<section><h2>${esc(r.id)} <small>${r.cells.length} frames · ${r.cw}×${r.ch}px · ${r.fps} fps · attempt ${m.attempts || "?"} · ${esc(m.quality || "")}</small></h2>
<div class="row"><img class="gif" src="${esc(r.id)}.gif" alt="${esc(r.id)} preview"><img class="cs" src="${esc(r.id)}-contact.png" alt="${esc(r.id)} contact sheet"></div>
${r.warnings.length ? `<p class="warn">⚠ ${r.warnings.map(esc).join("<br>⚠ ")}</p>` : `<p class="ok">✓ no automatic warnings</p>`}
<ol>${r.frameList.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>
<p class="raw"><a href="../assets-src/raw/${esc(r.id)}.png">raw generation</a></p></section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sprite QC</title><style>
:root{--bg:#f5f3ef;--ink:#1a1918;--muted:#57534e;--line:#e4e0da}
body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,system-ui,sans-serif}
h1{font-weight:400;margin:0 0 4px}h2{font-size:18px;font-weight:500;margin:0 0 12px}small{color:var(--muted);font-weight:400;font-size:13px}
section{border-top:1px solid var(--line);padding:24px 0}.row{display:flex;gap:16px;align-items:flex-end;overflow-x:auto}
img{image-rendering:pixelated;display:block}.gif{flex:none}.cs{max-height:420px}
.warn{color:#9a3b1b}.ok{color:#3b7d22}ol{color:var(--muted);font-size:13px;margin:8px 0}.raw a{color:#3b7d22;font-size:13px}
</style></head><body><h1>Sprite QC</h1><p>Generated ${new Date().toLocaleString("en-GB")}. Frames on the scene's 480×272 pixel grid, shown enlarged. Red line = baseline.</p>
${rows}</body></html>`;
  fs.writeFileSync(path.join(DIR.qc, "index.html"), html);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
