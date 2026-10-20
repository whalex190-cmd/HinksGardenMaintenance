# Design System — Hinks Garden Maintenance

The visual rules for the site. When a value here differs from the CSS, this file wins: update the CSS to match.

**Style reference:** [rocket.new](https://www.rocket.new/). We follow its layout and feel (a ruled, framed page; large scenic photography; dark cards on a sky-to-sunset gradient; numbered steps; quiet charcoal buttons), adapted with our own brand, copy and colours. Never copy its text, logos or images.

## Principles

- **Authority through restraint.** Light display type, a warm neutral canvas, thin rules and few accents. The design should feel calm and confident, never loud.
- **Scenery does the selling.** Big, bright garden photography carries the emotion; the UI around it stays quiet.
- **Editorial structure.** Content sits in a ruled frame with clear sections and numbered sequences (01, 02, 03), the way a well-made technical product site would present it.
- **Professional first.** Every section ends in a clear path to a quote. Copy is plain, specific and free of hype.

---

## Brand — Logo

The logo is the word **"Hinks"** in a heavy serif, with a green two-leaf sprout growing from the top of the "s", and **"Garden Maintenance"** in green sans-serif underneath.

- **Built in code**, not as an image (the original file is only 150px). It's in `index.html` as `.logo`: the wordmark is Merriweather 900, loaded for just the five letters, the sprout is inline SVG, and the subline is Inter.
- **Colours:** `--brand-green: #66bf40` (right leaf) and `--brand-green-dark: #4a9e2c` (left leaf, stem, subline). The word is `--ink` on light backgrounds; use white on dark ones.
- **Favicon:** `images/favicon.svg`, the sprout on a dark rounded tile.
- Merriweather is a **logo-only exception** to the three-family rule below. Never use it for headings or text.
- Don't stretch, recolour or restyle the logo, and keep at least 16px of clear space around it.

---

## Tokens — Typography

Three families with strict roles. Don't add a fourth.

```css
:root {
  --font-waldenburg: "Waldenburg", "Inter", system-ui, sans-serif;   /* display only */
  --font-inter: "Inter", system-ui, sans-serif;                       /* everything else */
  --font-geist-mono: "Geist Mono", "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace; /* technical micro-copy */
  --display-weight: 300;
}
```

> **Font loading:** Waldenburg is a commercial typeface and is not on Google Fonts. Until a licence is bought and self-hosted with `@font-face`, the stack falls back to Inter 300. Inter (300/400/500) and Geist Mono are loaded from Google Fonts.

### Waldenburg — display and headings · `--font-waldenburg`

Used for display and heading type only. The 300 weight is deliberately against convention: most sites use 600–700 for headings, and this whisper-weight creates authority through restraint. Tight -0.02em tracking pulls the letters closer at large sizes.

- **Substitute:** Inter (300), or Söhne Light as a premium alternative
- **Weight:** 300 only (set via `--display-weight`)
- **Sizes:** 48px, 36px, 32px
- **Line height:** 1.08–1.17
- **Letter spacing:** -0.02em throughout (-0.96px at 48px, -0.72px at 36px, -0.64px at 32px)
- **OpenType features:** `font-feature-settings: "ss01" on;` if available

### Inter — body and UI · `--font-inter`

Used for everything outside display: body, nav, buttons, links, captions, inputs and cards.

- **Substitute:** system-ui
- **Weights:** 400 (default), 500 (buttons, emphasised links, small titles)
- **Sizes:** 10, 12, 13, 14, 15, 16, 18, 20px
- **Line height:** 1.47–1.6 for paragraphs; the full range is 1.20–2.06 across UI elements
- **Letter spacing:** +0.01em at 14, 15 and 16px; normal at other sizes

### Geist Mono — technical micro-copy · `--font-geist-mono`

Used sparingly for technical labels and metadata: card numbers (`01`), section labels ("Instant estimate"), measurements ("100 m²"), and review or project meta.

- **Substitute:** JetBrains Mono or IBM Plex Mono
- **Weight:** 400
- **Size:** 13px
- **Line height:** 1.69

### Type scale

| Token | Family | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|---|
| `display-xl` | Waldenburg | 48px | 300 | 1.08 | -0.96px | Section H2 |
| `display-lg` | Waldenburg | 36px | 300 | 1.12 | -0.72px | Hero H1 (in its card), prices, mobile H2 |
| `display-md` | Waldenburg | 32px | 300 | 1.17 | -0.64px | Card headings, step numbers |
| `body-lg` | Inter | 18px | 400 | 1.55 | normal | Section intros, quotes |
| `title` | Inter | 18px | 500 | 1.4 | normal | Step and list titles |
| `body` | Inter | 16px | 400 | 1.6 | 0.01em | Default paragraph |
| `body-sm` | Inter | 15px | 400 | 1.6 | 0.01em | Card text, FAQ answers, nav links |
| `ui` | Inter | 14px | 500 | 1 | 0.01em | Buttons, card labels, form legends |
| `caption` | Inter | 13px | 400–500 | 1.5 | normal | Form labels, helper text |
| `tag` | Inter | 10px | 500 | 1.2 | 0.04em, uppercase | Tag pills on dark cards |
| `mono` | Geist Mono | 13px | 400 | 1.69 | normal | Numbers, labels, metadata |

On mobile (≤640px), H1 and H2 step down to 36px, and card headings and step numbers drop to 28px. Body sizes stay the same.

**Rules**
- Never bold a Waldenburg heading. For emphasis inside a heading, use colour, not weight.
- Never use Inter above 20px, or Waldenburg below 28px.
- Don't use weight 600 or above anywhere.

---

## Tokens — Colour

```css
:root {
  --canvas:   #f5f3ef;  /* warm off-white page background */
  --surface:  #ffffff;  /* raised light surfaces, inputs */
  --line:     #e4e0da;  /* frame rules and dividers */
  --ink:      #1a1918;  /* primary text */
  --ink-2:    #57534e;  /* secondary text */
  --ink-3:    #8f8a84;  /* tertiary text */
  --charcoal: #2f2c2a;  /* primary button */
  --card:     #201e1d;  /* dark service cards */
  --card-ink: #a9a49e;  /* body text on dark cards */
  --card-btn: #e4e0da;  /* light button inside dark cards */
  --deep:     #10261d;  /* dark band (estimator) */
  --link:     #3b7d22;  /* inline links with arrow (brand green, darkened for AA contrast) */
  --sky:      #c4defb;  /* gradient blue */
  --sun:      #fdb54e;  /* gradient orange glow */
  --label-blue:   #4b8bff;  /* card label: Design */
  --label-orange: #f39a3d;  /* card label: Build */
  --label-green:  #6cc24a;  /* card label: Care, and accents on dark */
  --brand-green:      #66bf40;  /* logo only */
  --brand-green-dark: #4a9e2c;  /* logo only */
}
```

- The UI is neutral: charcoal, warm white and ink. Colour comes from photography and the sky-to-sun gradient.
- The three label colours are only used for the service-card labels (and green for accents on the dark band).
- Green `--link` is used for inline text links only.

## Layout — The frame

The signature of the style is a ruled page:

- **`.band`** spans the full viewport and draws a 1px `--line` rule along its bottom edge.
- **`.frame`** is the centred 1264px column with 1px `--line` rules on its left and right sides.
- Together they create a continuous grid of lines framing every section. Photos and gradients fill the frame edge to edge.
- Horizontal padding inside the frame is 48px (32px at ≤1100px, 16px on mobile). Sections use 120px vertical padding (80px on mobile).
- On mobile (≤640px) the side rules are removed; the section rules remain.

## Shape & depth

| Use | Radius |
|---|---|
| Buttons, inputs, chips | 6px |
| Cards, photos, dropdowns | 10px |
| Panels (estimator, form) | 14px |
| Tag pills | 999px |

Shadows are rare. Use them only on floating things: the dropdown, the contact form over the photo, and the hover lift on dark cards.

## Motion

- Easing: `cubic-bezier(.2, .7, .2, 1)` for everything.
- Content fades and rises 16px into view on scroll (800ms), with siblings staggered by 80ms.
- The hero animation (see Components) is the one long sequence on the page. Everything else stays subtle.
- Trust items scroll in a continuous marquee and pause on hover.
- Hover feedback is subtle: dark cards lift 6px, gallery photos zoom to 104%, and arrows nudge 3px.
- Respect `prefers-reduced-motion`: turn off all animation and show content immediately.

## Components

- **Nav:** sticky, 54px tall, a frosted canvas background and a bottom rule. Logo on the left, centred links (Services opens a dropdown), phone number and a small charcoal CTA on the right.
- **Hero:** a full-bleed animated pixel-art garden (`js/hero.js`), the height of the screen minus the nav. It opens on an untidy garden. A gardener mows the lawn stripe by stripe, revealing the tidy lawn behind him, while the rest of the garden tidies with a soft front-to-back wipe. Three more gardeners work at the pool, the hedge and in the oak. A Replay button appears when he finishes. The copy sits in a frosted canvas-coloured card at the bottom left: a mono eyebrow, a 36px H1, the lead text, and two buttons (charcoal and white). On phones the card is compact (no lead, 24px H1, buttons side by side) so it never covers the lawn. Reduced motion shows the finished garden.
- **Buttons:** 40px tall (44px for `--lg`) with a 6px radius and Inter 500 at 14px. *Dark* is charcoal on white text, *light* is white with ink text, and *card* is full-width `--card-btn` inside dark cards.
- **Service cards:** `--card` background with a 10px radius. Inside: a mono number, a coloured label, a 32px light heading, grey body text, outlined uppercase tags, and a full-width light button pinned to the bottom. They sit on the sky-to-sun gradient.
- **Tabs + steps:** text tabs with a 2px ink underline on the active tab. Steps sit in 4 columns separated by vertical rules, each with a large light-grey number, an Inter 500 title and grey body text.
- **Link-arrow:** green Inter 500 text with an arrow that nudges right on hover.
- **Gallery:** one tall photo next to two stacked ones, each with a frosted caption chip (a mono category plus a title).
- **Reviews:** three columns separated by vertical rules, with no card backgrounds.
- **FAQ:** a ruled accordion whose plus icon rotates into a cross.
- **Contact finale:** a full-frame scenic photo with a centred heading and a frosted white form panel.
- **Footer:** four columns with uppercase grey headings, then the logo and legal line under a rule.

## Imagery

- Bright, natural, wide-angle garden scenes with plenty of sky. Gardens should look aspirational but achievable.
- Real project photos must replace the stock placeholders before launch.
- AI-generated images and video (from `tools/`) are fine for **mood and atmosphere**: hero backgrounds, section scenery and texture. Never use them in "Recent work" or anywhere that implies a real job Hinks completed.
- Video backgrounds must be muted, looping, ≤8 seconds, and have a still `poster` image. Show the still instead when `prefers-reduced-motion` is set.
- **Hero animation:** an illustrated pixel-art scene. This is an allowed AI use, because it's clearly an illustration, not a claimed job.
  - It has its own warm sunrise palette (`images/hero/palette.json`), separate from the UI tokens.
  - It sits on a true pixel grid: 480×272 at ×4. Render it with `image-rendering: pixelated`.
  - How to produce it: `images/hero/RUNBOOK.md`.
- Export at no more than 1920px wide, as JPEG at roughly 80% quality, and lazy-load everything below the hero.

## Accessibility

- Body text must meet WCAG AA contrast (4.5:1). Light display weight is only used at 28px and above.
- Text over photos always sits on a haze or gradient that keeps it readable.
- Every interactive element has a visible `:focus-visible` state. Tabs support arrow keys, and the dropdown opens on click and closes with Escape.
- Tap targets are at least 40×40px.
