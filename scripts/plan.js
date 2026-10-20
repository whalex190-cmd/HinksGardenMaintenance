#!/usr/bin/env node
/*
 * npm run plan  ->  assets/frames.json (+ a readable summary on stdout)
 * Expands assets/config.json into one entry per frame: each station's pose (sheet/pose/index), position and
 * scale, prop states, particle seeds and per-region tidy progress. No API calls.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
const cfg = readJson(path.join(ROOT, "assets", "config.json"));
const sprites = readJson(path.join(ROOT, "assets", "sprites.json"));
const regions = readJson(path.join(ROOT, cfg.scene.regions));
const N = cfg.frameCount;

/* ── helpers ── */
const sheetPoses = Object.fromEntries(sprites.sheets.map((s) => [s.id, s.poses.map((p) => (typeof p === "string" ? p : p.name))]));
const pose = (sheet, name) => {
  const i = sheetPoses[sheet].indexOf(name);
  if (i < 0) throw new Error(`pose ${sheet}/${name} not in sprites.json`);
  return { sheet, pose: name, index: i };
};
const inR = (f, [a, b]) => f >= a && f <= b;
const prog = (f, [a, b]) => (b === a ? 1 : Math.min(1, Math.max(0, (f - a) / (b - a))));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const r4 = (v) => Math.round(v * 10000) / 10000;
// spread `names` evenly over a frame range (a held pose lasts several frames)
const spread = (f, range, names) => names[Math.min(names.length - 1, Math.floor(prog(f, [range[0], range[1] + 1]) * names.length))];

/* ── lawn geometry (same maths as the engine) ── */
const L = regions.lawn;
const halfW = (y) => (L.halfNear * (y - L.vpY)) / (L.nearY - L.vpY);
const stripeX = (k, y) => L.vpX - halfW(y) + (2 * halfW(y) * (k + 0.5)) / L.stripes;
const scaleAtY = (y) => (y - L.vpY) / (cfg.mower.start.y - L.vpY);           // perspective, 1 at the start point
const yAtScale = (s) => L.vpY + s * (cfg.mower.start.y - L.vpY);

/* ── stations ── */
function mower(f) {
  const M = cfg.mower, R = M.ranges, y0 = M.start.y, y1 = yAtScale(M.end.scale);
  const walkFrames = R.walk[1] - R.walk[0] + 1;
  // distance covered: ease in over 10-11, constant through the walk, ease out over 108-112
  const total = walkFrames + 1 + 2.5;           // walk + ease-in share + slow-down share, in "frame units" of travel
  let d = 0;
  if (f >= R.easeIn[0]) d += Math.min(1, prog(f, R.easeIn)) * 1;
  if (f >= R.walk[0]) d += Math.min(walkFrames, f - R.walk[0] + 1);
  if (f >= R.slow[0]) d += 2.5 * Math.sin((Math.PI / 2) * prog(f, R.slow));
  const t = Math.min(1, d / total);
  const y = lerp(y0, y1, t), x = stripeX(M.stripe, y), scale = scaleAtY(y);
  let p, extras = {};
  if (inR(f, R.idle)) p = pose("mower-start", inR(f, R.postureShift) ? "shift" : "idle");
  else if (inR(f, R.easeIn)) p = pose("mower-start", f === R.easeIn[0] ? "lean" : "first-step");
  else if (inR(f, R.walk)) {
    const i = (f - R.walk[0]) % 8;
    p = pose("mower-walk", "P" + (i + 1));
    extras = { hatLagFrame: i === 0 ? 7 : i - 1, exhaust: (f - R.walk[0]) % M.exhaustEvery === 0, clippings: i % 4 === 0 };
  } else if (inR(f, R.slow)) p = pose("mower-finish", f < R.slow[1] - 1 ? "half-step" : "stop");
  else if (inR(f, R.wipeBrow)) p = pose("mower-finish", ["hand-off", "wipe-1", "wipe-2", "hand-off"][f - R.wipeBrow[0]]);
  else p = pose("mower-finish", "rest");
  const moving = f >= R.easeIn[0] && f <= R.slow[1];
  return {
    ...p, x: r4(x), y: r4(y), scale: r4(scale),
    props: {
      mower: pose("prop-mower", "wheels-" + "abc"[Math.floor(d / 2) % M.wheelPhases]),
      jitterPx: moving ? (f % 2) * M.jitterPx : 0,
      cutStripe: { stripe: M.stripe, toY: r4(y), ragged: M.cutLineRaggedPx },
      ...extras,
    },
  };
}

function planter(f) {
  const P = cfg.planter, R = P.ranges;
  const moved = inR(f, R.shuffle) ? P.shufflePx * ease(prog(f, R.shuffle)) : f > R.shuffle[1] ? P.shufflePx : 0;
  let p;
  const dig = (range) => pose("planter-dig", sheetPoses["planter-dig"][(f - range[0]) % 8]);
  if (inR(f, R.stand)) p = pose("planter-kneel", "stand-look");
  else if (inR(f, R.kneel)) p = pose("planter-kneel", ["step", "bend", "knee-lower", "knee-touch", "settle", "lean"][f - R.kneel[0]]);
  else if (inR(f, R.dig1)) p = dig(R.dig1);
  else if (inR(f, R.trowelDown)) p = pose("planter-move", "lay-trowel");
  else if (inR(f, R.unpot1)) p = spread(f, R.unpot1, [
    ["planter-unpot-a", "reach"], ["planter-unpot-a", "lift"], ["planter-unpot-a", "invert"], ["planter-unpot-a", "tap-1"], ["planter-unpot-a", "tap-2"],
    ["planter-unpot-b", "slide-off"], ["planter-unpot-b", "toss"], ["planter-unpot-b", "tease"], ["planter-unpot-b", "upright"],
    ["planter-unpot-b", "lower"], ["planter-unpot-b", "release"]]).reduce((s, n) => pose(s, n));
  else if (inR(f, R.backfill1)) p = spread(f, R.backfill1, [
    ["planter-backfill", "sweep-reach"], ["planter-backfill", "sweep-pull"], ["planter-backfill", "sweep-reach"], ["planter-backfill", "sweep-pull"],
    ["planter-backfill", "press"], ["planter-backfill", "sit-back"], ["planter-backfill", "look"]]).reduce((s, n) => pose(s, n));
  else if (inR(f, R.shuffle)) p = pose("planter-move", spread(f, R.shuffle, ["shuffle-1", "shuffle-2", "shuffle-3", "shuffle-1", "shuffle-2", "shuffle-3", "pick-trowel"]));
  else if (inR(f, R.dig2)) p = dig(R.dig2);
  else if (inR(f, R.unpot2)) p = spread(f, R.unpot2, [
    ["planter-unpot-a", "reach"], ["planter-unpot-a", "lift"], ["planter-unpot-a", "invert"], ["planter-unpot-a", "tap-1"],
    ["planter-unpot-b", "slide-off"], ["planter-unpot-b", "toss"], ["planter-unpot-b", "upright"], ["planter-unpot-b", "lower"], ["planter-unpot-b", "release"]]).reduce((s, n) => pose(s, n));
  else if (inR(f, R.backfill2)) p = spread(f, R.backfill2, [
    ["planter-backfill", "sweep-reach"], ["planter-backfill", "sweep-pull"], ["planter-backfill", "press"], ["planter-backfill", "sit-back"], ["planter-backfill", "look"]]).reduce((s, n) => pose(s, n));
  else if (inR(f, R.standUp)) p = pose("planter-kneel", ["lean", "knee-touch", "knee-lower", "bend", "stand-look"][f - R.standUp[0]]);   // the kneel played in reverse
  else if (inR(f, R.brush)) p = pose("planter-finish", (f - R.brush[0]) % 2 ? "clap-2" : "clap-1");
  else p = pose("planter-finish", f < R.admire[0] + 2 ? "hips" : "admire");

  // holes and mounds
  const stage = (stages) => stages.reduce((s, r, i) => (f >= r[0] ? i : s), -1);
  const hole1 = f < R.dig1[0] ? null : f > R.backfill1[1] ? "planted" : ["hole-scuffed", "hole-shallow", "hole-deep"][Math.max(0, stage(P.hole1Stages))];
  const hole2 = f < R.dig2[0] ? null : f > R.backfill2[1] ? "planted" : ["hole-scuffed", "hole-shallow", "hole-deep"][Math.max(0, stage(P.hole2Stages))];
  const moundFor = (dig, fill) => {
    if (f < dig[0]) return null;
    if (f <= dig[1]) return "mound-" + (1 + Math.min(3, Math.floor(prog(f, dig) * 4)));
    if (f < fill[0]) return "mound-4";
    if (f <= fill[0] + 5) return ["mound-4", "mound-3", "mound-2", "mound-1"][Math.min(3, Math.floor((f - fill[0]) / 1.5))];
    return null;
  };
  const lavender = f < R.unpot1[0] ? "lavender-pot" : f <= R.unpot1[1] ? (prog(f, R.unpot1) < 0.45 ? "lavender-pot" : "lavender-rootball") : "lavender-planted";
  const geranium = f < R.unpot2[0] ? "geranium-pot" : f <= R.unpot2[1] ? (prog(f, R.unpot2) < 0.45 ? "geranium-pot" : "geranium-rootball") : "geranium-planted";
  const tray = f < R.unpot1[0] + 2 ? "tray-two" : f < R.unpot2[0] + 2 ? "tray-one" : "tray-empty";
  const pot = f < R.unpot1[0] + 6 ? null : f <= R.backfill2[1] ? (f < R.unpot2[0] + 5 ? "pot-upturned" : "pot-stack") : "pot-upright";
  return {
    ...p, x: P.x, y: P.y, offsetPx: Math.round(moved),
    props: {
      hole1, hole2, mound1: moundFor(R.dig1, R.backfill1), mound2: moundFor(R.dig2, R.backfill2),
      lavender, geranium, tray, pot,
      dustPuff: [R.kneel[0] + 3, R.backfill1[0] + 7, R.backfill2[0] + 5].includes(f),
      soilKick: p.sheet === "planter-dig" && (p.pose === "strike" || p.pose === "tip"),
      borderTidy: r4(Math.max(prog(f, [R.backfill1[0], R.backfill1[1]]) * 0.5, f >= R.backfill2[0] ? 0.5 + prog(f, R.backfill2) * 0.5 : 0)),
    },
  };
}

function hedge(f) {
  const H = cfg.hedge, R = H.ranges;
  let p, snip = -1, phase = -1;
  if (inR(f, R.idle)) p = pose("hedge-start", "idle");
  else if (inR(f, R.raise)) p = pose("hedge-start", ["shift", "raise", "raise", "ready"][f - R.raise[0]]);
  else if (inR(f, R.snips)) {
    snip = Math.floor((f - R.snips[0]) / H.snipFrames); phase = (f - R.snips[0]) % H.snipFrames;
    p = pose("hedge-snip", sheetPoses["hedge-snip"][phase]);
  } else if (inR(f, R.finalSnip)) p = pose("hedge-snip", sheetPoses["hedge-snip"][f - R.finalSnip[0]]);
  else if (inR(f, R.check)) p = pose("hedge-finish", spread(f, R.check, ["final", "lower", "check", "check"]));
  else p = pose("hedge-finish", f < R.rest[0] + 2 ? "shoulder" : "idle");
  const closes = (fr) => (fr < R.snips[0] ? 0 : Math.min(H.sections, Math.floor((fr - R.snips[0] - 2) / H.snipFrames) + 1));
  const trimmed = f >= R.finalSnip[0] + 2 ? H.sections : Math.max(0, closes(f));
  const lastCut = trimmed ? R.snips[0] + (trimmed - 1) * H.snipFrames + 2 : null;
  const snipsDone = Math.max(0, snip);
  return {
    ...p, x: H.x, y: H.y, reachPx: Math.floor(snipsDone / H.reachEvery) * H.reachPx % (H.reachPx * 3),
    props: {
      ladder: pose("prop-ladder", "ladder"),
      ladderWobblePx: snip >= 0 && snip % H.wobbleEvery === 0 && phase === 2 ? 1 : 0,
      sectionsTrimmed: trimmed, faceTidied: Math.max(0, closes(f - H.snipFrames)),
      freshness: lastCut === null ? 0 : r4(Math.max(0, 1 - (f - lastCut) / H.freshFadeFrames)),
      leafBurst: phase === 2 || f === R.finalSnip[0] + 2,
      pile: trimmed === 0 ? null : "pile-" + Math.min(3, 1 + Math.floor(trimmed / 7)),
    },
  };
}

function tree(f) {
  const T = cfg.tree, R = T.ranges, B = T.branch;
  let p;
  const cut = (sheet, range, withdraw) => {
    if (withdraw && f >= range[1] - 1) return pose(sheet, sheet === "tree-undercut" ? "withdraw" : "flinch");
    if (f === range[0]) return pose(sheet, sheet === "tree-undercut" ? "enter" : "reposition");
    return pose(sheet, f % 2 ? "cut-a" : "cut-b");                 // alternating = 1px vibration
  };
  if (inR(f, R.idle)) p = pose("tree-prep", "hang-idle");
  else if (inR(f, R.reposition)) p = pose("tree-prep", ["step-feet", "step-feet", "pull-rope", "settle", "settle"][f - R.reposition[0]]);
  else if (inR(f, R.startSaw)) p = pose("tree-start", ["unclip", "cord-pull-1", "cord-snap", "cord-pull-2", "cord-snap", "running", "running"][f - R.startSaw[0]]);
  else if (inR(f, R.undercut)) p = cut("tree-undercut", R.undercut, true);
  else if (inR(f, R.topCut)) p = cut("tree-topcut", R.topCut, false);
  else if (inR(f, R.crack)) p = pose("tree-topcut", "flinch");
  else if (inR(f, R.lower)) p = pose("tree-prep", f < R.lower[0] + 10 ? "pull-rope" : "settle");
  else if (inR(f, R.flushCut)) p = pose("tree-finish", f % 2 ? "flush-a" : "flush-b");
  else if (inR(f, R.stopSaw)) p = pose("tree-finish", f < R.stopSaw[0] + 3 ? "stop" : "clip");
  else p = pose("tree-finish", "look-down");

  // kerf: undercut grows to 1/3 depth, then the top cut grows down to meet it
  const under = f < R.undercut[0] ? 0 : r4(T.undercutDepth * prog(f, [R.undercut[0], R.undercut[1] - 2]));
  const top = f < R.topCut[0] ? 0 : r4((1 - T.undercutDepth) * prog(f, R.topCut));
  // branch: attached, sagging, then lowered on the rope in an eased arc with a pendulum overshoot
  let branch;
  if (f < R.lower[0]) {
    const sag = Object.entries(T.sag).reduce((s, [fr, px]) => (f >= +fr ? px : s), 0);
    branch = { pose: sag ? "sag" : "attached", x: B.x, y: B.y, sagPx: sag, alpha: 1 };
  } else if (f <= R.lower[1]) {
    const t = prog(f, R.lower), e = ease(t), swing = Math.sin(t * Math.PI * 2.5) * (1 - t) * 0.012;
    const poseName = t < 0.15 ? "swing-1" : t < 0.45 ? "swing-2" : t < 0.85 ? "swing-3" : "on-ground";
    branch = { pose: poseName, x: r4(lerp(B.x, B.landX, e) + swing), y: r4(lerp(B.y, B.landY, e)), bouncePx: f === R.lower[1] - 2 ? 1 : 0, alpha: 1 };
  } else branch = { pose: "on-ground", x: B.landX, y: B.landY, alpha: r4(1 - prog(f, T.branchFade)) };
  return {
    ...p, x: T.x, y: T.y,
    props: {
      sawRunning: f >= R.startSaw[0] + 4 && f < R.stopSaw[0] + 2,
      vibrationPx: inR(f, R.undercut) || inR(f, R.topCut) || inR(f, R.flushCut) ? f % 2 : 0,
      smoke: [R.startSaw[0] + 4, R.stopSaw[0]].includes(f),
      sawdust: inR(f, [R.undercut[0], R.undercut[1] - 2]) || inR(f, R.topCut) || inR(f, R.flushCut),
      kerf: { under, top }, crackFlash: inR(f, R.crack),
      canopySpringPx: inR(f, T.canopySpring.frames) ? T.canopySpring.px : 0,
      canopyHealed: r4(prog(f, T.canopyHeal) * (f >= T.canopyHeal[0] ? 1 : 0)),
      branch: { ...pose("prop-branch", branch.pose), ...branch },
    },
  };
}

/* ── scenery + ambient ── */
function scenery(f) {
  const G = cfg.global;
  const t = f <= G.untidyUntil ? 0 : f >= G.fullyTidyFrom ? 1 : r4(prog(f, [G.tidyFrom, G.tidyTo]));
  return { tidyProgress: { unassigned: t, direction: G.direction, feather: G.maskFeather } };
}
function ambient(f) {
  const A = cfg.ambient, b = A.butterfly;
  const bt = prog(f, b.frames);
  return {
    mistOffsetPx: r4(f * A.mistPxPerFrame), poolShimmerPhase: f % A.poolShimmerRows, flowerSway: Math.floor(f / A.flowerSwayPeriod) % 2,
    sunRisePx: r4((A.sunRisePx * (f - 1)) / (N - 1)),
    butterfly: inR(f, b.frames) ? { pose: "wing-" + (1 + (f % 4)), x: r4(lerp(b.from[0], b.to[0], bt)), y: r4(lerp(b.from[1], b.to[1], bt) + Math.sin(bt * 12) * 0.01) } : null,
    particleSeed: A.seed + f,
  };
}

/* ── build ── */
const frames = [];
for (let f = 1; f <= N; f++) frames.push({ frame: f, scenery: scenery(f), mower: mower(f), planter: planter(f), hedge: hedge(f), tree: tree(f), ambient: ambient(f) });
const out = { generated: new Date().toISOString(), frameCount: N, native: cfg.scene.native, frames };
fs.writeFileSync(path.join(ROOT, "assets", "frames.json"), JSON.stringify(out, null, 1) + "\n");

/* ── summary ── */
const used = new Map();
for (const fr of frames) for (const st of ["mower", "planter", "hedge", "tree"]) {
  const key = fr[st].sheet + "/" + fr[st].pose; used.set(key, (used.get(key) || 0) + 1);
}
const charSheets = sprites.sheets.filter((s) => s.character && !s.id.startsWith("model-"));
const propSheets = sprites.sheets.filter((s) => !s.character);
const models = sprites.sheets.filter((s) => s.id.startsWith("model-"));
const allPoses = charSheets.reduce((a, s) => a + s.poses.length, 0);
const unusedPoses = charSheets.flatMap((s) => s.poses.map((p) => s.id + "/" + p.name)).filter((k) => !used.has(k));
console.log(`assets/frames.json written: ${N} frames.`);
console.log(`Mower travels from y=${cfg.mower.start.y} to y=${r4(yAtScale(cfg.mower.end.scale))} on stripe ${cfg.mower.stripe} (x ${r4(stripeX(cfg.mower.stripe, cfg.mower.start.y))}), scale 1 -> ${cfg.mower.end.scale}.`);
console.log(`Unique character poses: ${allPoses} in ${charSheets.length} sheets; poses used by the plan: ${used.size}.`);
if (unusedPoses.length) console.log(`Poses defined but not used yet: ${unusedPoses.join(", ")}`);
console.log(`Sheets to generate: ${models.length} model + ${charSheets.length} character + ${propSheets.length} prop = ${sprites.sheets.length} API calls (worst case with one retry each: ${sprites.sheets.length * 2}).`);
