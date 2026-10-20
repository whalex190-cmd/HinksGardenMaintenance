#!/usr/bin/env node
/*
 * npm run preview  ->  qc/contact-sheet.png (every frame, numbered) + qc/preview.mp4 (12 fps, x2 nearest-neighbour)
 * Reads assets/masters/frame_###.png. No API calls.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const sharp = require("sharp");
const ffmpeg = require("ffmpeg-static");
const px = require("./lib/pixel");

const cfg = px.readJson("assets/config.json");
const [W, H] = cfg.scene.native;
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const tag = typeof args.tag === "string" ? "-" + args.tag : "";
const dir = path.join(px.ROOT, "assets", "masters");
const files = fs.readdirSync(dir).filter((f) => /^frame_\d{3}\.png$/.test(f)).sort();

(async () => {
  px.ensureDir(path.join(px.ROOT, "qc"));
  // contact sheet: 10 columns of half-size thumbnails, frame numbers burned in
  const cols = 10, tw = W / 2, th = H / 2, rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map(async (f, i) => {
    const n = parseInt(f.slice(6, 9), 10);
    const label = Buffer.from(`<svg width="${tw}" height="${th}"><rect x="0" y="0" width="30" height="14" fill="#000" opacity=".7"/><text x="3" y="11" font-family="Consolas,monospace" font-size="11" fill="#ff0">${n}</text></svg>`);
    const input = await sharp(path.join(dir, f)).resize(tw, th, { kernel: "nearest" }).composite([{ input: label }]).png().toBuffer();
    return { input, left: (i % cols) * tw, top: Math.floor(i / cols) * th };
  }));
  await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: "#222" } }).composite(tiles).png().toFile(path.join(px.ROOT, "qc", `contact-sheet${tag}.png`));
  // MP4 at 12 fps, scaled x2 with nearest-neighbour so pixels stay square
  const out = path.join(px.ROOT, "qc", `preview${tag}.mp4`);
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-framerate", "12", "-i", path.join(dir, "frame_%03d.png"),
    "-vf", `scale=${W * 2}:${H * 2}:flags=neighbor`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", out], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  console.log(`qc/contact-sheet${tag}.png (${files.length} frames), qc/preview${tag}.mp4 (12 fps, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
