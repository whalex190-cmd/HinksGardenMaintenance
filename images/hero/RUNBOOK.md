# Hero animation assets: runbook

The exact commands to generate the hero animation art with OpenAI and our `tools/` scripts. The plan behind this file explains why each step exists.

Run everything from the project root in PowerShell. The setup steps you need first are in `claude.md` → *AI image & video generation*.

```powershell
$P = 'images/hero/prompts'          # prompt files
$S = 'images/hero/src'              # working files (git-ignored)
$H = 'images/hero'                  # finals (committed)
$R = 'images/hero/regions-desktop.json'
```

**Rules**

- Every hero call uses `-Style pixel`, never the photo style.
- After **every** masked edit, run `composite`. Pixels outside the mask then stay identical, which is what keeps the wipe from jumping.
- Generate a few variants with `-Count 3` or `-Count 4`. Variants save as `name.png`, `name-2.png`, `name-3.png` and so on. Pick the best one and copy it over `name.png` before the next step.
- Every working size is **1920×1088** (or **1088×1920** for portrait), so regions never need converting. Finals use a 480×272 pixel grid (272×480 for portrait) at ×4.
- Sprites keep their own colours. **Don't** pass the scene palette to `pack`, because it turns the white shirt lavender.
- `generate-image.ps1` costs money. `hero-assets.ps1` is free and runs offline.

## As built (October 2026): what changed from the plan

The kit in `images/hero/` was produced with the commands below, apart from these changes. **When the phases below disagree with this section, follow this section.**

1. **Transparent sprites need a different model.** `gpt-image-2` rejects `background=transparent`, so every `-Transparent` call used `-Model gpt-image-2.5-sunburst`.

2. **Masked edits redraw the whole scene.** A masked edit with `gpt-image-2` still recomposes the image, which moves the lawn and the pool. What worked was an unmasked, high-fidelity edit of a 1:1 window, pasted back and composited through the mask:

   ```powershell
   .\tools\hero-assets.ps1 -Action crop -In "$S/d-tidy-striped.png" -Rect "192,64,1536,1024" -Out "$S/win-tidy.png"
   .\tools\generate-image.ps1 -Model gpt-image-1.5 -InputFidelity high -Style pixel -Image "$S/win-tidy.png" -Prompt "<redraw identically, only make it untidy...>" -Size 1536x1024 -Count 2 -Out "$S/win-untidy.png"
   .\tools\hero-assets.ps1 -Action place -Base "$S/d-tidy-striped.png" -In "$S/win-untidy-2.png" -At "192,64" -Out "$S/d-untidy-placed.png"
   .\tools\hero-assets.ps1 -Action composite -Base "$S/d-tidy-striped.png" -In "$S/d-untidy-placed.png" -Mask "$S/mask-d-untidy.png" -Feather 16 -Out "$S/d-untidy.png"
   ```

   For portrait, the window is `-Rect "32,192,1024,1536"` with `-Size 1024x1536`.

3. **No canopy in the untidy mask.** The untidy mask is `lawn,hedges-l,hedges-r,borders-l,borders-r,pool`. Edits of the oak canopy left a visible patch, so there's no overhanging branch.

4. **Station gardeners are animated sprites, not static layers.** `js/hero.js` places them (see `SCENES.desktop.stations`), so `diff` isn't used for them, and there's no branch layer. The packs:

   ```powershell
   .\tools\hero-assets.ps1 -Action pack -In "$S/pool-plant.png" -Frames 6 -Height 84  -Gap 40 -Out "$H/gardener-pool.png"
   .\tools\hero-assets.ps1 -Action pack -In "$S/hedge-trim.png" -Frames 6 -Height 172 -Gap 3  -Out "$H/gardener-hedge.png"
   .\tools\hero-assets.ps1 -Action pack -In "$S/tree-saw.png"   -Frames 6 -Height 124 -Gap 3  -Out "$H/gardener-tree.png"
   ```

5. **The walk cycles needed two extra options.** `-Rotate 2` makes frames 0 and 4 the legs-together poses. The back-view mower needs `-CompanionWidth`, because it's wider than its model:

   ```powershell
   .\tools\hero-assets.ps1 -Action pack -In "$S/walk-back.png"  -Frames 8 -Rotate 2 -Height 128 -Companion "$S/mower-back.png"  -CompanionHeight 64 -CompanionWidth 54 -CompanionOffset "0,-10" -Out "$H/mower-man-back.png"  -CompanionOut "$H/mower-back.png"
   .\tools\hero-assets.ps1 -Action pack -In "$S/walk-front.png" -Frames 8 -Rotate 2 -Height 128 -Companion "$S/mower-front.png" -CompanionHeight 80 -CompanionOffset "0,14" -CompanionInFront -Out "$H/mower-man-front.png" -CompanionOut "$H/mower-front.png"
   ```

6. **Palette:** `-ExtractPalette -Colors 56`. It also keeps the brightest and darkest colours, so the sun and the outlines survive.

7. **Web copies:** `images/hero/web/*.png` are the finals box-downscaled ×4 back to 480×272 (272×480 for portrait). They match the ×4 images exactly.

8. **Variants picked:**

   | Asset | Variant |
   |---|---|
   | Desktop master | 4 |
   | Gardener model | 4 |
   | Mower model | 1 |
   | Walk cycles | 3 (back) and 3 (front) |
   | Portrait master | 3 |
   | Desktop untidy | the no-mask variant 2 |
   | Portrait untidy | 2 |
   | Station sheets | 1 each |

9. **Alignment check results:** desktop 0.011%, portrait 0.010% of pixels differ outside the mask. Both PASS.

## Phase 1: Lock the style and character  *(the user approves before Phase 2)*

```powershell
# 1. Desktop clean plate, based on the v1 art
.\tools\generate-image.ps1 -Style pixel -Image "$S/reference/tidy-v1.png" -Prompt (Get-Content "$P/scene-master.txt" -Raw) -Size 1920x1088 -Count 4 -Out "$S/d-tidy-clean.png"

# 2. Fit the regions to the chosen plate (edit $R until the outlines sit right)
.\tools\hero-assets.ps1 -Action mask -Preview -In "$S/d-tidy-clean.png" -Regions $R -Names lawn,hedges-l,hedges-r,borders-l,borders-r,pool,canopy-r,station-pool,station-hedge,station-tree,station-mower-home,text-card -Out "$S/regions-preview.png"

# 3. Gardener model sheet (transparent)
.\tools\generate-image.ps1 -Style pixel -Transparent -Image "$S/reference/sprites-v1.png","$S/d-tidy-clean.png" -Prompt (Get-Content "$P/gardener-model.txt" -Raw) -Size 1536x1024 -Count 4 -Out "$S/gardener-model.png"

# 4. Mower model sheet (transparent), then cut it into back and front views
.\tools\generate-image.ps1 -Style pixel -Transparent -Image "$S/reference/sprites-v1.png","$S/d-tidy-clean.png" -Prompt (Get-Content "$P/mower-model.txt" -Raw) -Size 1536x1024 -Count 3 -Out "$S/mower-model.png"
.\tools\hero-assets.ps1 -Action slice -In "$S/mower-model.png" -Out "$S/mower"     # -> mower-1.png (back), mower-2.png (front): rename to mower-back.png / mower-front.png
```

If `-Transparent` errors with `gpt-image-2` (it's in preview for that model), add `-Model gpt-image-1.5`.

The lawn has no stripes yet. When you fit the `lawn` geometry in step 2, line it up with the lawn's edges. Those numbers then become the engine's `CONFIG.lawn`.

## Phase 2: Desktop backgrounds

```powershell
# 1. Stripe the lawn (matches the engine's 11 stripes exactly)
.\tools\hero-assets.ps1 -Action stripe -In "$S/d-tidy-clean.png" -Regions $R -Out "$S/d-tidy-striped.png"

# 2. Make it untidy: masked edit, then composite back onto the plate
.\tools\hero-assets.ps1 -Action mask -In "$S/d-tidy-striped.png" -Regions $R -Names lawn,hedges-l,hedges-r,borders-l,borders-r,pool,canopy-r -Grow 6 -Out "$S/mask-d-untidy.png"
.\tools\generate-image.ps1 -Style pixel -Image "$S/d-tidy-striped.png" -Mask "$S/mask-d-untidy.png" -Prompt (Get-Content "$P/untidy.txt" -Raw) -Size 1920x1088 -Count 3 -Out "$S/d-untidy-raw.png"
.\tools\hero-assets.ps1 -Action composite -Base "$S/d-tidy-striped.png" -In "$S/d-untidy-raw.png" -Mask "$S/mask-d-untidy.png" -Feather 12 -Out "$S/d-untidy.png"

# 3. Shared palette + true pixel grid
.\tools\hero-assets.ps1 -Action pixelate -In "$S/d-tidy-striped.png" -ExtractPalette -Palette "$H/palette.json" -Out "$H/d-tidy-clean.png"
.\tools\hero-assets.ps1 -Action pixelate -In "$S/d-untidy.png" -Palette "$H/palette.json" -Out "$H/d-untidy-clean.png"

# 4. Alignment check: must PASS (< 0.5% of pixels differ outside the mask)
.\tools\hero-assets.ps1 -Action check -In "$H/d-untidy-clean.png" -Base "$H/d-tidy-clean.png" -Mask "$S/mask-d-untidy.png"

# 5. Station gardeners (static layers for now), on the tidy plate
.\tools\hero-assets.ps1 -Action mask -In "$S/d-tidy-striped.png" -Regions $R -Names station-pool,station-hedge,station-tree -Grow 4 -Out "$S/mask-d-stations.png"
.\tools\generate-image.ps1 -Style pixel -Image "$S/d-tidy-striped.png","$S/gardener-model.png" -Mask "$S/mask-d-stations.png" -Prompt (Get-Content "$P/stations.txt" -Raw) -Size 1920x1088 -Count 3 -Out "$S/d-tidy-stations-raw.png"
.\tools\hero-assets.ps1 -Action composite -Base "$S/d-tidy-striped.png" -In "$S/d-tidy-stations-raw.png" -Mask "$S/mask-d-stations.png" -Feather 6 -Out "$S/d-tidy-stations.png"
.\tools\hero-assets.ps1 -Action pixelate -In "$S/d-tidy-stations.png" -Palette "$H/palette.json" -Out "$S/d-tidy-stations-pix.png"
foreach ($st in 'pool', 'hedge', 'tree') {
  .\tools\hero-assets.ps1 -Action diff -In "$S/d-tidy-stations-pix.png" -Base "$H/d-tidy-clean.png" -Regions $R -Names "station-$st" -Out "$H/layer-d-$st-gardener.png"
}
# (Optional) the same on the untidy plate, using the same masks: base d-untidy.png -> layer-d-<st>-gardener-untidy.png

# 6. Branch layer (in the untidy scene only), for the falling-branch animation later
.\tools\hero-assets.ps1 -Action diff -In "$H/d-untidy-clean.png" -Base "$H/d-tidy-clean.png" -Regions $R -Names canopy-r -Out "$H/layer-d-branch.png"
```

Each `diff` also writes a `.json` file giving the layer's position as both pixels and fractions of the scene.

## Phase 3: Portrait backgrounds (phones)

```powershell
$RP = 'images/hero/regions-portrait.json'    # copy regions-desktop.json and refit it with -Preview
.\tools\generate-image.ps1 -Style pixel -Image "$H/d-tidy-clean.png","$S/gardener-model.png" -Prompt (Get-Content "$P/portrait.txt" -Raw) -Size 1088x1920 -Count 4 -Out "$S/p-tidy-clean.png"
```

Then repeat Phase 2 with a `p-` prefix, `$RP`, `-Size 1088x1920` and the **same** `palette.json`. Don't run `-ExtractPalette` again.

The portrait `lawn` values become the engine's portrait `CONFIG.lawn`, `hole` and `path`.

## Phase 4: Mower-man sprites (the current animation)

```powershell
.\tools\generate-image.ps1 -Style pixel -Transparent -Image "$S/gardener-model.png","$S/mower-back.png","$S/reference/sprites-v1.png" -Prompt (Get-Content "$P/walk-back.txt" -Raw) -Size 1536x1024 -Count 4 -Out "$S/walk-back.png"
.\tools\generate-image.ps1 -Style pixel -Transparent -Image "$S/gardener-model.png","$S/mower-front.png","$S/reference/sprites-v1.png" -Prompt (Get-Content "$P/walk-front.txt" -Raw) -Size 1536x1024 -Count 4 -Out "$S/walk-front.png"

# Pack into engine sheets. The mower sits ahead of his feet: tune -CompanionOffset ("dx,dy" in sprite px) by eye.
.\tools\hero-assets.ps1 -Action pack -In "$S/walk-back.png" -Frames 8 -Height 128 -Companion "$S/mower-back.png" -CompanionHeight 56 -CompanionOffset "0,-10" -Preview -Out "$H/mower-man-back.png" -CompanionOut "$H/mower-back.png"
.\tools\hero-assets.ps1 -Action pack -In "$S/walk-front.png" -Frames 8 -Height 128 -Companion "$S/mower-front.png" -CompanionHeight 60 -CompanionOffset "0,12" -CompanionInFront -Preview -Out "$H/mower-man-front.png" -CompanionOut "$H/mower-front.png"
```

Check the `-preview.png` contact sheets before moving on:
- frames 1 and 5 (engine frames 0 and 4) are standing poses
- the legs clearly change between frames
- the feet sit on the red ground line
- the mower stays still

The `.json` beside each sheet holds the `w`, `h` and `pad` values for the engine's `SHEETS`.

If a sheet holds both views, use `-Skip 8` to take the second set of 8.

## Phase 5: Other gardeners (can wait)

```powershell
foreach ($a in 'pool-plant', 'hedge-trim', 'tree-saw') {
  .\tools\generate-image.ps1 -Style pixel -Transparent -Image "$S/gardener-model.png" -Prompt (Get-Content "$P/$a.txt" -Raw) -Size 1536x1024 -Count 3 -Out "$S/$a.png"
}
# after picking: pack each as 6 frames, sized to match its static station layer
.\tools\hero-assets.ps1 -Action pack -In "$S/pool-plant.png" -Frames 6 -Height 96 -Preview -Out "$H/pool-plant.png"
```

## Phase 6 (optional): Ambient

These are not scripted yet:
- a sky plate outpainted to 2× width, for drifting clouds
- two transparent mist strips
- a 4-frame pool shimmer, made as a masked edit of the pool
- butterfly, bird and petal sheets

## Finished kit (`images/hero/`)

| File | Use |
|---|---|
| `d-tidy-clean.png`, `d-untidy-clean.png` | Desktop backgrounds, 1920×1088, aligned |
| `p-tidy-clean.png`, `p-untidy-clean.png` | Portrait backgrounds, 1088×1920, aligned |
| `palette.json` | Shared scene palette |
| `layer-d-*-gardener.png` + `.json` | Static station gardeners and where they sit |
| `layer-d-branch.png` + `.json` | The overhanging branch, for the cut animation |
| `mower-man-back/front.png`, `mower-back/front.png` + `.json` | Engine sprite sheets (8 frames; frames 0 and 4 standing) |
| `regions-desktop.json`, `regions-portrait.json` | Region and lawn geometry; `lawn` maps to the engine's `CONFIG.lawn` |
