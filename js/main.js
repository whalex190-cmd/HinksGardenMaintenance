/* Hinks Garden Maintenance — site interactions */
(() => {
  const CURRENCY = "£";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobile menu ---------- */
  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");

  const setMenu = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    links.classList.toggle("is-open", open);
  };
  toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
  links.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });

  /* ---------- Services dropdown (click/keyboard; hover handled in CSS) ---------- */
  document.querySelectorAll(".nav__item").forEach((item) => {
    const trigger = item.querySelector(".nav__trigger");
    trigger.addEventListener("click", () => {
      const open = !item.classList.contains("is-open");
      item.classList.toggle("is-open", open);
      trigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!item.contains(e.target)) {
        item.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    setMenu(false);
    document.querySelectorAll(".nav__item.is-open").forEach((i) => i.classList.remove("is-open"));
  });

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  document.querySelectorAll(".cards, .reviews, .gallery").forEach((group) => {
    [...group.querySelectorAll(":scope > .reveal")].forEach((el, i) => el.style.setProperty("--d", `${i * 0.08}s`));
  });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---------- Starting-point tabs ---------- */
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selectTab = (tab, focus) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      selectTab(tabs[(i + dir + tabs.length) % tabs.length], true);
    });
  });

  /* ---------- Price estimator ----------
     Edit these rates to match your real pricing.
     perM2: price per m² per visit; min: minimum charge; recurring: whether frequency applies. */
  const RATES = {
    maintenance: { perM2: 0.32, min: 45,   recurring: true,  note: "Includes green waste removal" },
    lawn:        { perM2: 0.18, min: 35,   recurring: true,  note: "Feed, weed & moss control" },
    hedges:      { perM2: 0.45, min: 80,   recurring: false, note: "Trimming, shaping & waste removal" },
    clearance:   { perM2: 1.6,  min: 180,  recurring: false, note: "Full clearance, skip-free" },
    design:      { perM2: 55,   min: 3500, recurring: false, note: "Design, materials & build" },
  };
  // Per-visit multiplier by frequency (regular plans are cheaper per visit)
  const FREQ = { once: 1.25, monthly: 1.05, fortnightly: 1, weekly: 0.9 };
  const VISITS = { monthly: 1, fortnightly: 2, weekly: 4 };

  const calc = document.getElementById("calc");
  if (calc) {
    const size = document.getElementById("size");
    const sizeOut = document.getElementById("sizeOut");
    const freqGroup = document.getElementById("freqGroup");
    const lowEl = document.getElementById("priceLow");
    const highEl = document.getElementById("priceHigh");
    const label = document.getElementById("resultLabel");
    const note = document.getElementById("resultNote");
    const priceWrap = lowEl.parentElement;
    const formService = document.getElementById("formService");

    const fmt = (n) => CURRENCY + Math.round(n).toLocaleString("en-GB");
    const roundNice = (n) => (n >= 1000 ? Math.round(n / 50) * 50 : Math.round(n / 5) * 5);

    const update = () => {
      const service = calc.querySelector("[name=service]:checked").value;
      const freq = calc.querySelector("[name=freq]:checked").value;
      const m2 = Number(size.value);
      const rate = RATES[service];

      sizeOut.textContent = `${m2} m²`;
      size.style.setProperty("--fill", `${((m2 - size.min) / (size.max - size.min)) * 100}%`);
      freqGroup.classList.toggle("is-disabled", !rate.recurring);

      let perVisit = Math.max(rate.min, m2 * rate.perM2);
      if (rate.recurring) perVisit *= FREQ[freq];

      const monthly = rate.recurring && freq !== "once";
      const value = monthly ? perVisit * VISITS[freq] : perVisit;
      label.textContent = monthly ? "Estimated per month" : rate.recurring ? "Estimated one-off visit" : "Estimated project cost";
      note.textContent = monthly ? `${rate.note} · ${fmt(perVisit)} per visit` : rate.note;

      lowEl.textContent = fmt(roundNice(value * 0.88));
      highEl.textContent = fmt(roundNice(value * 1.15));

      if (!reduceMotion) {
        priceWrap.classList.add("bump");
        clearTimeout(update.t);
        update.t = setTimeout(() => priceWrap.classList.remove("bump"), 150);
      }

      if (formService) formService.value = service;
    };

    calc.addEventListener("input", update);
    update();
  }

  /* ---------- Contact form ----------
     Front-end only. To receive enquiries, add action="https://..." to the
     <form> pointing at a form service (e.g. Formspree) or your own backend. */
  const form = document.getElementById("contactForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let ok = true;
      form.querySelectorAll("[required]").forEach((input) => {
        const valid = input.value.trim() && input.checkValidity();
        input.closest(".field").classList.toggle("is-invalid", !valid);
        if (!valid && ok) { input.focus(); ok = false; }
      });
      if (!ok) return;

      const endpoint = form.getAttribute("action");
      if (endpoint) {
        try {
          const res = await fetch(endpoint, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
          if (!res.ok) throw new Error(res.statusText);
        } catch {
          alert("Sorry, something went wrong. Please call or email us instead.");
          return;
        }
      }
      form.querySelector(".form__success").hidden = false;
      form.reset();
    });
    form.addEventListener("input", (e) => e.target.closest(".field")?.classList.remove("is-invalid"));
  }

  document.getElementById("year").textContent = new Date().getFullYear();
})();
