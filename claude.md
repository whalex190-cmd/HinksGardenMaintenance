# CLAUDE.md

Marketing website for **Verdant**, a garden design, landscaping and maintenance business (the brand name is a placeholder). The goal is to win enquiries: the site should feel modern, clean and tech-forward while staying professional and trustworthy.

## Stack

- Static HTML, CSS and vanilla JavaScript. No framework, bundler or build step.
- Preview by opening `index.html` in a browser.
- The only external dependency is Google Fonts. Don't add libraries unless asked.

## Structure

```
index.html       Single page: nav, hero, trust marquee, services (dark cards), starting-point
                 tabs, estimator, work gallery, reviews, FAQ, scenic contact form, footer
css/styles.css   All styles. Design tokens live in :root at the top
js/main.js       All interactions (menu, dropdown, tabs, reveal, estimator, form), in one IIFE
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

## Configurable values

- **Estimator pricing:** the `RATES`, `FREQ` and `VISITS` tables in `js/main.js`.
- **Currency:** `CURRENCY` at the top of `js/main.js`.
- **Contact form:** front-end only for now. It posts to the form's `action` URL if one is set (e.g. Formspree); otherwise it just shows the success state.

## Placeholders to replace before launch

Brand name, phone (`0000 000 000`), email (`hello@example.com`), `[Your Area]` / `[Your Town]`, the "1,400+ gardens" stat, the reviews and ratings, and the trust-strip claims. **Never publish invented reviews, statistics or accreditations.**

All photos in `images/` are CC0 stock (from StockSnap and the WordPress Photo Directory), so they're free to use commercially. The "Recent work" gallery, though, must show the business's **real** projects before launch, because presenting stock photos as your own work is misleading.
