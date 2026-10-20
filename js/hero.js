/* Hinks Garden Maintenance — animated hero.
   An untidy pixel-art garden is tidied in front of the visitor: a gardener mows the lawn stripe by
   stripe (the tidy lawn is revealed exactly where he passes) while the rest of the garden tidies with a
   soft front-to-back wipe. Three more gardeners work at their stations throughout.
   Ported from the Claude Design prototype; assets come from images/hero/RUNBOOK.md. No libraries. */
(() => {
  const hero = document.getElementById("hero");
  if (!hero) return;

  /* ─── Tweak these ───────────────────────────────────────────────────────── */
  const CONFIG = {
    stripeTime: 1.7,        // seconds to mow one stripe (his walking speed)
    pause: 0.3,             // seconds at the end of a stripe
    shiftTime: 0.45,        // seconds to step across to the next stripe
    turnFade: 0.15,         // cross-fade between back and front views
    feather: 3,             // px soft edge on the lawn reveal
    clippings: 40,          // grass clippings per second at full speed
    clippingLife: 0.8,
    shadowOpacity: 0.35,
    stride: 50,             // sprite px covered by one 8-frame walk cycle
    vibrate: 1, vibrateRate: 14,   // mower shake (px, per second)
    idleStep: 12,           // sprite px he steps aside from the mower when done
    stationFps: 5,          // station gardeners' animation speed
    fromRight: true,        // mow right-to-left, so the copy card (bottom-left) never hides him at the start
  };

  /* Per-scene geometry, as fractions of the scene image. `lawn` comes from
     images/hero/regions-*.json and must match the stripes painted into the tidy image. */
  const SCENES = {
    desktop: {
      lawn: { vpX: 0.5112, vpY: 0.3917, nearY: 0.6636, farY: 0.4596, halfNear: 0.2401, stripes: 11 },
      hole: { nearY: 0.6616, farY: 0.4626, padX: 0.003 },  // lawn cut out of the wipe (inset at the ends)
      path: { nearY: 0.6706, farY: 0.4666 },                // where his feet go
      baseHeight: 0.12, scaleNear: 1.05, scaleFar: 0.5,    // his size (fraction of scene height) and perspective
      stations: [
        { sheet: "gardener-pool",  frames: 6, w: 102, h: 88,  pad: 2, x: 0.792, y: 0.712, height: 0.095 },
        { sheet: "gardener-hedge", frames: 6, w: 106, h: 176, pad: 2, x: 0.842, y: 0.622, height: 0.17 },
        { sheet: "gardener-tree",  frames: 6, w: 130, h: 126, pad: 2, x: 0.640, y: 0.318, height: 0.085 },
      ],
    },
    portrait: {
      lawn: { vpX: 0.4991, vpY: 0.3099, nearY: 0.6354, farY: 0.4010, halfNear: 0.2183, stripes: 11 },
      hole: { nearY: 0.6334, farY: 0.4040, padX: 0.003 },
      path: { nearY: 0.6414, farY: 0.4070 },
      baseHeight: 0.062, scaleNear: 1.25, scaleFar: 0.5,
      stations: [],
    },
  };

  /* Sprite sheets (from the pack JSON files): 8 frames, frames 0 and 4 are standing poses.
     cutAhead: sprite px from his feet to the mower's cutting line; spawnY: where clippings fly from. */
  const SHEETS = {
    back:  { w: 58, h: 131, pad: 2,  cutAhead: 34, spawnY: 30 },
    front: { w: 58, h: 142, pad: 14, cutAhead: -4, spawnY: 4 },
  };
  const REF_HEIGHT = 128, FRAMES = 8;
  const CLIP_COLOURS = ["#8fbf4a", "#a7d35a", "#6f9f3a", "#c9e07a", "#7fb043"];

  /* PixiJS sprite layer (public/assets/sprites/atlas.json, made by scripts/generate-assets.js).
     Used when PixiJS and the atlas load (needs http, e.g. `npm run dev`); otherwise the DOM sprites above are used.
     Sizes are in atlas sprite pixels; the man's walk sheets are ~46 px tall. */
  const ATLAS_URL = "public/assets/sprites/atlas.json";
  const GFX = {
    back:  { anim: "mower-walk-back",  cutAhead: 10, spawnY: 8 },
    front: { anim: "mower-walk-front", cutAhead: 6,  spawnY: 4 },
    height: 46, stride: 18,              // walk-sheet height; sprite px per 8-frame cycle
    shadow: [24, 7],
  };
  /* Station scripts: each step plays an animation `loops` times; `fill` stretches that step's loops so the station
     finishes at about the time the mowing does. Positions are scene fractions (feet = bottom-centre). */
  const STATIONS = {
    desktop: [
      { name: "planter", x: 0.748, y: 0.712, delay: 0.6, steps: [
        { anim: "planter-kneel" }, { anim: "planter-dig" }, { anim: "planter-unpot" }, { anim: "planter-backfill", plant: true },
        { anim: "planter-shuffle", move: 12 }, { anim: "planter-dig" }, { anim: "planter-unpot" }, { anim: "planter-backfill", plant: true },
        { anim: "planter-standup" }] },
      { name: "hedge", x: 0.842, y: 0.622, delay: 1.2, steps: [
        { anim: "hedge-ready" }, { anim: "hedge-snip", fill: true }, { anim: "hedge-finish" }] },
      { name: "tree", x: 0.640, y: 0.318, delay: 1.8, steps: [
        { anim: "tree-brace" }, { anim: "tree-sawstart" }, { anim: "tree-cutting", fill: true }, { anim: "tree-finish", dropBranch: 1 }] },
    ],
    portrait: [],
  };
  const BRANCH = { fall: 1.4, rest: 2.5, fade: 1, landX: 0.565, landY: 0.485, dx: 0.035 };   // seconds; landing spot (far-right corner of the lawn); x offset from the climber
  /* ───────────────────────────────────────────────────────────────────────── */

  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const q = (s) => hero.querySelector(s);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const tidyImg = q(".hero__tidy-src");
  const sprite = q(".hero__sprite"), shadow = q(".hero__shadow"), stationsEl = q(".hero__stations");
  const replayBtn = q(".hero__replay");
  const figs = { back: q(".hero__fig--back"), front: q(".hero__fig--front") };
  const layers = {
    back:  { man: q(".hero__fig--back .hero__layer--man"),  mower: q(".hero__fig--back .hero__layer--mower") },
    front: { man: q(".hero__fig--front .hero__layer--man"), mower: q(".hero__fig--front .hero__layer--mower") },
  };
  const cv = { tidy: q(".hero__tidy"), done: q(".hero__done"), live: q(".hero__live"), fx: q(".hero__fx") };
  const ctx = {};
  Object.keys(cv).forEach((k) => { ctx[k] = cv[k].getContext("2d"); });
  figs.back.style.transition = figs.front.style.transition = "opacity " + CONFIG.turnFade + "s linear";
  shadow.style.opacity = CONFIG.shadowOpacity;

  /* ── wait for every image (scenes + sprite sheets) before starting ── */
  const loaded = (img) => new Promise((resolve) => {
    const done = () => (img.decode ? img.decode().catch(() => {}).then(resolve) : resolve());
    if (img.complete && img.naturalWidth) { done(); return; }
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", resolve, { once: true });
  });
  const urlOf = (el) => (/url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || "") || [])[1];
  const preload = (url) => { const im = new Image(); im.src = url; return loaded(im); };

  let run = null;            // the current scene's animation (rebuilt if the picture switches scene)

  /* Set up PixiJS once. Resolves to { app, anims, ratio } or null (no PixiJS, file://, no WebGL). */
  let gfxPromise = null;
  function initPixi() {
    if (gfxPromise) return gfxPromise;
    gfxPromise = (async () => {
      if (!window.PIXI || location.protocol === "file:") return null;
      try {
        const P = window.PIXI;
        P.TextureSource.defaultOptions.scaleMode = "nearest";
        // decode on the main thread: worker-based ImageBitmap loading can stall (e.g. some embedded/headless browsers)
        P.Assets.setPreferences({ preferWorkers: false, preferCreateImageBitmap: false });
        const app = new P.Application();
        await app.init({ canvas: q(".hero__pixi"), backgroundAlpha: 0, antialias: false, autoStart: false, roundPixels: true,
          resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, width: hero.clientWidth, height: hero.clientHeight });
        app.ticker.stop();
        const sheet = await P.Assets.load(ATLAS_URL);
        sheet.textureSource.scaleMode = "nearest";
        hero.classList.add("has-pixi");
        const meta = sheet.data.meta || {};
        return { P, app, anims: sheet.animations, ratio: meta.pixelRatio || 0.75, fpsMap: meta.fps || {} };
      } catch (e) {
        console.warn("Hero: PixiJS layer unavailable, using DOM sprites.", e);
        return null;
      }
    })();
    return gfxPromise;
  }

  function start() {
    if (run) run.stop();
    const portrait = /\/p-tidy\.png/.test(tidyImg.currentSrc || tidyImg.src);
    const S = portrait ? SCENES.portrait : SCENES.desktop;
    const L = S.lawn, N = L.stripes;
    const stationUrls = S.stations.map((s) => "public/assets/hero/" + s.sheet + ".png");
    const sheetUrls = Object.values(layers).flatMap((l) => [urlOf(l.man), urlOf(l.mower)]).filter(Boolean);
    const untidyImg = q(".hero__pic--untidy img");
    Promise.all([initPixi(), loaded(tidyImg), loaded(untidyImg)].concat(sheetUrls.map(preload), stationUrls.map(preload)))
      .then(([gfx]) => { run = animate(S, L, N, gfx, portrait ? STATIONS.portrait : STATIONS.desktop); });
  }

  function animate(S, L, N, gfx, stationDefs) {
    const C = CONFIG, F = C.feather, M = F + 2;
    let stopped = false, raf = 0;

    // ── geometry helpers (scene fractions)
    const halfW = (y) => L.halfNear * (y - L.vpY) / (L.nearY - L.vpY);
    const edgeX = (k, y) => L.vpX - halfW(y) + 2 * halfW(y) * k / N;
    const sizeAt = (y) => lerp(S.scaleNear, S.scaleFar, (S.path.nearY - y) / (S.path.nearY - S.path.farY));
    // screen px per sprite px for the mower man at scene height y. With PixiJS he is exactly on the sprite grid at
    // the near end of the lawn and shrinks with distance.
    const kMan = (y) => (gfx ? (sp * gfx.ratio * sizeAt(y)) / S.scaleNear : px * sizeAt(y));
    const STRIDE = gfx ? GFX.stride : C.stride;
    const CUT = gfx ? { back: GFX.back, front: GFX.front } : SHEETS;

    // ── timeline: one walk per stripe, alternating up and down, then back to the pool end
    const order = Array.from({ length: N }, (_, i) => (C.fromRight ? N - 1 - i : i));
    const segs = [];
    {
      const near = (i) => ({ x: edgeX(i + 0.5, S.path.nearY), y: S.path.nearY });
      const far = (i) => ({ x: edgeX(i + 0.5, S.path.farY), y: S.path.farY });
      let t = 0, pos;
      const add = (s) => { s.t0 = t; t += s.dur; s.t1 = t; segs.push(s); };
      order.forEach((stripe, n) => {
        const up = n % 2 === 0, view = up ? "back" : "front";
        const from = up ? near(stripe) : far(stripe), to = up ? far(stripe) : near(stripe);
        add({ type: "walk", from, to, dur: C.stripeTime, view, stripe, n, dir: up ? "up" : "down" });
        pos = to;
        if (n < N - 1) {
          add({ type: "pause", at: pos, dur: C.pause, view });
          const nx = order[n + 1], next = up ? far(nx) : near(nx);
          add({ type: "walk", from: pos, to: next, dur: C.shiftTime, view, turnTo: up ? "front" : "back" });
          pos = next;
        }
      });
      add({ type: "pause", at: pos, dur: C.pause, view: N % 2 ? "back" : "front" });
      const home = near(Math.floor(N / 2));                      // rest at the pool end, mid-lawn
      const back = Math.hypot((home.x - pos.x) * 1.78, home.y - pos.y) / Math.hypot(0, S.path.nearY - S.path.farY);
      add({ type: "walk", from: pos, to: home, dur: Math.max(0.8, C.stripeTime * back), view: "front" });
      add({ type: "idle", at: home, dur: 1e9, view: "front" });
    }
    const mowEnd = segs[segs.length - 2].t1;

    // ── screen geometry: where the cover-fitted scene sits, at any aspect ratio
    let W = 1, H = 1, box = { x: 0, y: 0, w: 1, h: 1 }, px = 1, sp = 1;   // sp = screen px per scene pixel
    const X = (fx) => box.x + fx * box.w, Y = (fy) => box.y + fy * box.h;

    const tracePoly = (c, pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); };
    const holeRows = () => ({ yN: Y(S.hole.nearY), yF: Y(S.hole.farY), padX: S.hole.padX * box.w });
    const holePoly = (grow) => {
      const r = holeRows(), yN = r.yN + grow, yF = r.yF - grow, ex = r.padX + grow;
      const fN = (r.yN - box.y) / box.h, fF = (r.yF - box.y) / box.h;
      return [[X(edgeX(0, fN)) - ex, yN], [X(edgeX(N, fN)) + ex, yN], [X(edgeX(N, fF)) + ex, yF], [X(edgeX(0, fF)) - ex, yF]];
    };
    // stripe polygon, extended on the side that faces already-mown grass (or the lawn edge) so joins are seamless
    const stripePoly = (i) => {
      const r = holeRows(), yN = r.yN + M, yF = r.yF - M;
      const fN = (yN - box.y) / box.h, fF = (yF - box.y) / box.h;
      const first = C.fromRight ? i === N - 1 : i === 0, last = C.fromRight ? i === 0 : i === N - 1;
      const exMown = first ? r.padX + M : M, exUncut = last ? r.padX + M : 0;
      const exL = C.fromRight ? exUncut : exMown, exR = C.fromRight ? exMown : exUncut;
      const uncutEdge = C.fromRight ? i : i + 1;            // the edge that faces uncut grass
      return {
        pts: [[X(edgeX(i, fN)) - exL, yN], [X(edgeX(i + 1, fN)) + exR, yN], [X(edgeX(i + 1, fF)) + exR, yF], [X(edgeX(i, fF)) - exL, yF]],
        edge: [[X(edgeX(uncutEdge, fN)), yN], [X(edgeX(uncutEdge, fF)), yF]], last,
      };
    };
    const drawScene = (c) => { c.imageSmoothingEnabled = false; c.drawImage(tidyImg, box.x, box.y, box.w, box.h); };
    const drawTidy = (withHole) => {
      const c = ctx.tidy; c.clearRect(0, 0, W, H); drawScene(c);
      if (!withHole) return;
      c.save(); c.globalCompositeOperation = "destination-out";
      if ("filter" in c) c.filter = "blur(" + F / 2 + "px)";
      tracePoly(c, holePoly(F / 2)); c.fillStyle = "#000"; c.fill(); c.restore();
    };
    // reveal the tidy lawn inside stripe i; `lead` (px y) is the mower's cut line
    const drawStripe = (c, i, lead, dir) => {
      const P = stripePoly(i);
      const xs = P.pts.map((p) => p[0]), ys = P.pts.map((p) => p[1]);
      const bx = Math.min(...xs) - 1, by = Math.min(...ys) - 1, bw = Math.max(...xs) - bx + 2, bh = Math.max(...ys) - by + 2;
      c.save(); tracePoly(c, P.pts); c.clip(); drawScene(c);
      c.globalCompositeOperation = "destination-out";
      if (lead !== null) {
        const g = c.createLinearGradient(0, lead, 0, lead + (dir === "up" ? F : -F));
        g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g; c.fillRect(bx, by, bw, bh);
      }
      if (!P.last) {                                   // soften the edge that faces uncut grass
        const [a, b] = P.edge, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len, ny = dx / len;
        const towardsUncut = C.fromRight ? -1 : 1;
        if (Math.sign(nx) !== towardsUncut) { nx = -nx; ny = -ny; }
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const g = c.createLinearGradient(mx - nx * F, my - ny * F, mx, my);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
        c.fillStyle = g; c.fillRect(bx, by, bw, bh);
      }
      c.restore();
    };

    // ── walk-cycle bookkeeping, measured in sprite px so cadence follows speed and perspective
    const prepare = () => {
      let frame = 0;
      segs.forEach((s) => {
        s.startFrame = frame;
        if (s.type !== "walk") { s.endFrame = frame; return; }
        const cum = [0]; let acc = 0, prev = null;
        for (let i = 0; i <= 32; i++) {
          const e = easeInOut(i / 32), fx = lerp(s.from.x, s.to.x, e), fy = lerp(s.from.y, s.to.y, e);
          const p = { x: X(fx), y: Y(fy), k: kMan(fy) };
          if (prev) { acc += Math.hypot(p.x - prev.x, p.y - prev.y) / ((p.k + prev.k) / 2); cum.push(acc); }
          prev = p;
        }
        s.cum = cum; s.dist = acc || 1;
        s.halfSteps = Math.max(1, Math.round(acc / (STRIDE / 2)));     // whole steps: he always stops standing
        s.endFrame = (frame + s.halfSteps * 4) % FRAMES;
        frame = s.endFrame;
      });
    };

    // ── sprites
    let placed = {}, lastMan = null, lastJitter = null;
    const place = (view, frame, k) => {
      const SH = SHEETS[view];
      const w = Math.round(SH.w * k), h = Math.round(SH.h * k), pad = Math.round(SH.pad * k);
      const key = w + "," + h + "," + frame;
      if (placed[view] === key) return;
      placed[view] = key;
      [layers[view].man, layers[view].mower].forEach((el) => {
        el.style.width = w + "px"; el.style.height = h + "px";
        el.style.left = -Math.round(w / 2) + "px"; el.style.bottom = -pad + "px";
        el.style.backgroundSize = w * FRAMES + "px " + h + "px";
        el.style.backgroundPosition = -frame * w + "px 0px";
      });
    };
    const placeShadow = (k) => {
      const [bw, bh] = gfx ? GFX.shadow : [60, 16];
      const sw = Math.round(bw * k), sh = Math.round(bh * k);
      shadow.style.width = sw + "px"; shadow.style.height = sh + "px";
      shadow.style.left = -Math.round(sw / 2) + "px"; shadow.style.bottom = Math.round(2 * k - sh / 2) + "px";
    };
    const show = (view) => {
      figs.back.classList.toggle("is-visible", view === "back");
      figs.front.classList.toggle("is-visible", view === "front");
    };
    const offsetMan = (dx, dy) => {
      const key = dx + "," + dy; if (key === lastMan) return; lastMan = key;
      layers.back.man.style.transform = layers.front.man.style.transform = "translate(" + dx + "px," + dy + "px)";
    };

    // ── station gardeners (looping sprite sheets)
    stationsEl.textContent = "";
    const stations = S.stations.map((st) => {
      const anchor = document.createElement("div"); anchor.className = "hero__station";
      const layer = document.createElement("div"); layer.className = "hero__layer";
      layer.style.backgroundImage = "url(public/assets/hero/" + st.sheet + ".png)";
      anchor.appendChild(layer); stationsEl.appendChild(anchor);
      return { st, anchor, layer, frame: -1 };
    });
    const placeStations = () => stations.forEach((s) => {
      const k = (s.st.height * box.h) / s.st.h, w = Math.round(s.st.w * k), h = Math.round(s.st.h * k);
      s.anchor.style.transform = "translate(" + Math.round(X(s.st.x)) + "px," + Math.round(Y(s.st.y)) + "px)";
      Object.assign(s.layer.style, { width: w + "px", height: h + "px", left: -Math.round(w / 2) + "px",
        bottom: -Math.round(s.st.pad * k) + "px", backgroundSize: w * s.st.frames + "px " + h + "px" });
      s.w = w; s.frame = -1;
    });
    const tickStations = (t) => stations.forEach((s, i) => {
      const f = reduced ? 0 : Math.floor(t * C.stationFps + i * 2) % s.st.frames;   // offset so they don't move in sync
      if (f !== s.frame) { s.frame = f; s.layer.style.backgroundPosition = -f * s.w + "px 0px"; }
    });

    // ── PixiJS layer: the mower man, the station gardeners and their props
    const G = gfx && (() => {
      const P = gfx.P, stage = gfx.app.stage;
      stage.removeChildren();
      const fps = (gfx.fpsMap = gfx.fpsMap || {});
      const mk = (anim, parent = stage) => { const s = new P.Sprite(gfx.anims[anim][0]); s.anchor.set(0.5, 1); parent.addChild(s); return s; };
      const byName = Object.fromEntries(stationDefs.map((d) => [d.name, d]));
      const build = (def) => {
        if (!def) return null;
        // the step timeline; `fill` steps loop until the station would end with the mowing
        const dur = (anim) => gfx.anims[anim].length / (fps[anim] || 6);
        const fixed = def.steps.filter((s) => !s.fill).reduce((a, s) => a + dur(s.anim), 0);
        let t = 0;
        const steps = def.steps.map((s) => {
          const loops = s.fill ? Math.max(1, Math.round((mowEnd - def.delay - fixed) / dur(s.anim))) : 1;
          const st = { ...s, t0: t, t1: t + dur(s.anim) * loops, n: gfx.anims[s.anim].length, fps: fps[s.anim] || 6 };
          t = st.t1; return st;
        });
        return { def, steps, end: t, props: [], sprite: null };
      };
      const tree = build(byName.tree), hedge = build(byName.hedge), planter = build(byName.planter);
      // back to front: tree + branch, hedge, the mower man, the planter (nearest the camera) and his props
      if (tree) { tree.branch = mk("prop-branch"); tree.sprite = mk(tree.steps[0].anim); }
      if (hedge) hedge.sprite = mk(hedge.steps[0].anim);
      const man = { back: mk(GFX.back.anim), front: mk(GFX.front.anim), alpha: { back: 1, front: 0 } };
      if (planter) {
        planter.pots = mk("prop-potstack");
        planter.plants = planter.steps.filter((s) => s.plant).map(() => { const s = mk("prop-plants"); s.texture = gfx.anims["prop-plants"][1]; s.visible = false; return s; });
        planter.sprite = mk(planter.steps[0].anim);
      }
      return { stage, man, stations: [tree, hedge, planter].filter(Boolean), tree, planter };
    })();
    if (gfx) shadow.parentNode.style.zIndex = 3;           // the DOM shadow sits under the PixiJS layer

    // where a station is at time t: { step, frame, rel }
    const stationAt = (st, t) => {
      const rel = t - st.def.delay;
      if (rel <= 0) return { step: st.steps[0], frame: 0, rel, i: 0 };
      for (let i = 0; i < st.steps.length; i++) {
        const s = st.steps[i];
        if (rel < s.t1) return { step: s, frame: Math.floor((rel - s.t0) * s.fps) % s.n, rel, i };
      }
      const s = st.steps[st.steps.length - 1];
      return { step: s, frame: s.n - 1, rel, i: st.steps.length - 1, done: true };
    };
    const updateGfxStations = (t) => {
      const k = sp * gfx.ratio;                            // stations stand still: exactly on the sprite grid
      for (const st of G.stations) {
        const a = stationAt(st, t), d = st.def;
        let ox = 0;                                         // planter: sideways shuffle, in sprite px
        st.steps.forEach((s, i) => {
          if (!s.move || i > a.i) return;
          ox += i < a.i || a.done ? s.move : s.move * Math.min(1, (a.rel - s.t0) / (s.t1 - s.t0));
        });
        st.sprite.texture = gfx.anims[a.step.anim][a.frame];
        st.sprite.position.set(Math.round(X(d.x) + ox * k), Math.round(Y(d.y)));
        st.sprite.scale.set(k);
        if (st === G.planter) {
          let unpots = 0, plantI = 0, moved = 0;
          st.steps.forEach((s, i) => {
            const finished = i < a.i || a.done;
            if (s.anim === "planter-unpot" && finished) unpots++;
            if (s.move && finished) moved += s.move;
            if (s.plant) {
              const p = st.plants[plantI++];
              p.visible = finished;                        // the plant left in the ground once he moves on
              p.position.set(Math.round(X(d.x) + (moved + 10) * k), Math.round(Y(d.y)));
              p.scale.set(k);
            }
          });
          st.pots.texture = gfx.anims["prop-potstack"][Math.min(2, unpots)];
          st.pots.position.set(Math.round(X(d.x) - 15 * k), Math.round(Y(d.y)));
          st.pots.scale.set(k);
        }
        if (st === G.tree) {
          const b = st.branch, fin = st.steps.find((s) => s.dropBranch !== undefined);
          const drop = st.def.delay + fin.t0 + fin.dropBranch / fin.fps;    // when it comes away
          const hx = X(d.x + BRANCH.dx), hy = Y(d.y) - 22 * k;
          const since = t - drop;
          b.scale.set(k); b.alpha = 1; b.visible = true;
          if (since < 0) { b.texture = gfx.anims["prop-branch"][0]; b.position.set(Math.round(hx), Math.round(hy)); }
          else if (since < BRANCH.fall) {
            const e = since / BRANCH.fall, f = Math.min(3, Math.floor(e * 4));
            b.texture = gfx.anims["prop-branch"][f];
            b.position.set(Math.round(lerp(hx, X(BRANCH.landX), e)), Math.round(lerp(hy, Y(BRANCH.landY), e * e)));
          } else {
            b.texture = gfx.anims["prop-branch"][4];
            b.position.set(Math.round(X(BRANCH.landX)), Math.round(Y(BRANCH.landY)));
            const fadeT = since - BRANCH.fall - BRANCH.rest;     // then it's cleared away
            b.alpha = fadeT <= 0 ? 1 : Math.max(0, 1 - fadeT / BRANCH.fade);
            b.visible = b.alpha > 0;
          }
        }
      }
    };
    const updateGfxMan = (ax, ay, frame, k, view, dt, manDy) => {
      for (const v of ["back", "front"]) {
        const s = G.man[v], target = v === view ? 1 : 0;
        G.man.alpha[v] += Math.sign(target - G.man.alpha[v]) * Math.min(Math.abs(target - G.man.alpha[v]), dt / C.turnFade);
        s.alpha = dt === 0 ? target : G.man.alpha[v];
        s.texture = gfx.anims[GFX[v].anim][frame];
        s.position.set(ax, ay + manDy);
        s.scale.set(k);
      }
    };

    // ── grass clippings
    const parts = [];
    const spawnClipping = (ax, ay, k, view) => {
      if (parts.length > 160) return;
      const side = Math.random() < 0.5 ? -1 : 1;
      const spawnY = CUT[view].spawnY * k;
      if (gfx) k *= GFX.height / REF_HEIGHT;               // the physics below is tuned in old 128-px sprite units
      parts.push({
        x: ax + side * (12 + Math.random() * 10) * k, y: ay - spawnY - Math.random() * 6 * k,
        vx: side * (20 + Math.random() * 45) * k, vy: -(40 + Math.random() * 70) * k, g: 260 * k,
        size: Math.max(1, Math.round(1.5 * k)), life: C.clippingLife * (0.6 + Math.random() * 0.4), age: 0,
        col: CLIP_COLOURS[Math.floor(Math.random() * CLIP_COLOURS.length)],
      });
    };
    const drawClippings = (dt) => {
      const c = ctx.fx; c.clearRect(0, 0, W, H);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        c.globalAlpha = 1 - p.age / p.life; c.fillStyle = p.col;
        c.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      c.globalAlpha = 1;
    };

    // ── state
    let committed = 0, liveStripe = -1, t0 = performance.now(), last = t0, lastProg = 0, emitAcc = 0;
    const measure = () => {
      W = hero.clientWidth; H = hero.clientHeight;
      const iw = tidyImg.naturalWidth || 16, ih = tidyImg.naturalHeight || 9;
      const s = Math.max(W / iw, H / ih);
      box = { x: (W - iw * s) / 2, y: (H - ih * s) / 2, w: iw * s, h: ih * s };
      px = (S.baseHeight * box.h) / REF_HEIGHT;
      sp = box.h / ih;
      if (gfx) gfx.app.renderer.resize(W, H);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      Object.keys(cv).forEach((k) => {
        cv[k].width = Math.round(W * dpr); cv[k].height = Math.round(H * dpr);
        ctx[k].setTransform(dpr, 0, 0, dpr, 0, 0);
      });
      drawTidy(!reduced);
      for (let n = 0; n < committed; n++) drawStripe(ctx.done, order[n], null, "up");
      prepare(); placed = {}; placeStations();
    };
    const restart = () => {
      t0 = performance.now(); committed = 0; liveStripe = -1; lastProg = 0; parts.length = 0;
      ctx.done.clearRect(0, 0, W, H); ctx.live.clearRect(0, 0, W, H);
      hero.classList.remove("is-wiping", "is-done");
      void hero.offsetWidth;                                   // restart the CSS wipe
      hero.classList.add("is-wiping");
      replayBtn.hidden = true;
    };
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    measure();

    if (reduced) {                         // finished garden, gardener resting by the pool
      hero.classList.add("is-done");
      const home = segs[segs.length - 1].at, k = kMan(home.y);
      sprite.style.transform = "translate(" + Math.round(X(home.x)) + "px," + Math.round(Y(home.y)) + "px)";
      placeShadow(k);
      if (gfx) {
        const draw = () => { updateGfxMan(Math.round(X(home.x)), Math.round(Y(home.y)), 0, kMan(home.y), "front", 0, 0); updateGfxStations(1e6); gfx.app.render(); };
        draw(); new ResizeObserver(draw).observe(hero);
      } else { place("front", 0, k); show("front"); offsetMan(Math.round(C.idleStep * k), 0); tickStations(0); }
      return { stop() { ro.disconnect(); } };
    }

    replayBtn.onclick = restart;
    hero.classList.add("is-wiping");
    // Dev aid: index.html#t=12 jumps 12 seconds into the sequence (to check any moment without waiting).
    const seek = parseFloat((/[#&]t=([\d.]+)/.exec(location.hash) || [])[1]);
    if (seek > 0) {
      t0 -= seek * 1000; last = performance.now();
      const css = getComputedStyle(hero), sec = (v) => parseFloat(v) * (/ms$/.test(v.trim()) ? 0.001 : 1);
      if (seek >= sec(css.getPropertyValue("--hold")) + sec(css.getPropertyValue("--wipe"))) hero.classList.replace("is-wiping", "is-done");
    }

    const tick = (now) => {
      if (stopped) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      let seg = segs[0];
      for (let i = 0; i < segs.length; i++) if (t >= segs[i].t0) seg = segs[i];
      const tl = Math.min(seg.dur, t - seg.t0);

      // commit every stripe whose walk has finished (robust to dropped frames)
      segs.forEach((s) => {
        if (s.type === "walk" && s.n !== undefined && t >= s.t1 && s.n === committed) {
          drawStripe(ctx.done, s.stripe, null, s.dir); committed++;
          if (liveStripe === s.stripe) { ctx.live.clearRect(0, 0, W, H); liveStripe = -1; }
        }
      });
      if (replayBtn.hidden && t > mowEnd) replayBtn.hidden = false;

      let fx, fy, view = seg.view, frame = seg.startFrame, walking = false, prog = 0, manDx = 0, manDy = 0;
      if (seg.type === "walk") {
        const e = easeInOut(tl / seg.dur);
        fx = lerp(seg.from.x, seg.to.x, e); fy = lerp(seg.from.y, seg.to.y, e);
        const f = Math.min(31.999, e * 32), i = Math.floor(f);
        const d = seg.cum[i] + (seg.cum[i + 1] - seg.cum[i]) * (f - i);
        prog = (d / seg.dist) * seg.halfSteps * 4;
        frame = (seg.startFrame + Math.min(seg.halfSteps * 4, Math.floor(prog))) % FRAMES;
        walking = tl < seg.dur;
        if (seg.turnTo && e >= 0.5) view = seg.turnTo;
      } else {
        fx = seg.at.x; fy = seg.at.y; frame = seg.endFrame;
        if (seg.type === "idle") {                           // step aside from the mower, then breathe
          const k = kMan(fy);
          manDx = Math.round(C.idleStep * k * easeInOut(Math.min(1, tl / 0.5)));
          manDy = tl > 0.5 && Math.floor((tl - 0.5) / 1.1) % 2 ? -1 : 0;
          if (tl < 0.5) frame = (seg.startFrame + Math.floor((tl / 0.5) * 4)) % FRAMES;
        }
      }
      const k = kMan(fy);
      const ax = Math.round(X(fx)), ay = Math.round(Y(fy));
      const speed = walking ? Math.min(1, Math.abs(prog - lastProg) / Math.max(dt, 1e-3) / ((seg.halfSteps * 4) / seg.dur)) : 0;
      lastProg = prog;

      sprite.style.transform = "translate(" + ax + "px," + ay + "px)";
      placeShadow(k);
      if (gfx) updateGfxMan(ax, ay, frame, k, view, dt, manDy);   // mower is part of the sheet: no separate shake
      else {
        place("back", frame, k); place("front", frame, k); show(view); offsetMan(manDx, manDy);
        const j = walking || seg.type === "pause" ? (Math.floor(t * C.vibrateRate) % 2) * C.vibrate : 0;   // engine off when idle
        if (j !== lastJitter) { lastJitter = j; layers.back.mower.style.transform = layers.front.mower.style.transform = "translateX(" + j + "px)"; }
      }

      // the cut line follows the mower deck: reveal the stripe behind it
      if (seg.type === "walk" && seg.n !== undefined && seg.n >= committed) {
        if (liveStripe !== seg.stripe) { ctx.live.clearRect(0, 0, W, H); liveStripe = seg.stripe; }
        const P = stripePoly(seg.stripe), xs = P.pts.map((p) => p[0]), ys = P.pts.map((p) => p[1]);
        ctx.live.clearRect(Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) - Math.min(...xs) + 4, Math.max(...ys) - Math.min(...ys) + 4);
        let lead = ay - CUT[view].cutAhead * k;
        const e = easeInOut(tl / seg.dur);
        if (e > 0.85) {                                     // in the last stretch the cut runs out to the stripe's end
          const w = easeInOut((e - 0.85) / 0.15);
          lead = seg.dir === "up" ? Math.min(lead, lerp(lead, P.pts[2][1] - F, w)) : Math.max(lead, lerp(lead, P.pts[0][1] + F, w));
        }
        drawStripe(ctx.live, seg.stripe, lead, seg.dir);
      }

      if (walking && speed > 0.1) {
        emitAcc += C.clippings * speed * dt;
        while (emitAcc >= 1) { emitAcc -= 1; spawnClipping(ax, ay, k, view); }
      }
      drawClippings(dt);
      if (gfx) { updateGfxStations(t); gfx.app.render(); }
      else tickStations(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return { stop() { stopped = true; cancelAnimationFrame(raf); ro.disconnect(); if (gfx) gfx.app.stage.removeChildren(); } };
  }

  // The <picture> swaps scene at the portrait breakpoint: rebuild the animation for the new art.
  tidyImg.addEventListener("load", () => { if (run) start(); });
  start();
})();
