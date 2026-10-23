/* Hinks Garden Maintenance — scroll-scrubbed hero.
   120 pre-rendered pixel-art frames (public/frames, made by `npm run frames`) are drawn onto a canvas as the
   visitor scrolls: the stage is pinned for about 500vh and GSAP ScrollTrigger maps scroll progress to a frame.
   Scrolling back plays backwards exactly; stopping freezes the frame. Reduced motion: the final frame, no pin. */
(() => {
  const hero = document.getElementById("hero");
  if (!hero) return;

  /* ─── Tweak these ─────────────────────────────────────────────────────── */
  const CONFIG = {
    scrollLength: 4,       // extra scroll distance while pinned, in viewport heights (4 + the stage itself ≈ 500vh)
    scrub: 0.6,            // seconds of smoothing between scroll and frame (ScrollTrigger scrub)
    firstBatch: 10,        // frames loaded before the sequence becomes interactive
    parallel: 6,           // background downloads at once
    portraitZoom: 1.55,    // phones: frame width as a multiple of the screen width (crops the empty left border)
    portraitFocusX: 0.6,   // phones: centre of the crop, as a fraction of the frame width (keeps all four gardeners in view)
  };
  /* ─────────────────────────────────────────────────────────────────────── */

  const COUNT = parseInt(hero.dataset.frames, 10) || 120;
  const src = (i) => hero.dataset.framePath.replace("{n}", String(i + 1).padStart(3, "0"));
  const stage = hero.querySelector(".hero__stage");
  const canvas = hero.querySelector(".hero__canvas");
  const ctx = canvas.getContext("2d");
  const loader = hero.querySelector(".hero__loader");
  const bar = loader.querySelector("span");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const frames = new Array(COUNT);           // HTMLImageElement once decoded
  let current = reduced ? COUNT - 1 : 0, drawn = -1;
  // Frames are drawn in two steps: a whole-number upscale with smoothing off (crisp pixels), then one even step
  // down to the exact size. Drawing straight at a fractional scale with smoothing off makes some rows a pixel
  // taller than others, which shows as faint lines across the picture.
  const off = document.createElement("canvas"), octx = off.getContext("2d");

  /* ── drawing: cover the stage on landscape screens; on portrait phones zoom in on the working area and
        centre it in the space above the copy card ── */
  const card = hero.querySelector(".hero__card");
  function draw(i, force) {
    i = Math.max(0, Math.min(COUNT - 1, Math.round(i)));
    let j = i;
    while (j >= 0 && !frames[j]) j--;                 // not loaded yet: show the nearest earlier frame
    if (j < 0) { j = i; while (j < COUNT && !frames[j]) j++; }
    const img = frames[j];
    if (!img || (j === drawn && !force)) return;
    const W = canvas.width, H = canvas.height, iw = img.naturalWidth, ih = img.naturalHeight;
    const portrait = W / H < 1;
    const s = portrait ? (W * CONFIG.portraitZoom) / iw : Math.max(W / iw, H / ih);
    const dw = Math.round(iw * s), dh = Math.round(ih * s);
    let dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);
    if (portrait) {
      dx = Math.round(Math.min(0, Math.max(W - dw, W / 2 - dw * CONFIG.portraitFocusX)));
      const room = (card ? card.offsetTop : stage.clientHeight) * (H / stage.clientHeight);   // canvas px above the card
      dy = Math.max(0, Math.round((room - dh) / 2));
    }
    const k = Math.max(1, Math.ceil(s - 0.001));
    if (off.width !== iw * k || off.height !== ih * k) { off.width = iw * k; off.height = ih * k; }
    octx.imageSmoothingEnabled = false;
    octx.drawImage(img, 0, 0, off.width, off.height);
    if (portrait || dw < W || dh < H) { ctx.fillStyle = getComputedStyle(hero).backgroundColor; ctx.fillRect(0, 0, W, H); }
    ctx.imageSmoothingEnabled = Math.abs(k - s) > 0.001;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, dx, dy, dw, dh);
    drawn = j;
  }
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    // size the element to exactly backing/dpr so the browser never rescales the canvas itself
    canvas.style.width = canvas.width / dpr + "px";
    canvas.style.height = canvas.height / dpr + "px";
    draw(current, true);
  }

  /* ── loading: first batch straight away, the rest in the background ── */
  let loaded = 0;
  const progress = () => {
    const pct = Math.round((loaded / COUNT) * 100);
    bar.style.width = pct + "%";
    loader.setAttribute("aria-valuenow", pct);
    if (loaded === COUNT) loader.classList.add("is-done");
  };
  const load = (i) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => {
        frames[i] = img; loaded++; progress();
        if (i === current || drawn < 0 || Math.abs(i - current) < Math.abs(drawn - current)) draw(current, true);
        resolve();
      });
    };
    img.onerror = () => { loaded++; progress(); resolve(); };
    img.src = src(i);
  });
  async function loadAll(order) {
    const queue = order.slice();
    const worker = async () => { while (queue.length) await load(queue.shift()); };
    await Promise.all(Array.from({ length: CONFIG.parallel }, worker));
  }

  /* ── start ── */
  window.addEventListener("resize", resize);
  resize();

  if (reduced || !window.gsap || !window.ScrollTrigger) {
    // final frame only, no pin (also the fallback if GSAP failed to load)
    current = COUNT - 1;
    load(COUNT - 1).then(() => draw(current, true));
    loader.classList.add("is-done");
    return;
  }

  const showLoader = setTimeout(() => loader.classList.add("is-visible"), 250);   // only flash the bar on slow connections
  const first = Array.from({ length: Math.min(CONFIG.firstBatch, COUNT) }, (_, i) => i);
  const rest = Array.from({ length: COUNT - first.length }, (_, i) => i + first.length);
  loadAll(first).then(() => {
    clearTimeout(showLoader);
    if (loaded < COUNT) loader.classList.add("is-visible");
    draw(0, true);
    loadAll(rest);

    gsap.registerPlugin(ScrollTrigger);
    const state = { frame: 0 };
    gsap.to(state, {
      frame: COUNT - 1,
      ease: "none",
      onUpdate: () => { current = state.frame; draw(current); hero.classList.toggle("is-scrolled", current > 2); },
      scrollTrigger: {
        trigger: hero,
        start: "top top+=" + (document.getElementById("nav") ? document.getElementById("nav").offsetHeight : 0),
        end: () => "+=" + window.innerHeight * CONFIG.scrollLength,
        pin: stage,
        scrub: CONFIG.scrub,
        invalidateOnRefresh: true,
      },
    });
  });
})();
