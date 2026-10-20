/*
 * Code-drawn fallback sprites (pixel arrays), used when OpenAI generation fails.
 * Every frame is drawn directly on the scene's 480x272 pixel grid with colours from the background palette,
 * then goes through the same alignment, atlas and QC steps as generated sheets.
 *
 * The gardener is a small posable rig: named joints per frame, drawn as thick pixel lines and blocks,
 * then given a 1px dark outline. Views: side (facing right), back, front.
 */
"use strict";

const W = 48, H = 56, G = H - 2;        // drawing canvas per frame; G = ground row

// Target colours, snapped to the nearest background-palette colour at draw time.
const COLOURS = {
  outline: [38, 30, 26], skin: [226, 170, 128], skinDark: [186, 124, 92], hair: [92, 60, 40],
  hat: [222, 186, 110], hatDark: [176, 140, 76], band: [44, 82, 52],
  shirt: [242, 240, 232], shirtShade: [198, 200, 206], trousers: [110, 128, 62], trousersDark: [80, 96, 46],
  boots: [104, 66, 40], gloves: [52, 92, 56],
  mower: [204, 52, 40], mowerDark: [142, 36, 32], black: [40, 38, 40], grey: [150, 150, 150], steel: [196, 200, 204],
  wood: [168, 118, 70], woodDark: [120, 80, 46], rope: [210, 180, 120], helmet: [210, 56, 44], harness: [60, 60, 70],
  terracotta: [196, 108, 70], terracottaDark: [150, 78, 52], soil: [104, 70, 46], soilDark: [74, 50, 34],
  leaf: [86, 150, 60], leafDark: [52, 104, 44], flower: [246, 210, 80], bark: [110, 78, 52], clipping: [130, 190, 80], dust: [214, 190, 140],
};

function makeCanvas() { return { w: W, h: H, idx: new Int16Array(W * H).fill(-1) }; }

function painter(pal) {
  const nearest = {};
  const dist = (a, b) => (a[0] - b[0]) ** 2 * 2 + (a[1] - b[1]) ** 2 * 4 + (a[2] - b[2]) ** 2 * 3;
  for (const [k, c] of Object.entries(COLOURS)) {
    let best = 0; pal.forEach((p, j) => { if (dist(p, c) < dist(pal[best], c)) best = j; }); nearest[k] = best;
  }
  return nearest;
}

/* ── primitives ── */
function px(cv, x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < cv.w && y < cv.h) cv.idx[y * cv.w + x] = c; }
function rect(cv, x0, y0, x1, y1, c) { for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) px(cv, x, y, c); }
function line(cv, a, b, c, thick = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n;
    if (thick <= 1) px(cv, x, y, c);
    else { const r = (thick - 1) / 2; rect(cv, x - r, y - r, x + r - (thick % 2 ? 0 : 1), y + r - (thick % 2 ? 0 : 1), c); }
  }
}
function disc(cv, cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) px(cv, cx + x, cy + y, c); }
function outline(cv, c) {
  const add = [];
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    if (cv.idx[y * cv.w + x] >= 0) continue;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < cv.w && yy < cv.h && cv.idx[yy * cv.w + xx] >= 0 && cv.idx[yy * cv.w + xx] !== c;
    });
    if (n) add.push(y * cv.w + x);
  }
  for (const i of add) cv.idx[i] = c;
}
const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/* ── the gardener rig ──
   pose: { view: 'side'|'back'|'front', hip:[x,y], shoulder:[x,y], head:[x,y],
           legs: [[knee, foot], [knee, foot]] (back leg first), arms: [[elbow, hand], [elbow, hand]] (back arm first),
           hat: 'straw'|'helmet' } */
function drawGardener(cv, C, p) {
  const leg = ([knee, foot], far) => {
    line(cv, p.hipAt ? p.hipAt(far) : p.hip, knee, far ? C.trousersDark : C.trousers, 3);
    line(cv, knee, foot, far ? C.trousersDark : C.trousers, 3);
    const dir = p.view === "side" ? 1 : 0;
    rect(cv, foot[0] - 1, foot[1] - 1, foot[0] + 1 + dir, foot[1], C.boots);
  };
  const arm = ([elbow, hand], far, sh) => {
    line(cv, sh, elbow, far ? C.shirtShade : C.shirt, 2);
    line(cv, elbow, hand, C.skin, 2);
    rect(cv, hand[0] - 1, hand[1] - 1, hand[0], hand[1], C.gloves);
  };
  const shL = p.view === "side" ? p.shoulder : [p.shoulder[0] - 3, p.shoulder[1]];
  const shR = p.view === "side" ? p.shoulder : [p.shoulder[0] + 3, p.shoulder[1]];

  if (p.view === "side") arm(p.arms[0], true, shL);
  leg(p.legs[0], p.view === "side");
  if (p.view !== "side") leg(p.legs[1], false);
  // torso: a block from shoulders to hips
  const t0 = p.shoulder, t1 = p.hip;
  const half = p.view === "side" ? 2 : 3;
  for (let i = 0; i <= 10; i++) { const q = lerpP(t0, t1, i / 10); rect(cv, q[0] - half, q[1], q[0] + half - (p.view === "side" ? 1 : 0), q[1], C.shirt); }
  rect(cv, t1[0] - half, t1[1] - 1, t1[0] + half - (p.view === "side" ? 1 : 0), t1[1], C.trousersDark);   // belt
  if (p.harness) { rect(cv, t1[0] - half, t1[1] - 2, t1[0] + half, t1[1], C.harness); }
  if (p.view === "side") leg(p.legs[1], false);
  // head
  const [hx, hy] = p.head;
  rect(cv, hx - 2, hy - 2, hx + 2, hy + 2, p.view === "back" ? C.hair : C.skin);
  if (p.view === "side") { px(cv, hx + 1, hy, C.outline); px(cv, hx - 2, hy - 1, C.hair); px(cv, hx - 2, hy, C.hair); }
  if (p.view === "front") { px(cv, hx - 1, hy, C.outline); px(cv, hx + 1, hy, C.outline); px(cv, hx, hy + 2, C.skinDark); }
  if (p.hat === "helmet") { rect(cv, hx - 3, hy - 4, hx + 3, hy - 2, C.helmet); rect(cv, hx - 2, hy - 5, hx + 2, hy - 5, C.helmet); }
  else {
    rect(cv, hx - 5, hy - 3, hx + 5, hy - 3, C.hat);                    // brim
    rect(cv, hx - 3, hy - 6, hx + 3, hy - 4, C.hat);                    // crown
    rect(cv, hx - 3, hy - 4, hx + 3, hy - 4, C.band);                   // band
    px(cv, hx - 5, hy - 3, C.hatDark); px(cv, hx + 5, hy - 3, C.hatDark);
  }
  if (p.view === "side") arm(p.arms[1], false, shR);
  else { arm(p.arms[0], true, shL); arm(p.arms[1], false, shR); }
}

/* Standing / kneeling side poses (facing right). dx shifts the whole figure. */
function sidePose(kind, o = {}) {
  const dx = o.dx || 0;
  if (kind === "stand") {
    return { view: "side", hip: [20 + dx, G - 13], shoulder: [21 + dx, G - 22], head: [22 + dx, G - 26],
      legs: [[[19 + dx, G - 6], [18 + dx, G]], [[21 + dx, G - 6], [22 + dx, G]]], arms: o.arms };
  }
  if (kind === "kneel") {          // upright kneel on both knees, shins flat behind
    const lean = o.lean || 0;
    return { view: "side", hip: [19 + dx, G - 7], shoulder: [20 + dx + lean, G - 16 + Math.abs(lean) / 2], head: [21 + dx + lean * 1.3, G - 20 + Math.abs(lean) / 2],
      legs: [[[22 + dx, G - 1], [14 + dx, G]], [[23 + dx, G - 1], [15 + dx, G]]], arms: o.arms };
  }
  if (kind === "heels") {          // sitting back on heels
    return { view: "side", hip: [16 + dx, G - 4], shoulder: [17 + dx, G - 13], head: [18 + dx, G - 17],
      legs: [[[22 + dx, G - 1], [14 + dx, G]], [[23 + dx, G - 1], [15 + dx, G]]], arms: o.arms };
  }
  throw new Error(kind);
}

/* ── props ── */
function pot(cv, C, x, y, s = 1) {           // (x,y) = bottom-centre
  rect(cv, x - 2 * s, y - 3 * s, x + 2 * s, y, C.terracotta);
  rect(cv, x - 3 * s, y - 4 * s, x + 3 * s, y - 3 * s - (s > 1 ? 1 : 0), C.terracottaDark);
  px(cv, x - 2 * s, y, C.terracottaDark);
}
function plant(cv, C, x, y, size = 1) {     // (x,y) = base of stem
  line(cv, [x, y], [x, y - 3 - size], C.leafDark, 1);
  px(cv, x - 1, y - 2, C.leaf); px(cv, x + 1, y - 3, C.leaf); px(cv, x - 2, y - 3, C.leaf); px(cv, x + 2, y - 4, C.leaf);
  px(cv, x - 1, y - 4 - size, C.leaf); px(cv, x + 1, y - 5 - size, C.leaf);
  px(cv, x, y - 4 - size, C.flower); if (size > 1) { px(cv, x - 2, y - 5, C.flower); px(cv, x + 2, y - 6, C.flower); }
}
function heap(cv, C, x, y, r) { for (let i = 0; i <= r; i++) rect(cv, x - r + i, y - i, x + r - i, y - i, i ? C.soil : C.soilDark); }
function trowel(cv, C, hand, ang) {
  const tip = [hand[0] + Math.cos(ang) * 4, hand[1] + Math.sin(ang) * 4];
  line(cv, hand, tip, C.steel, 1); px(cv, hand[0], hand[1], C.woodDark);
}
function ladder(cv, C, x, y) {               // stepladder from the ground (y) up 16px
  line(cv, [x - 5, y], [x - 2, y - 16], C.wood, 1); line(cv, [x + 5, y], [x + 2, y - 16], C.wood, 1);
  line(cv, [x - 4, y - 5], [x + 4, y - 5], C.woodDark, 1); line(cv, [x - 3, y - 11], [x + 3, y - 11], C.woodDark, 1);
  rect(cv, x - 3, y - 16, x + 3, y - 16, C.woodDark);
}
function shears(cv, C, h1, h2, open) {       // two hands, blades point up-right; open 0..1
  const pivot = [(h1[0] + h2[0]) / 2 + 2, Math.min(h1[1], h2[1]) - 3];
  line(cv, h1, pivot, C.woodDark, 1); line(cv, h2, pivot, C.woodDark, 1);
  const a = -Math.PI / 3, spread = 0.12 + open * 0.5;
  line(cv, pivot, [pivot[0] + Math.cos(a - spread) * 8, pivot[1] + Math.sin(a - spread) * 8], C.steel, 1);
  line(cv, pivot, [pivot[0] + Math.cos(a + spread) * 8, pivot[1] + Math.sin(a + spread) * 8], C.steel, 1);
}
function saw(cv, C, hand, reach = 6) {
  rect(cv, hand[0], hand[1] - 1, hand[0] + 1, hand[1], C.woodDark);
  rect(cv, hand[0] + 2, hand[1] - 1, hand[0] + 1 + reach, hand[1] - 1, C.steel);
  for (let x = hand[0] + 2; x <= hand[0] + 1 + reach; x += 2) px(cv, x, hand[1], C.grey);
}
function specks(cv, C, pts, col = "dust") { for (const [x, y] of pts) px(cv, x, y, C[col]); }

/* ── sheets: each returns an array of frames (Int16 index arrays on a W x H canvas) ── */
const SIDE_ARMS_DOWN = (dx = 0) => [[[19 + dx, G - 17], [19 + dx, G - 12]], [[23 + dx, G - 17], [24 + dx, G - 13]]];

function sheets(C) {
  const frame = (fn) => { const cv = makeCanvas(); fn(cv); outline(cv, C.outline); return cv; };
  const out = {};

  /* Mower walk, back view. The forward leg's foot is higher (further away); the body bobs on down/up frames. */
  // l / r: [x shift, foot lift] per leg. A lifted foot (-) is the one swinging forward, away from the viewer.
  out["mower-walk-back"] = [
    { l: [0, 0], r: [0, -4], bob: 0 }, { l: [0, 0], r: [0, -2], bob: 1 }, { l: [1, -2], r: [-1, 0], bob: 0 }, { l: [0, -3], r: [0, 0], bob: -1 },
    { l: [0, -4], r: [0, 0], bob: 0 }, { l: [0, -2], r: [0, 0], bob: 1 }, { l: [1, 0], r: [-1, -2], bob: 0 }, { l: [0, 0], r: [0, -3], bob: -1 },
  ].map((f, i) => frame((cv) => {
    const b = f.bob, cx = 24;
    // mower ahead of him (drawn first): the wide deck and wheels show either side of his legs
    const my = G - 5;                                                                   // deck sits ahead of him, behind his knees
    rect(cv, cx - 8, my - 2, cx + 8, my, C.mower); rect(cv, cx - 8, my + 1, cx + 8, my + 1, C.mowerDark);
    rect(cv, cx - 10, my - 2, cx - 9, my + 2, C.black); rect(cv, cx + 9, my - 2, cx + 10, my + 2, C.black);   // wheels
    line(cv, [cx - 7, my - 2], [cx - 4, G - 13 + b], C.black, 1); line(cv, [cx + 7, my - 2], [cx + 4, G - 13 + b], C.black, 1);
    drawGardener(cv, C, {
      view: "back", hip: [cx, G - 12 + b], shoulder: [cx, G - 21 + b], head: [cx, G - 25 + b], hipAt: (far) => [cx + (far ? -2 : 2), G - 12 + b],
      legs: [[[cx - 2 + f.l[0], G - 6 + b + f.l[1] / 2], [cx - 2 + f.l[0], G + f.l[1]]], [[cx + 2 + f.r[0] - 1, G - 6 + b + f.r[1] / 2], [cx + 2 + f.r[0] - 1, G + f.r[1]]]],
      arms: [[[cx - 4, G - 17 + b], [cx - 4, G - 13 + b]], [[cx + 4, G - 17 + b], [cx + 4, G - 13 + b]]],
    });
  }));

  /* Planter */
  const potAt = (cv, x) => { pot(cv, C, x, G); plant(cv, C, x, G - 4); };
  out["planter-kneel"] = [
    () => ({ pose: sidePose("stand", { arms: [[[19, G - 17], [21, G - 13]], [[23, G - 17], [25, G - 14]]] }), hold: [21, G - 13], tool: [25, G - 14] }),
    () => ({ pose: { ...sidePose("stand"), shoulder: [24, G - 20], head: [26, G - 23], arms: [[[23, G - 15], [25, G - 11]], [[26, G - 15], [28, G - 12]]] }, hold: [25, G - 11], tool: [28, G - 12] }),
    () => ({ pose: { view: "side", hip: [19, G - 9], shoulder: [23, G - 17], head: [25, G - 21], legs: [[[17, G - 2], [12, G]], [[24, G - 5], [25, G]]],
      arms: [[[23, G - 12], [27, G - 6]], [[25, G - 13], [28, G - 9]]] }, hold: [27, G - 6], tool: [28, G - 9] }),
    () => ({ pose: { view: "side", hip: [19, G - 8], shoulder: [21, G - 17], head: [23, G - 21], legs: [[[19, G - 1], [13, G]], [[24, G - 5], [25, G]]],
      arms: [[[23, G - 12], [28, G - 4]], [[24, G - 13], [27, G - 9]]] }, potGround: 30, tool: [27, G - 9] }),
    () => ({ pose: sidePose("kneel", { arms: [[[21, G - 12], [23, G - 9]], [[23, G - 12], [26, G - 9]]] }), potGround: 31, tool: [26, G - 9] }),
  ].map((fn) => frame((cv) => {
    const f = fn();
    drawGardener(cv, C, f.pose);
    if (f.hold) { pot(cv, C, f.hold[0] + 1, f.hold[1] + 3); plant(cv, C, f.hold[0] + 1, f.hold[1] - 1); }
    if (f.potGround) potAt(cv, f.potGround);
    if (f.tool) trowel(cv, C, f.tool, -0.4);
  }));

  const kneelFrame = (o, extra) => frame((cv) => { drawGardener(cv, C, sidePose(o.kind || "kneel", o)); extra(cv); });
  out["planter-dig"] = [
    { lean: 1, h: [[22, G - 12], [25, G - 13]], ang: 0.9, heap: 0 },
    { lean: 3, h: [[23, G - 9], [27, G - 5]], ang: 1.2, heap: 0 },
    { lean: 4, h: [[24, G - 7], [28, G - 3]], ang: 1.45, heap: 1 },
    { lean: 3, h: [[23, G - 9], [27, G - 7]], ang: 0.3, heap: 1, clump: [[31, G - 8], [32, G - 8], [31, G - 9]] },
    { lean: 1, h: [[22, G - 11], [26, G - 11]], ang: -0.6, heap: 1, clump: [[33, G - 15], [34, G - 15], [34, G - 14]] },
    { lean: 1, h: [[22, G - 12], [25, G - 13]], ang: 0.9, heap: 2 },
  ].map((o) => kneelFrame({ lean: o.lean, arms: [[[21, G - 12], o.h[0]], [[23 + o.lean, G - 12], o.h[1]]] }, (cv) => {
    rect(cv, 28, G, 31, G, C.soilDark);                         // the hole
    if (o.heap) heap(cv, C, 35, G, o.heap + 1);
    trowel(cv, C, o.h[1], o.ang);
    if (o.clump) specks(cv, C, o.clump, "soil");
  }));

  out["planter-unpot"] = [
    { lean: 3, a: [[23, G - 8], [28, G - 3]], b: [[25, G - 9], [30, G - 3]], pot: [29, G, "upright"] },
    { lean: 1, a: [[22, G - 11], [25, G - 12]], b: [[24, G - 11], [27, G - 12]], pot: [26, G - 10, "upright"] },
    { lean: 1, a: [[22, G - 12], [26, G - 15]], b: [[24, G - 10], [27, G - 9]], pot: [26, G - 14, "upside"] },
    { lean: 2, a: [[22, G - 12], [26, G - 15]], b: [[24, G - 10], [27, G - 9]], pot: [26, G - 14, "upside"], ball: [27, G - 9] },
    { lean: 1, a: [[21, G - 12], [20, G - 9]], b: [[24, G - 11], [28, G - 10]], emptyAt: [20, G - 7], plantAt: [28, G - 10] },
    { lean: 3, a: [[21, G - 10], [17, G - 3]], b: [[25, G - 11], [29, G - 8]], emptyAt: [16, G], plantAt: [29, G - 8], hole: true },
  ].map((o) => kneelFrame({ lean: o.lean, arms: [o.a, o.b] }, (cv) => {
    if (o.pot && o.pot[2] === "upright") { pot(cv, C, o.pot[0], o.pot[1]); plant(cv, C, o.pot[0], o.pot[1] - 4); }
    if (o.pot && o.pot[2] === "upside") {
      rect(cv, o.pot[0] - 2, o.pot[1], o.pot[0] + 2, o.pot[1] + 3, C.terracotta); rect(cv, o.pot[0] - 3, o.pot[1] - 1, o.pot[0] + 3, o.pot[1] - 1, C.terracottaDark);
      line(cv, [o.pot[0], o.pot[1] + 4], [o.pot[0], o.pot[1] + 7], C.leaf, 1);
    }
    if (o.ball) rect(cv, o.ball[0] - 1, o.ball[1] - 1, o.ball[0] + 1, o.ball[1] + 1, C.soil);
    if (o.emptyAt) pot(cv, C, o.emptyAt[0], o.emptyAt[1]);
    if (o.plantAt) { rect(cv, o.plantAt[0] - 1, o.plantAt[1], o.plantAt[0] + 1, o.plantAt[1] + 1, C.soil); plant(cv, C, o.plantAt[0], o.plantAt[1]); }
    if (o.hole) rect(cv, 28, G, 31, G, C.soilDark);
    heap(cv, C, 35, G, 3);
  }));

  out["planter-backfill"] = [
    { kind: "kneel", lean: 3, a: [[23, G - 9], [28, G - 5]], b: [[25, G - 10], [30, G - 5]], plantY: G - 3, heap: 3 },
    { kind: "kneel", lean: 3, a: [[23, G - 8], [28, G - 3]], b: [[25, G - 9], [30, G - 3]], plantY: G, heap: 3 },
    { kind: "kneel", lean: 4, a: [[23, G - 8], [27, G - 3]], b: [[26, G - 7], [33, G - 1]], plantY: G, heap: 2 },
    { kind: "kneel", lean: 4, a: [[24, G - 7], [28, G - 1]], b: [[26, G - 7], [31, G - 1]], plantY: G, heap: 1, mound: 1 },
    { kind: "kneel", lean: 5, a: [[24, G - 6], [28, G]], b: [[27, G - 6], [31, G]], plantY: G, heap: 0, mound: 1 },
    { kind: "heels", a: [[16, G - 8], [18, G - 5]], b: [[19, G - 8], [21, G - 5]], plantY: G, heap: 0, mound: 1 },
  ].map((o) => frame((cv) => {
    drawGardener(cv, C, sidePose(o.kind, { lean: o.lean, arms: [o.a, o.b] }));
    if (o.heap) heap(cv, C, 35, G, o.heap);
    if (o.mound) rect(cv, 28, G, 31, G, C.soil);
    plant(cv, C, 29.5, o.plantY, 1);
  }));

  out["planter-shuffle"] = [
    { dx: 0, tilt: 0, a: [[18, G - 12], [19, G - 8]], b: [[22, G - 12], [23, G - 8]] },
    { dx: 1, tilt: 1, a: [[18, G - 12], [19, G - 8]], b: [[23, G - 12], [24, G - 8]], lift: true },
    { dx: 2, tilt: 0, a: [[20, G - 12], [21, G - 8]], b: [[24, G - 12], [25, G - 8]] },
    { dx: 3, tilt: 2, a: [[22, G - 11], [26, G - 6]], b: [[25, G - 11], [29, G - 5]] },
  ].map((o) => frame((cv) => {
    const p = sidePose("kneel", { dx: o.dx, lean: o.tilt, arms: [o.a.map((q) => [q[0] + o.dx, q[1]]), o.b.map((q) => [q[0] + o.dx, q[1]])] });
    if (o.lift) p.legs[1] = [[24 + o.dx, G - 3], [16 + o.dx, G - 1]];
    drawGardener(cv, C, p);
  }));

  out["planter-standup"] = [
    () => sidePose("kneel", { arms: SIDE_ARMS_DOWN().map((a) => a.map((q) => [q[0], q[1] + 4])) }),
    () => ({ view: "side", hip: [19, G - 8], shoulder: [21, G - 17], head: [23, G - 21], legs: [[[19, G - 1], [13, G]], [[24, G - 5], [25, G]]],
      arms: [[[22, G - 12], [24, G - 6]], [[23, G - 13], [24, G - 7]]] }),
    () => ({ view: "side", hip: [19, G - 10], shoulder: [23, G - 18], head: [25, G - 22], legs: [[[17, G - 4], [14, G]], [[23, G - 6], [24, G]]],
      arms: [[[23, G - 13], [24, G - 8]], [[24, G - 14], [25, G - 8]]] }),
    () => ({ view: "side", hip: [20, G - 12], shoulder: [22, G - 21], head: [23, G - 25], legs: [[[20, G - 6], [18, G]], [[22, G - 6], [22, G]]],
      arms: [[[21, G - 16], [22, G - 12]], [[23, G - 16], [24, G - 12]]] }),
    () => sidePose("stand", { arms: [[[19, G - 17], [22, G - 14]], [[23, G - 17], [23, G - 14]]] }),
  ].map((fn) => frame((cv) => drawGardener(cv, C, fn())));

  /* Hedge trimmer: back view, on the second step of a stepladder (ladder identical in every frame). */
  const LAD = [24, G], STEP = G - 11;
  const hedge = (o) => frame((cv) => {
    ladder(cv, C, LAD[0], LAD[1]);
    const base = o.onGround ? G : (o.halfStep ? G - 5 : STEP), cx = o.onGround ? 34 : 24;
    const hip = [cx, base - 12], sh = [cx, base - 21];
    drawGardener(cv, C, {
      view: "back", hip, shoulder: sh, head: [cx, base - 25], hipAt: (far) => [cx + (far ? -2 : 2), base - 12],
      legs: [[[cx - 2, base - 6], [cx - 2, o.halfStep ? G - 5 : base]], [[cx + 2, base - 6], [cx + 2, o.halfStep ? G : base]]],
      arms: o.arms(cx, base),
    });
    if (o.shears) o.shears(cv, cx, base);
  });
  const raised = (cx, base) => [[[cx - 5, base - 22], [cx - 1, base - 25]], [[cx + 5, base - 22], [cx + 3, base - 26]]];
  out["hedge-ready"] = [
    { arms: (cx, b) => [[[cx - 4, b - 17], [cx - 4, b - 12]], [[cx + 4, b - 17], [cx + 5, b - 12]]], shears: (cv, cx, b) => { line(cv, [cx + 5, b - 12], [cx + 7, b - 3], C.steel, 1); line(cv, [cx + 5, b - 12], [cx + 6, b - 3], C.steel, 1); } },
    { arms: (cx, b) => [[[cx - 5, b - 16], [cx - 1, b - 14]], [[cx + 5, b - 16], [cx + 2, b - 14]]], shears: (cv, cx, b) => shears(cv, C, [cx - 1, b - 14], [cx + 2, b - 14], 0) },
    { arms: (cx, b) => [[[cx - 5, b - 19], [cx - 1, b - 20]], [[cx + 5, b - 19], [cx + 3, b - 21]]], shears: (cv, cx, b) => shears(cv, C, [cx - 1, b - 20], [cx + 3, b - 21], 0.4) },
    { arms: raised, shears: (cv, cx, b) => shears(cv, C, [cx - 1, b - 25], [cx + 3, b - 26], 1) },
  ].map(hedge);
  out["hedge-snip"] = [1, 0.6, 0, 0.15, 0.4, 0.8].map((open, i) => hedge({
    arms: (cx, b) => { const s = Math.round((1 - open) * 1.5); return [[[cx - 5, b - 22], [cx - 1 + s, b - 25]], [[cx + 5, b - 22], [cx + 3 - s, b - 26]]]; },
    shears: (cv, cx, b) => {
      const s = Math.round((1 - open) * 1.5); shears(cv, C, [cx - 1 + s, b - 25], [cx + 3 - s, b - 26], open);
      if (i === 2) specks(cv, C, [[cx + 8, b - 36], [cx + 10, b - 35], [cx + 9, b - 37], [cx + 11, b - 33]], "clipping");
      if (i === 3) specks(cv, C, [[cx + 9, b - 32], [cx + 11, b - 30], [cx + 12, b - 33]], "clipping");
      if (i === 5) specks(cv, C, [[cx + 10, b - 24], [cx + 12, b - 26]], "clipping");
    },
  }));
  out["hedge-finish"] = [
    { arms: (cx, b) => [[[cx - 5, b - 17], [cx - 1, b - 14]], [[cx + 5, b - 17], [cx + 2, b - 14]]], shears: (cv, cx, b) => shears(cv, C, [cx - 1, b - 14], [cx + 2, b - 14], 0) },
    { arms: (cx, b) => [[[cx - 4, b - 17], [cx - 4, b - 12]], [[cx + 5, b - 19], [cx + 4, b - 22]]], shears: (cv, cx, b) => { line(cv, [cx + 4, b - 22], [cx - 4, b - 28], C.steel, 1); line(cv, [cx + 4, b - 22], [cx - 3, b - 29], C.steel, 1); } },
    { halfStep: true, arms: (cx, b) => [[[cx - 4, b - 17], [cx - 4, b - 12]], [[cx + 4, b - 17], [cx + 5, b - 12]]], shears: (cv, cx, b) => { line(cv, [cx + 5, b - 12], [cx + 7, b - 3], C.steel, 1); line(cv, [cx + 5, b - 12], [cx + 6, b - 3], C.steel, 1); } },
    { onGround: true, arms: (cx, b) => [[[cx - 4, b - 17], [cx - 4, b - 12]], [[cx + 4, b - 17], [cx + 5, b - 12]]], shears: (cv, cx, b) => { line(cv, [cx + 5, b - 12], [cx + 7, b - 3], C.steel, 1); line(cv, [cx + 5, b - 12], [cx + 6, b - 3], C.steel, 1); } },
  ].map(hedge);

  /* Tree cutter: front view, helmet + harness, hanging on a rope (rope rises from the harness). Feet braced to his right. */
  const climber = (o) => frame((cv) => {
    const cx = 20, hipY = G - 10;
    line(cv, [cx, hipY - 2], [cx, hipY - 34], C.rope, 1);
    drawGardener(cv, C, {
      view: "front", hat: "helmet", harness: true, hip: [cx, hipY], shoulder: [cx - (o.lean || 0), hipY - 9], head: [cx - (o.lean || 0), hipY - 13],
      hipAt: (far) => [cx + (far ? -2 : 2), hipY], legs: o.legs(cx, hipY), arms: o.arms(cx, hipY),
    });
    if (o.extra) o.extra(cv, cx, hipY);
  });
  const braced = (cx, y) => [[[cx + 4, y + 1], [cx + 8, y - 2]], [[cx + 5, y + 3], [cx + 9, y]]];
  const hanging = (cx, y) => [[[cx - 2, y + 5], [cx - 2, y + 9]], [[cx + 2, y + 5], [cx + 2, y + 9]]];
  const sawArm = (reach) => (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 4 + reach / 2, y - 7], [cx + 6 + reach, y - 6]]];
  out["tree-brace"] = [
    { legs: hanging, arms: (cx, y) => [[[cx - 2, y - 13], [cx - 1, y - 17]], [[cx + 2, y - 13], [cx + 1, y - 18]]] },
    { legs: (cx, y) => [[[cx + 1, y + 4], [cx + 4, y + 7]], [[cx + 3, y + 4], [cx + 6, y + 7]]], arms: (cx, y) => [[[cx - 2, y - 13], [cx - 1, y - 17]], [[cx + 2, y - 13], [cx + 1, y - 18]]] },
    { lean: 1, legs: braced, arms: (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 1, y - 12], [cx + 1, y - 17]]] },
    { lean: 1, legs: braced, arms: (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 4, y - 6], [cx + 3, y - 2]]] },
  ].map(climber);
  out["tree-sawstart"] = [
    { lean: 1, legs: braced, arms: (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 4, y - 5], [cx + 3, y - 1]]], extra: (cv, cx, y) => saw(cv, C, [cx + 3, y - 1], 3) },
    { lean: 1, legs: braced, arms: sawArm(2), extra: (cv, cx, y) => saw(cv, C, [cx + 8, y - 6], 5) },
    { lean: 1, legs: braced, arms: sawArm(4), extra: (cv, cx, y) => saw(cv, C, [cx + 10, y - 6], 5) },
    { lean: 1, legs: braced, arms: sawArm(1), extra: (cv, cx, y) => { saw(cv, C, [cx + 7, y - 6], 5); specks(cv, C, [[cx + 14, y - 3], [cx + 15, y - 1]]); } },
  ].map(climber);
  out["tree-cutting"] = [5, 4, 3, 1, 0, 2].map((reach, i) => climber({
    lean: 1, legs: braced, arms: sawArm(reach),
    extra: (cv, cx, y) => { saw(cv, C, [cx + 6 + reach, y - 6], 5); if (i >= 1 && i <= 4) specks(cv, C, [[cx + 13 + (i % 2), y - 3 + i], [cx + 15, y - 1 + (i % 3)]]); },
  }));
  out["tree-finish"] = [
    { lean: 1, legs: braced, arms: sawArm(5), extra: (cv, cx, y) => saw(cv, C, [cx + 11, y - 6], 5) },
    { lean: 0, legs: braced, arms: (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 4, y - 9], [cx + 7, y - 11]]], extra: (cv, cx, y) => saw(cv, C, [cx + 7, y - 11], 5) },
    { lean: 0, legs: hanging, arms: (cx, y) => [[[cx - 3, y - 12], [cx - 1, y - 16]], [[cx + 4, y - 5], [cx + 3, y - 1]]] },
    { lean: 0, legs: hanging, arms: (cx, y) => [[[cx - 2, y - 13], [cx - 1, y - 17]], [[cx + 4, y - 10], [cx + 5, y - 14]]],
      extra: (cv, cx, y) => { px(cv, cx + 5, y - 15, C.gloves); px(cv, cx + 5, y - 16, C.gloves); } },
  ].map(climber);

  /* Props */
  const branch = (ang, onGround, loose) => frame((cv) => {
    const base = onGround ? [10, G] : [12, G - 22], len = 26;
    const tip = [base[0] + Math.cos(ang) * len, base[1] + Math.sin(ang) * len];
    line(cv, base, tip, C.bark, 2);
    const twigs = [0.35, 0.6, 0.85];
    twigs.forEach((t, k) => {
      const q = lerpP(base, tip, t), side = k % 2 ? 1 : -1;
      const tw = [q[0] + Math.cos(ang + side * 0.9) * 5, q[1] + Math.sin(ang + side * 0.9) * 5];
      line(cv, q, tw, C.bark, 1); disc(cv, tw[0], tw[1], 2, C.leaf); px(cv, tw[0] + 1, tw[1] - 1, C.leafDark);
    });
    disc(cv, tip[0], tip[1], 3, C.leaf); px(cv, tip[0] - 1, tip[1] + 1, C.leafDark);
    if (loose) specks(cv, C, loose, "leaf");
  });
  out["prop-branch"] = [
    branch(0, false), branch(0.35, false), branch(0.87, false, [[30, G - 6], [32, G - 10]]),
    branch(1.35, false, [[24, G - 4], [30, G - 12], [34, G - 2]]), branch(-0.04, true, [[38, G], [6, G]]),
  ];
  out["prop-plants"] = [
    frame((cv) => { pot(cv, C, 20, G); plant(cv, C, 20, G - 4, 1); }),
    frame((cv) => { rect(cv, 17, G, 23, G, C.soil); plant(cv, C, 20, G - 1, 1); }),
    frame((cv) => { rect(cv, 17, G, 23, G, C.soilDark); plant(cv, C, 20, G - 1, 2); px(cv, 18, G - 6, C.leaf); px(cv, 22, G - 7, C.leaf); }),
  ];
  out["prop-soil"] = [
    frame((cv) => { rect(cv, 16, G, 26, G, C.soil); rect(cv, 19, G, 22, G, C.soilDark); }),
    frame((cv) => { rect(cv, 16, G, 26, G, C.soil); rect(cv, 19, G, 22, G, C.soilDark); heap(cv, C, 28, G, 1); }),
    frame((cv) => { rect(cv, 16, G, 26, G, C.soil); rect(cv, 19, G, 22, G, C.soilDark); heap(cv, C, 28, G, 2); }),
    frame((cv) => { rect(cv, 16, G, 26, G, C.soil); rect(cv, 19, G, 22, G, C.soilDark); heap(cv, C, 28, G, 4); }),
  ];
  out["prop-potstack"] = [1, 2, 3].map((n) => frame((cv) => { for (let k = 0; k < n; k++) pot(cv, C, 20, G - k * 2); }));
  return out;
}

/* Public: frames for one sheet id, as { w, h, idx } index maps (trimmed later by the pipeline). */
function drawFallback(id, pal) {
  const C = painter(pal);
  const all = sheets(C);
  if (!all[id]) throw new Error(`no fallback drawing for ${id}`);
  return all[id];
}

module.exports = { drawFallback };
