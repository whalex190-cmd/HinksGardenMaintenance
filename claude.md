# CLAUDE.md

Marketing website for **Hinks Garden Maintenance**, a garden maintenance, design and landscaping business. Repo: https://github.com/whalex190-cmd/HinksGardenMaintenance The goal is to win enquiries: the site should feel modern, clean and tech-forward while staying professional and trustworthy.

## Stack

- Static HTML, CSS and vanilla JavaScript. No framework, bundler or build step.
- **Preview with `npm run dev`**, then open http://localhost:8080. WebGL can't load textures over `file://`. Opening `index.html` directly still works, but it falls back to the older DOM sprites.
- **External dependencies:** Google Fonts, and PixiJS 8.6.6 from jsDelivr (pinned), which draws the hero's sprite layer. Don't add other libraries unless asked.

## Structure

```
index.html       Single page: nav, hero, trust marquee, services (dark cards), starting-point
                 tabs, estimator, work gallery, reviews, FAQ, scenic contact form, footer
css/styles.css   All styles. Design tokens live in :root at the top
js/main.js       All interactions (menu, dropdown, tabs, reveal, estimator, form), in one IIFE
js/hero.js       The animated hero (mowing, wipe, station gardeners). Tweak values in CONFIG/SCENES at the top
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

## Sprite generation (Node, build time only)

`scripts/generate-assets.js` generates every gardener and prop sprite sheet with OpenAI. It's the only place the API is called. The website only loads static files from `public/assets/`.

- **Run it:** `npm run assets` generates missing sheets, then post-processes. `npm run assets:process` post-processes only, with no API calls. You need Node 24, which is installed per-user under `%LOCALAPPDATA%\Programs\node-v24.20.0-win-x64`, plus `npm install` for the dev-only `pngjs` and `gifenc`.
- **Key:** read from `OPENAI_API_KEY` or `.env`. It's never printed, logged or written to disk.
- **Sheets:** defined in `SHEETS`, one per action, each with a frame-by-frame pose list. Each one is a single row on `#FF00FF`, generated with the edit endpoint using the references in `assets-src/refs/`.
- **Cache:** `assets-src/raw/<id>.png` is git-ignored, and a cached sheet is never regenerated. To retry one, pass `--regenerate=<id>`. Each sheet gets 2 attempts at most (tracked in `assets-src/manifest.json`); after that, draw it in code instead.
- **Output:** `public/assets/sprites/<id>.png` + `.json`, `atlas.png` + `atlas.json` (PixiJS spritesheet format, anchor at the feet), and `public/assets/palette.json`, which comes from the backgrounds. QC previews go in `qc/index.html`. Check them before wiring sheets into the scene.
- **Pixel density:** `SPRITE_DENSITY` (4/3) makes the sprites one step finer than the 480×272 scene grid. `atlas.meta.pixelRatio` (0.75) and `atlas.meta.fps` tell `js/hero.js` how to scale and time each sheet.
- **In the scene:** `js/hero.js` loads the atlas into PixiJS.
  - The mower man uses `mower-walk-back` and `mower-walk-front`.
  - The station gardeners follow `STATIONS`: per-scene scripted step lists with positions in scene fractions. Steps can loop to fill the mowing time, the planter can shuffle sideways and leave plants behind, and the tree climber can drop the branch.
  - If PixiJS or the atlas can't load, the page falls back to the old DOM sprites in `public/assets/hero/`.

## Hero animation assets (pixel art)

The animated hero (an untidy garden tidied by Hinks gardeners) is built in **`js/hero.js`**, ported from the Claude Design prototype (https://claude.ai/artifact/CVS22ibfBZ3NeCiLEfUYc1). Its art is generated with **`images/hero/RUNBOOK.md`**.

- **What the site loads:** the native-size scenes in `images/hero/web/` (480×272 and 272×480, scaled up crisply with `image-rendering: pixelated`), plus the sprite sheets in `images/hero/`. The ×4 PNGs in `images/hero/` are masters.
- **Scenes:** `<picture>` chooses desktop or portrait at `(max-aspect-ratio: 4/5)`, and the script rebuilds for the art that loaded. `SCENES.*.lawn` must equal `lawn` in `regions-*.json`.
- **Checking a moment:** add `#t=12` to the URL to jump 12 seconds in. Headless browsers don't advance the animation in virtual time, so screenshot with `#t=`.

- `tools/hero-assets.ps1` handles the offline jobs, which are free: `mask`, `stripe`, `composite`, `pixelate`, `diff`, `slice`, `pack`, `crop`, `place` and `check`. It uses `tools/ImageTools.cs`, which must compile as C# 5 because that's what PowerShell 5.1 uses.
- Never re-prompt a whole scene to get a variant. Make a masked edit, then `composite`, so the untidy and tidy scenes stay pixel-aligned. `check` must PASS.
- The lawn stripes are drawn by `stripe` from the `lawn` geometry in `regions-*.json`. That geometry must match the engine's `CONFIG.lawn`.
- Prompts live in `images/hero/prompts/`. Working files go in `images/hero/src/`, which is git-ignored except `reference/`. Finals go in `images/hero/`.

## Configurable values

- **Estimator pricing:** the `RATES`, `FREQ` and `VISITS` tables in `js/main.js`.
- **Currency:** `CURRENCY` at the top of `js/main.js`.
- **Contact form:** front-end only for now. It posts to the form's `action` URL if one is set (e.g. Formspree); otherwise it just shows the success state.

## Placeholders to replace before launch

Phone (`0000 000 000`), email (`hello@example.com`), `[Your Area]` / `[Your Town]`, the "1,400+ gardens" stat, the reviews and ratings, and the trust-strip claims. **Never publish invented reviews, statistics or accreditations.**

All photos in `images/` are CC0 stock (from StockSnap and the WordPress Photo Directory), so they're free to use commercially. The "Recent work" gallery, though, must show the business's **real** projects before launch, because presenting stock photos as your own work is misleading.
