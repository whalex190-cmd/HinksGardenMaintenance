#!/usr/bin/env node
/*
 * npm run sprites                 estimate the API calls for every uncached sheet, ask to confirm, generate, then process + QC
 * npm run sprites -- --only=mower-walk,prop-mower      just these sheets
 * npm run sprites -- --group=mower                      sheets for one character (+ its props)
 * npm run sprites -- --force=mower-walk                 regenerate a cached sheet (max 2 attempts per sheet)
 * npm run sprites -- --yes                              skip the confirmation (non-interactive shells)
 * npm run sprites -- --no-generate                      process + QC only
 *
 * The key is read from process.env.OPENAI_API_KEY (or .env) and only ever goes in the Authorization header.
 * Every result is cached in assets/cache, keyed by a hash of the prompt + model + references.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const { GIFEncoder } = require("gifenc");
const px = require("./lib/pixel");
const sh = require("./lib/sheets");

const cfg = px.readJson("assets/config.json");
const cat = px.readJson("assets/sprites.json");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const list = (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const API = { model: "gpt-image-2.5-sunburst", qualities: ["max", "high"], size: "2304x768", maxAttempts: 2 };
const REF = (f) => path.join(px.ROOT, "assets", "reference", f);
const SCENE_REF = REF("scene-desktop.png");
const EXTRA_REFS = { "prop-mower": [REF("mower-model.png")] };

/* ── which sheets ── */
const groupOf = (s) => (s.id.startsWith("prop-mower") ? "mower" : s.character || (s.id.startsWith("prop-") || s.id.startsWith("ambient") ? propGroup(s.id) : null));
const propGroup = (id) => ({ "prop-planting": "planter", "prop-tray": "planter", "prop-soil": "planter", "prop-ladder": "hedge", "prop-branch": "tree", "prop-canopy": "tree" }[id] || "ambient");
let selected = cat.sheets;
if (args.only) selected = selected.filter((s) => list(args.only).includes(s.id));
if (args.group) selected = selected.filter((s) => list(args.group).includes(groupOf(s)));
const forced = list(args.force);

/* ── prompts ── */
function promptFor(s) {
  const who = s.character ? cat.characters[s.character] : null;
  const n = s.poses.length;
  const poses = s.poses.map((p, i) => `Frame ${i + 1}: ${typeof p === "string" ? p : p.name + " - " + p.desc}.`).join("\n");
  const subject = s.id.startsWith("model-")
    ? `a character model sheet of one ${who}, ${s.desc}. Each frame shows the same character from a different angle`
    : who ? `${who} (exactly the character in the reference model sheet), ${s.view ? "seen from the " + s.view + ", " : ""}${s.desc}` : `${s.desc}${s.view ? ", seen from the " + s.view : ""}`;
  return [
    `A pixel-art sprite sheet of ${subject}.`,
    `Exactly ${n} frames in ONE single horizontal row, left to right, in ${n} equal-width cells across the whole image, with clear empty space between frames.`,
    "The background is solid, flat, pure magenta #FF00FF filling the entire image: no gradient, no ground, no shadow, no grid lines, no borders, no text, no numbers. Use no magenta or hot pink in the subject.",
    cat.style,
    "Match the pixel density, palette and lighting of the reference garden scene. Same scale in every frame; every figure stands on the same baseline near the bottom of its cell, centred in its cell. Every frame is a different pose; no two frames are the same.",
    poses,
  ].join("\n");
}
function refsFor(s) {
  const refs = [SCENE_REF];
  if (s.character && !s.id.startsWith("model-")) {
    const model = sh.cachedFile("model-" + s.character);
    if (!model) return null;                            // model sheet must exist first
    refs.unshift(model);
  }
  return refs.concat(EXTRA_REFS[s.id] || []);
}
const hashFor = (s, refs) => crypto.createHash("sha256").update(JSON.stringify({ m: API.model, size: API.size, p: promptFor(s), r: refs.map((r) => path.basename(r)) })).digest("hex").slice(0, 16);

/* ── API ── */
function apiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const f = path.join(px.ROOT, ".env");
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error("OPENAI_API_KEY is not set (add it to .env).");
}
async function callApi(s, refs) {
  let lastErr;
  for (const quality of API.qualities) {
    const form = new FormData();
    for (const [k, v] of Object.entries({ model: API.model, prompt: promptFor(s), size: API.size, quality, n: "1", output_format: "png", background: "opaque" })) form.append(k, v);
    for (const r of refs) form.append("image[]", new Blob([fs.readFileSync(r)], { type: "image/png" }), path.basename(r));
    const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form, signal: AbortSignal.timeout(15 * 60 * 1000) });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data && body.data[0] && body.data[0].b64_json) return { png: Buffer.from(body.data[0].b64_json, "base64"), quality };
    lastErr = (body.error && body.error.message) || `HTTP ${res.status}`;
    if (!/quality/i.test(lastErr)) break;
  }
  throw new Error(lastErr);
}
const confirm = (q) => new Promise((resolve) => {
  if (!process.stdin.isTTY) return resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); });
});

async function generate() {
  const ix = sh.loadIndex();
  // order: model sheets first (other sheets use them as references)
  const order = selected.slice().sort((a, b) => (a.id.startsWith("model-") ? 0 : 1) - (b.id.startsWith("model-") ? 0 : 1));
  const todo = order.filter((s) => forced.includes(s.id) || !sh.cachedFile(s.id) || ix.sheets[s.id].hash !== hashFor(s, refsFor(s) || []));
  const blocked = todo.filter((s) => (ix.sheets[s.id] || {}).attempts >= API.maxAttempts && forced.includes(s.id));
  const run = todo.filter((s) => !blocked.includes(s));
  if (blocked.length) console.log(`Attempt limit reached (draw in code instead): ${blocked.map((s) => s.id).join(", ")}`);
  if (!run.length) { console.log("Nothing to generate: every selected sheet is cached."); return 0; }
  console.log(`API estimate: ${run.length} call(s), model ${API.model}, quality max, ${API.size}:\n  ${run.map((s) => s.id).join("\n  ")}`);
  if (!args.yes && !(await confirm("Generate now? [y/N] "))) { console.log("Not confirmed: nothing generated. (Re-run with --yes to confirm in a non-interactive shell.)"); return 0; }
  let calls = 0;
  for (const s of run) {
    const refs = refsFor(s);
    if (!refs) { console.log(`- ${s.id}: waiting for model-${s.character}`); continue; }
    const hash = hashFor(s, refs), prev = ix.sheets[s.id] || { attempts: 0 };
    process.stdout.write(`… ${s.id} (${s.poses.length} poses, ${refs.length} refs) `);
    try {
      calls++;
      const { png, quality } = await callApi(s, refs);
      const file = `${s.id}-${hash}.png`;
      fs.writeFileSync(path.join(sh.CACHE, file), png);
      ix.sheets[s.id] = { file, hash, attempts: (prev.attempts || 0) + 1, quality, generated: new Date().toISOString() };
      console.log(`✓ ${quality}`);
    } catch (e) {
      const msg = String(e.message || e), billing = /credit|billing|quota|rate limit|api key|unauthori|network|fetch failed|timeout/i.test(msg);
      ix.sheets[s.id] = { ...prev, attempts: (prev.attempts || 0) + (billing ? 0 : 1), lastError: msg };
      console.log(`✗ ${msg}`);
    }
    ix.calls.push({ at: new Date().toISOString(), sheet: s.id });
    sh.saveIndex(ix);
  }
  console.log(`API calls made this run: ${calls}`);
  return calls;
}

/* ── processing + QC ── */
const QC_BG = [96, 108, 96];
function process1(s) {
  const sheet = sh.loadSheet(s, cfg);
  if (!sheet) return null;
  const fit = cfg.spriteFit[s.id] ?? cfg.spriteFit.default;
  const frames = s.poses.map((_, i) => sh.frame(sheet, i, fit));
  const left = Math.max(...frames.map((f) => f.ax)), right = Math.max(...frames.map((f) => f.w - f.ax));
  const cw = left + right + 2, ch = Math.max(...frames.map((f) => f.h)) + 1;
  const cells = frames.map((f) => {
    const c = new Int16Array(cw * ch).fill(-1), ox = left + 1 - f.ax, oy = ch - f.h;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) c[(oy + y) * cw + ox + x] = f.idx[y * f.w + x];
    return c;
  });
  const pal = sheet.pal, n = cells.length, W = cw * n;
  const strip = { w: W, h: ch, idx: new Int16Array(W * ch).fill(-1) };
  cells.forEach((c, f) => { for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) strip.idx[y * W + f * cw + x] = c[y * cw + x]; });
  px.writePng(`assets/sprites/${s.id}.png`, px.idxToRgba(strip, pal));
  fs.writeFileSync(path.join(px.ROOT, "assets", "sprites", s.id + ".json"), JSON.stringify({ id: s.id, poses: s.poses.map((p) => p.name || p), cell: [cw, ch], anchorX: left + 1, fit }, null, 1) + "\n");
  // QC contact sheet (x6 on grey, red baseline) + GIF
  const S = 6, gap = 2, CW = cw * S, CH = ch * S, QW = n * CW + (n + 1) * gap * S, QH = CH + 2 * gap * S, q = new Uint8Array(QW * QH * 4);
  for (let i = 0; i < q.length; i += 4) { q[i] = 70; q[i + 1] = 80; q[i + 2] = 70; q[i + 3] = 255; }
  cells.forEach((c, f) => {
    const ox = gap * S + f * (CW + gap * S);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const v = c[Math.floor(y / S) * cw + Math.floor(x / S)], o = ((gap * S + y) * QW + ox + x) * 4;
      const col = v >= 0 ? pal[v] : y >= CH - S ? [200, 70, 70] : QC_BG;
      q[o] = col[0]; q[o + 1] = col[1]; q[o + 2] = col[2];
    }
  });
  px.writePng(`qc/sprites/${s.id}-contact.png`, { w: QW, h: QH, data: q });
  const gif = GIFEncoder(), gpal = [QC_BG, ...pal];
  for (const c of cells) {
    const idx = new Uint8Array(CW * CH);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const v = c[Math.floor(y / S) * cw + Math.floor(x / S)]; idx[y * CW + x] = v < 0 ? 0 : v + 1; }
    gif.writeFrame(idx, CW, CH, { palette: gpal, delay: 1000 / 6 });
  }
  gif.finish();
  fs.writeFileSync(path.join(px.ROOT, "qc", "sprites", s.id + ".gif"), Buffer.from(gif.bytes()));
  const hs = frames.map((f) => f.h);
  return `${s.id}: ${n} poses, cell ${cw}x${ch}, heights ${Math.min(...hs)}-${Math.max(...hs)}px${sheet.method !== "gaps" ? "  ⚠ frames not cleanly separated" : ""}`;
}

(async () => {
  px.ensureDir(sh.CACHE); px.ensureDir(path.join(px.ROOT, "assets", "sprites")); px.ensureDir(path.join(px.ROOT, "qc", "sprites"));
  if (!args["no-generate"]) await generate();
  for (const s of selected) { const r = process1(s); console.log(r ? "  " + r : `- ${s.id}: not generated`); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
