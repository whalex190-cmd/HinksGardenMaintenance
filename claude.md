# CLAUDE.md

Marketing website for **Hinks Garden Maintenance**, a garden maintenance, design and landscaping business. Repo: https://github.com/whalex190-cmd/HinksGardenMaintenance The goal is to win enquiries: the site should feel modern, clean and tech-forward while staying professional and trustworthy.

## Stack

- Static HTML, CSS and vanilla JavaScript. No framework, bundler or build step.
- **Preview with `npm run dev`**, then open http://localhost:8080. WebGL can't load textures over `file://`. Opening `index.html` directly still works, but it falls back to the older DOM sprites.
- **External dependencies:** Google Fonts, and GSAP 3.12.5 + ScrollTrigger from cdnjs (pinned), which scrub the hero. Don't add other libraries unless asked.

## Structure

```
index.html       Single page: nav, hero, trust marquee, services (dark cards), starting-point
                 tabs, estimator, work gallery, reviews, FAQ, scenic contact form, footer
css/styles.css   All styles. Design tokens live in :root at the top
js/main.js       All interactions (menu, dropdown, tabs, reveal, estimator, form), in one IIFE
js/scroll-hero.js  The scroll-scrubbed hero: draws public/frames/frame_###.webp onto a canvas as you scroll. CONFIG at the top
images/          Site photography (CC0 stock placeholders, see below)
design.md        Design system: typography, colour, layout frame, motion, components
```

## Design

**`design.md` is the source of truth for all visual decisions.** Read it before any UI work. If the CSS differs from it, update the CSS to match.

The style is modelled on rocket.new: a ruled, framed page, scenic photography, dark cards on a sky-to-sunset gradient, and numbered steps. Use it for layout and feel only. Never copy its text, logos or images.

Key rules:
- Waldenburg (fallback: Inter 300) for headings only, at 48/36/32px, weight `var(--display-weight)` (300), -0.02em tracking.
- Inter 400/500 for everything else. Geist Mono 13px for numbers, labels and metadata.
- The UI stays neutral (charcoal, warm white, ink). Colour comes from photos and the gradient.
- Every section is a `.band` (full-width bottom rule) wrapping a `.frame` (centred column with side rules).
- Always use the CSS custom properties. Don't hard-code colours, fonts or radii.

## Conventions

- **CSS:** BEM-style class names (`.block__element--modifier`). Mobile breakpoints at 1040, 860 and 640px. Every animation must respect `prefers-reduced-motion`.
- **JS:** plain ES2020+, no dependencies. Guard each feature with a null check so the script doesn't break on pages without that section.
- **HTML:** semantic elements, `aria-*` on custom controls, a visible focus state for everything interactive.
- **Copy:** UK English and £ / m². Write plainly and specifically, without hype. Every section should lead towards a quote.

## AI image & video generation (OpenAI)

Assets are generated **offline on the developer's PC** and saved into `images/`. The website never calls OpenAI and never contains the key.

- **Key:** in `.env` as `OPENAI_API_KEY=...` (copy `.env.example`). `.env` is git-ignored. **Never put the key in `index.html`, `js/` or any committed file**, because the repo is public.
- **Images:** `tools/generate-image.ps1 -Prompt "..." -Out images/name.jpg [-Size 1536x864] [-Quality high] [-Count 3]`. Defaults to `gpt-image-2`; any `WIDTHxHEIGHT` divisible by 16 works.
- **Video:** `tools/generate-video.ps1 -Prompt "..." -Out images/name.mp4 [-Seconds 4|8|12] [-Size 1280x720] [-Reference images/photo.jpg]`. Uses Sora (`sora-2`, or `sora-2-pro` for higher quality). It polls until the clip is ready, which takes a few minutes.
- Both scripts append a shared house style (see `$HouseStyle` in `tools/openai-common.ps1`) so the output matches design.md → Imagery. Pass `-NoHouseStyle` to turn it off.
- Shared code lives in `tools/openai-common.ps1`. The scripts are PowerShell 5.1 with no dependencies, and use the built-in `curl.exe` for uploads.
- Keep web assets small: re-encode images to ≤1920px wide, JPEG at about 80%. Keep hero videos short (≤8s), muted and looping, with a poster image.
- Edit mode: `generate-image.ps1 -Image a.png[,ref.png...] [-Mask m.png] [-Transparent] -Style pixel|photo|none`. Edits go to `/v1/images/edits`; transparent pixels in the mask mark the area to change.

## Scroll hero (pixel-art frame sequence)

The hero is 120 pre-rendered frames scrubbed by scroll (pinned ~500vh, GSAP ScrollTrigger, `js/scroll-hero.js`). Frames are built offline by a Node pipeline; the website never calls OpenAI.

- **Pipeline** (Node 24, per-user install; `npm install` once):
  - `npm run plan`: `assets/config.json` → `assets/frames.json` (every station's pose, position and prop state per frame). No API.
  - `npm run sprites`: generates the sheets listed in `assets/sprites.json` with the OpenAI image edit endpoint. It prints a call estimate and asks to confirm (`--yes` skips the prompt). Results are cached in `assets/cache/` by a prompt hash (git-ignored); `--force=<id>` regenerates one sheet, with at most 2 attempts each. QC sheets and GIFs go in `qc/sprites/`.
  - `npm run frames`: composites `assets/masters/frame_###.png` and `public/frames/frame_###.webp` at the native 960×544 (lossless WebP, about 215 KB a frame). No API. `--only=mower,planter` limits the stations. Hand-placed pixel distances in `frames.js` are multiplied by `K = W / 480`, because the pipeline was tuned on the original 480-wide grid.
  - `npm run preview`: writes `qc/contact-sheet.png` and `qc/preview.mp4` (12 fps).
- **Backgrounds:** `assets/garden-untidy-clean.png` and `garden-tidy-clean.png` are 1920×1088 masters on a 960×544 pixel grid (×2 blocks), aligned, with the 97-colour `assets/palette-960.json`. They come from the full-resolution plates `assets/patio/full-tidy.png` / `full-untidy.png` (the original renders plus the patio edit), snapped with `tools/hero-assets.ps1 -Action pixelate -Native 960x544 -Scale 2`.
- **Drawing in the browser:** `scroll-hero.js` scales each frame up by a whole number with smoothing off, then steps down once to the exact size. Drawing straight at a fractional scale with smoothing off gives uneven row heights, which show as faint lines across the picture.
- **Ambient effects:** drifting clouds, wind sway in foliage, the banded sun glow and a butterfly. Their settings are in `config.ambient`.
- **Checking scroll:** headless browsers with virtual time don't fire scroll updates. Test with a real-time DevTools-protocol script instead.
- **Older material:** `public/assets/hero/`, `public/assets/sprites/`, `scripts/generate-assets.js` and `images/hero/` are from earlier hero versions. The current page no longer loads them.

## Configurable values

- **Estimator pricing:** the `RATES`, `FREQ` and `VISITS` tables in `js/main.js`.
- **Currency:** `CURRENCY` at the top of `js/main.js`.
- **Contact form:** front-end only for now. It posts to the form's `action` URL if one is set (e.g. Formspree); otherwise it just shows the success state.

## Placeholders to replace before launch

Phone (`0000 000 000`), email (`hello@example.com`), `[Your Area]` / `[Your Town]`, the "1,400+ gardens" stat, the reviews and ratings, and the trust-strip claims. **Never publish invented reviews, statistics or accreditations.**

All photos in `images/` are CC0 stock (from StockSnap and the WordPress Photo Directory), so they're free to use commercially. The "Recent work" gallery, though, must show the business's **real** projects before launch, because presenting stock photos as your own work is misleading.
