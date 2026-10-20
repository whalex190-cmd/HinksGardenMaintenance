<#
.SYNOPSIS
  Offline image jobs for the hero animation assets (no API calls, no cost).

.DESCRIPTION
  -Action mask       Render named regions into an edit mask (transparent = edit area). -Preview outlines them instead.
  -Action stripe     Paint the engine's mowing stripes into the lawn polygons.
  -Action composite  Paste an AI edit back onto the original, only inside the mask, with a soft edge.
  -Action pixelate   Snap a scene to the native pixel grid and shared palette (x4 output). -ExtractPalette builds the palette.
  -Action diff       Extract what an edit added (gardeners, branch...) as a transparent, grid-aligned layer + JSON.
  -Action slice      Cut every figure out of a sheet into separate trimmed PNGs.
  -Action pack       Turn an AI sprite grid into an engine-ready sprite sheet (+ optional companion sheet, e.g. the mower).
  -Action check      Report how many pixels differ between two scenes outside the mask (alignment test).

  Regions JSON (fractions of the image, 0..1):
    { "lawn": { "vpX":0.508, "vpY":0.429, "nearY":0.705, "farY":0.497, "halfNear":0.2426, "stripes":11 },
      "regions": { "pool": { "rect": [x, y, w, h] }, "hedges-l": { "poly": [[x,y], [x,y], ...] } } }
  The region name "lawn" is built from the lawn geometry, exactly as the engine computes it.

.EXAMPLE
  .\tools\hero-assets.ps1 -Action mask -In images/hero/src/d-tidy-clean.png -Regions images/hero/regions-desktop.json -Names lawn,pool -Out images/hero/src/mask-untidy.png
#>
param(
  [Parameter(Mandatory)] [ValidateSet('mask', 'stripe', 'composite', 'pixelate', 'diff', 'slice', 'pack', 'check', 'crop', 'place')] [string]$Action,
  [string]$Rect,                 # crop: "x,y,w,h" in px
  [string]$At,                   # place: "x,y" in px
  [string]$In,
  [string]$Out,
  [string]$Base,                 # composite/diff/check: the original or clean plate
  [string]$Mask,                 # composite/check: mask PNG (transparent = edit area)
  [string]$Regions,              # regions JSON
  [string[]]$Names,              # region names
  [int]$Grow = 0,                # mask: grow regions by N px
  [switch]$Preview,              # mask/pack: write a preview image instead of / as well as the output
  [double]$Strength = 0.07,      # stripe: brightness change per stripe
  [int]$Feather = 12,            # composite: soft edge in px
  [string]$Palette,              # pixelate/pack: palette JSON path
  [switch]$ExtractPalette,       # pixelate: build the palette from -In and save it to -Palette
  [int]$Colors = 48,             # pixelate: palette size
  [int]$Scale = 4,               # pixelate/diff: native grid scale
  [string]$Native,               # pixelate: native size (default 480x272 landscape, 272x480 portrait)
  [int]$Tol = 24,                # diff/check: colour tolerance
  [double]$Max = 0.5,            # check: max % of differing pixels
  [string]$Key,                  # slice/pack: background colour to key out, e.g. 000000
  [int]$KeyTol = 40,
  [int]$Gap = 6,                 # slice/pack: merge pieces closer than this (px)
  [int]$Frames = 8,              # pack: number of frames to take
  [int]$Skip = 0,                # pack: skip this many figures (reading order) first
  [int]$Rotate = 0,              # pack: start the cycle at this frame (so frames 0 and 4 are the legs-together poses)
  [int]$Height = 128,            # pack: figure height in sprite px (engine REF_HEIGHT)
  [int]$Pad = 2,                 # pack: px below the feet (engine SHEETS.pad)
  [string]$Companion,            # pack: single-frame companion image (e.g. the mower)
  [string]$CompanionOut,
  [int]$CompanionHeight = 60,
  [int]$CompanionWidth = 0,      # pack: optional width (0 = keep aspect ratio)
  [string]$CompanionOffset = '0,0', # pack: companion bottom-centre relative to the feet anchor (sprite px, +y = down)
  [switch]$CompanionInFront       # pack preview: draw the companion over the figure
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
# "-Names a,b" arrives as one string when run via powershell -File: accept both forms.
if ($Names) { $Names = @($Names | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
Add-Type -AssemblyName System.Drawing
if (-not ('HeroImg' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'ImageTools.cs') -ReferencedAssemblies System.Drawing }

# ---------- helpers ----------

function P([string]$p) { if (-not $p) { return $p }; if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $ProjectRoot $p } }
function Need([string]$name, $val) { if (-not $val) { throw "-$name is required for -Action $Action." } }

function Load([string]$path) {
  $full = P $path
  if (-not (Test-Path $full)) { throw "Not found: $full" }
  $bmp = [Drawing.Bitmap]::FromFile($full)
  try { $px = [HeroImg]::Read($bmp); return @{ px = $px; w = $bmp.Width; h = $bmp.Height } } finally { $bmp.Dispose() }
}

function Save($img, [string]$path) {
  $full = P $path
  $dir = Split-Path -Parent $full
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $bmp = [HeroImg]::Write($img.px, $img.w, $img.h)
  try { $bmp.Save($full, [Drawing.Imaging.ImageFormat]::Png) } finally { $bmp.Dispose() }
  Write-Host ("Saved {0} ({1}x{2})" -f $full, $img.w, $img.h)
}

function Resize-HQ($img, [int]$nw, [int]$nh) {
  $src = [HeroImg]::Write($img.px, $img.w, $img.h)
  $dst = New-Object Drawing.Bitmap $nw, $nh, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($src, 0, 0, $nw, $nh)
  $g.Dispose(); $src.Dispose()
  try { return @{ px = [HeroImg]::Read($dst); w = $nw; h = $nh } } finally { $dst.Dispose() }
}

function Read-Regions([string]$path) {
  Need 'Regions' $path
  return (Get-Content (P $path) -Raw | ConvertFrom-Json)
}

function Lawn-EdgeX($L, [double]$k, [double]$y) {
  $halfW = $L.halfNear * ($y - $L.vpY) / ($L.nearY - $L.vpY)
  return $L.vpX - $halfW + 2 * $halfW * $k / $L.stripes
}

# Region -> array of polygons, each an array of PointF in image px.
function Region-Polys($R, [string]$name, [int]$w, [int]$h) {
  if ($name -eq 'lawn') {
    $L = $R.lawn
    $pts = @(
      @((Lawn-EdgeX $L 0 $L.nearY), $L.nearY), @((Lawn-EdgeX $L $L.stripes $L.nearY), $L.nearY),
      @((Lawn-EdgeX $L $L.stripes $L.farY), $L.farY), @((Lawn-EdgeX $L 0 $L.farY), $L.farY))
    return , (, ($pts | ForEach-Object { New-Object Drawing.PointF ([float]($_[0] * $w)), ([float]($_[1] * $h)) }))
  }
  $def = $R.regions.$name
  if (-not $def) { throw "Region '$name' is not in the regions file." }
  if ($def.rect) {
    $x, $y, $rw, $rh = $def.rect
    $pts = @(@($x, $y), @(($x + $rw), $y), @(($x + $rw), ($y + $rh)), @($x, ($y + $rh)))
  } else { $pts = $def.poly }
  return , (, ($pts | ForEach-Object { New-Object Drawing.PointF ([float]($_[0] * $w)), ([float]($_[1] * $h)) }))
}

function Load-Palette([string]$path) {
  $j = Get-Content (P $path) -Raw | ConvertFrom-Json
  return [int[]]($j.colors | ForEach-Object { [Convert]::ToInt32('FF' + $_.TrimStart('#'), 16) })
}

function Prep-Sprite([string]$path) {
  $img = Load $path
  if ($Key) { [HeroImg]::KeyOut($img.px, [Convert]::ToInt32('FF' + $Key.TrimStart('#'), 16), $KeyTol) }
  return $img
}

# Merge component boxes that overlap or sit within $Gap px of each other (pieces of one figure).
function Merge-Boxes($comps) {
  $boxes = New-Object System.Collections.ArrayList
  foreach ($c in $comps) { [void]$boxes.Add(@($c[0], $c[1], $c[2], $c[3], $c[4])) }
  $changed = $true
  while ($changed) {
    $changed = $false
    for ($i = 0; $i -lt $boxes.Count -and -not $changed; $i++) {
      for ($j = $i + 1; $j -lt $boxes.Count; $j++) {
        $a = $boxes[$i]; $b = $boxes[$j]
        if ($a[0] - $Gap -le $b[2] -and $b[0] - $Gap -le $a[2] -and $a[1] - $Gap -le $b[3] -and $b[1] - $Gap -le $a[3]) {
          $boxes[$i] = @([Math]::Min($a[0], $b[0]), [Math]::Min($a[1], $b[1]), [Math]::Max($a[2], $b[2]), [Math]::Max($a[3], $b[3]), ($a[4] + $b[4]))
          $boxes.RemoveAt($j); $changed = $true; break
        }
      }
    }
  }
  return , $boxes
}

# Figures in reading order (rows, then left to right).
function Find-Figures($img) {
  $comps = [HeroImg]::Components($img.px, $img.w, $img.h, 20)
  $boxes = Merge-Boxes $comps
  if ($boxes.Count -eq 0) { throw "No figures found. Is the background transparent (or set -Key)?" }
  $maxArea = ($boxes | ForEach-Object { $_[4] } | Measure-Object -Maximum).Maximum
  $figs = @($boxes | Where-Object { $_[4] -ge $maxArea * 0.15 })
  $medH = ($figs | ForEach-Object { $_[3] - $_[1] } | Sort-Object)[[int]($figs.Count / 2)]
  return @($figs | Sort-Object @{ e = { [Math]::Floor((($_[1] + $_[3]) / 2) / ($medH * 0.6)) } }, @{ e = { $_[0] } })
}

function Trim-Box($img, $b) {
  $cw = $b[2] - $b[0] + 1; $ch = $b[3] - $b[1] + 1
  return @{ px = [HeroImg]::Crop($img.px, $img.w, $img.h, $b[0], $b[1], $cw, $ch); w = $cw; h = $ch }
}

function Scale-Sprite($img, [double]$s) {
  $nw = [Math]::Max(1, [int][Math]::Round($img.w * $s)); $nh = [Math]::Max(1, [int][Math]::Round($img.h * $s))
  $px = [HeroImg]::AreaResize($img.px, $img.w, $img.h, $nw, $nh)
  [HeroImg]::BinarizeAlpha($px, 128)
  [void][HeroImg]::Defringe($px, $nw, $nh, 2, 70)
  $out = @{ px = $px; w = $nw; h = $nh }
  $b = [HeroImg]::Bounds($px, $nw, $nh)
  if ($b) { $out = Trim-Box $out $b }
  return $out
}

# ---------- actions ----------

switch ($Action) {

  'mask' {
    Need 'In' $In; Need 'Names' $Names; Need 'Out' $Out
    $R = Read-Regions $Regions
    $bg = [Drawing.Bitmap]::FromFile((P $In)); $w = $bg.Width; $h = $bg.Height
    if ($Preview) {
      $bmp = New-Object Drawing.Bitmap $w, $h, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [Drawing.Graphics]::FromImage($bmp); $g.DrawImage($bg, 0, 0, $w, $h)
      $outline = @('Yellow', 'Cyan', 'Magenta', 'Orange', 'Lime', 'Red', 'White', 'DeepSkyBlue', 'HotPink', 'Gold', 'SpringGreen', 'Coral')
      $font = New-Object Drawing.Font 'Segoe UI', 14, ([Drawing.FontStyle]::Bold)
      $i = 0
      foreach ($n in $Names) {
        $col = [Drawing.Color]::FromName($outline[$i % $outline.Count]); $i++
        $pen = New-Object Drawing.Pen $col, 3
        foreach ($poly in (Region-Polys $R $n $w $h)) {
          $g.DrawPolygon($pen, [Drawing.PointF[]]$poly)
          $g.DrawString($n, $font, (New-Object Drawing.SolidBrush $col), $poly[0].X + 4, $poly[0].Y + 4)
        }
        # lawn: also draw the stripe edges, to check them against the painted lawn
        if ($n -eq 'lawn') {
          $L = $R.lawn; $thin = New-Object Drawing.Pen $col, 1
          for ($k = 1; $k -lt $L.stripes; $k++) {
            $g.DrawLine($thin, [float]((Lawn-EdgeX $L $k $L.nearY) * $w), [float]($L.nearY * $h), [float]((Lawn-EdgeX $L $k $L.farY) * $w), [float]($L.farY * $h))
          }
        }
      }
      $g.Dispose(); $bg.Dispose()
      $full = P $Out; $bmp.Save($full, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
      Write-Host "Saved preview $full"
      break
    }
    $bg.Dispose()
    $bmp = New-Object Drawing.Bitmap $w, $h, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.Clear([Drawing.Color]::Black)
    $g.CompositingMode = 'SourceCopy'; $g.SmoothingMode = 'None'
    $clear = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(0, 0, 0, 0))
    $pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(0, 0, 0, 0)), ([float](2 * $Grow))
    $pen.LineJoin = 'Round'
    foreach ($n in $Names) {
      foreach ($poly in (Region-Polys $R $n $w $h)) {
        $g.FillPolygon($clear, [Drawing.PointF[]]$poly)
        if ($Grow -gt 0) { $g.DrawPolygon($pen, [Drawing.PointF[]]$poly) }
      }
    }
    $g.Dispose()
    $full = P $Out
    $dir = Split-Path -Parent $full; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
    $bmp.Save($full, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    Write-Host ("Saved mask {0} ({1}x{2}, {3:N0} KB). Transparent = edit area." -f $full, $w, $h, ((Get-Item $full).Length / 1KB))
  }

  'stripe' {
    Need 'In' $In; Need 'Out' $Out
    $R = Read-Regions $Regions; $L = $R.lawn
    $bmp = New-Object Drawing.Bitmap (P $In)
    $canvas = New-Object Drawing.Bitmap $bmp.Width, $bmp.Height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($canvas); $g.DrawImage($bmp, 0, 0, $bmp.Width, $bmp.Height); $bmp.Dispose()
    $w = $canvas.Width; $h = $canvas.Height
    $g.SmoothingMode = 'None'
    $a = [int](255 * $Strength)
    $light = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb($a, 255, 255, 220))
    $dark = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb($a, 10, 45, 10))
    for ($i = 0; $i -lt $L.stripes; $i++) {
      $pts = [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([float]((Lawn-EdgeX $L $i $L.nearY) * $w)), ([float]($L.nearY * $h))),
        (New-Object Drawing.PointF ([float]((Lawn-EdgeX $L ($i + 1) $L.nearY) * $w)), ([float]($L.nearY * $h))),
        (New-Object Drawing.PointF ([float]((Lawn-EdgeX $L ($i + 1) $L.farY) * $w)), ([float]($L.farY * $h))),
        (New-Object Drawing.PointF ([float]((Lawn-EdgeX $L $i $L.farY) * $w)), ([float]($L.farY * $h))))
      $g.FillPolygon($(if ($i % 2 -eq 0) { $light } else { $dark }), $pts)
    }
    $g.Dispose()
    $full = P $Out; $canvas.Save($full, [Drawing.Imaging.ImageFormat]::Png); $canvas.Dispose()
    Write-Host "Saved $full ($($L.stripes) stripes)"
  }

  'composite' {
    Need 'Base' $Base; Need 'In' $In; Need 'Mask' $Mask; Need 'Out' $Out
    $b = Load $Base; $e = Load $In; $m = Load $Mask
    if ($e.w -ne $b.w -or $e.h -ne $b.h) { Write-Host "Resizing edit $($e.w)x$($e.h) to $($b.w)x$($b.h)"; $e = Resize-HQ $e $b.w $b.h }
    if ($m.w -ne $b.w -or $m.h -ne $b.h) { throw "Mask must be the same size as -Base ($($b.w)x$($b.h))." }
    $px = [HeroImg]::Composite($b.px, $e.px, $m.px, $b.w, $b.h, $Feather)
    Save @{ px = $px; w = $b.w; h = $b.h } $Out
  }

  'pixelate' {
    Need 'In' $In; Need 'Out' $Out
    $img = Load $In
    if ($Native) { $nw, $nh = $Native.Split('x') | ForEach-Object { [int]$_ } }
    elseif ($img.w -ge $img.h) { $nw = 480; $nh = 272 } else { $nw = 272; $nh = 480 }   # x4 = 1920x1088, the native gpt-image size
    $tw = $nw * $Scale; $th = $nh * $Scale
    # cover-fit to the target, then centre-crop
    $s = [Math]::Max($tw / $img.w, $th / $img.h)
    if ([Math]::Abs($s - 1) -gt 0.0001) { $img = Resize-HQ $img ([int][Math]::Ceiling($img.w * $s)) ([int][Math]::Ceiling($img.h * $s)) }
    $px = [HeroImg]::Crop($img.px, $img.w, $img.h, [int](($img.w - $tw) / 2), [int](($img.h - $th) / 2), $tw, $th)
    $small = [HeroImg]::BoxDown($px, $tw, $th, $Scale)
    [HeroImg]::BinarizeAlpha($small, 128)
    if ($ExtractPalette) {
      Need 'Palette' $Palette
      $pal = [HeroImg]::KMeansPalette($small, $Colors, 12)
      $hex = @($pal | ForEach-Object { '#' + ($_ -band 0xFFFFFF).ToString('x6') })
      @{ colors = $hex; source = $In; count = $hex.Count } | ConvertTo-Json | Set-Content -Encoding UTF8 (P $Palette)
      Write-Host "Saved palette $(P $Palette) ($($hex.Count) colours)"
    }
    if ($Palette) { [HeroImg]::MapToPalette($small, (Load-Palette $Palette)) }
    Save @{ px = [HeroImg]::UpNearest($small, $nw, $nh, $Scale); w = $tw; h = $th } $Out
  }

  'diff' {
    Need 'In' $In; Need 'Base' $Base; Need 'Out' $Out
    $a = Load $In; $b = Load $Base
    if ($a.w -ne $b.w -or $a.h -ne $b.h) { throw "Both images must be the same size." }
    $layer = [HeroImg]::Diff($a.px, $b.px, $a.w, $a.h, $Tol)
    if ($Names) {                               # keep only what lies inside the named regions
      $R = Read-Regions $Regions
      $mb = New-Object Drawing.Bitmap $a.w, $a.h, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [Drawing.Graphics]::FromImage($mb); $g.Clear([Drawing.Color]::FromArgb(0, 0, 0, 0))
      foreach ($n in $Names) { foreach ($poly in (Region-Polys $R $n $a.w $a.h)) { $g.FillPolygon([Drawing.Brushes]::Black, [Drawing.PointF[]]$poly) } }
      $g.Dispose(); $keep = [HeroImg]::Read($mb); $mb.Dispose()
      for ($i = 0; $i -lt $layer.Length; $i++) { if ((($keep[$i] -shr 24) -band 255) -lt 128) { $layer[$i] = 0 } }
    }
    $bb = [HeroImg]::Bounds($layer, $a.w, $a.h)
    if (-not $bb) { throw "No differences found (try a lower -Tol)." }
    # snap the crop to the pixel grid so the layer lines up with the scene
    $x0 = [Math]::Floor($bb[0] / $Scale) * $Scale; $y0 = [Math]::Floor($bb[1] / $Scale) * $Scale
    $x1 = [Math]::Ceiling(($bb[2] + 1) / $Scale) * $Scale; $y1 = [Math]::Ceiling(($bb[3] + 1) / $Scale) * $Scale
    $cw = $x1 - $x0; $ch = $y1 - $y0
    Save @{ px = [HeroImg]::Crop($layer, $a.w, $a.h, $x0, $y0, $cw, $ch); w = $cw; h = $ch } $Out
    $meta = [ordered]@{ x = $x0; y = $y0; w = $cw; h = $ch; sceneW = $a.w; sceneH = $a.h
      fx = [Math]::Round($x0 / $a.w, 5); fy = [Math]::Round($y0 / $a.h, 5); fw = [Math]::Round($cw / $a.w, 5); fh = [Math]::Round($ch / $a.h, 5) }
    $json = [IO.Path]::ChangeExtension((P $Out), '.json')
    $meta | ConvertTo-Json | Set-Content -Encoding UTF8 $json
    Write-Host "Saved $json"
  }

  'slice' {
    Need 'In' $In; Need 'Out' $Out
    $img = Prep-Sprite $In
    $figs = Find-Figures $img
    $prefix = (P $Out) -replace '\.png$', ''
    $i = 0
    foreach ($b in $figs) {
      $i++
      Save (Trim-Box $img $b) "$prefix-$i.png"
    }
    Write-Host "$i figure(s) found."
  }

  'pack' {
    Need 'In' $In; Need 'Out' $Out
    $img = Prep-Sprite $In
    $figs = Find-Figures $img
    if ($figs.Count -lt $Skip + $Frames) { throw "Found $($figs.Count) figures, need $($Skip + $Frames). Check the sheet or -Gap/-Key." }
    $figs = $figs[$Skip..($Skip + $Frames - 1)]
    if ($Rotate) { $figs = @(0..($Frames - 1) | ForEach-Object { , $figs[($_ + $Rotate) % $Frames] }) }   # leading comma: keep each box as one item
    $medH = ($figs | ForEach-Object { $_[3] - $_[1] + 1 } | Sort-Object)[[int]($Frames / 2)]
    $s = $Height / $medH
    $cells = @()
    foreach ($b in $figs) {
      $f = Scale-Sprite (Trim-Box $img $b) $s
      if ($Palette) { [HeroImg]::MapToPalette($f.px, (Load-Palette $Palette)) }
      $bb = [HeroImg]::Bounds($f.px, $f.w, $f.h)
      $anchorX = [HeroImg]::MeanX($f.px, $f.w, 0, [int]($f.h * 0.45))     # torso / hat: steady while legs move
      $cells += @{ img = $f; ax = $anchorX; base = $bb[3] }
    }
    $comp = $null
    if ($Companion) {
      $c = Prep-Sprite $Companion
      $cb = [HeroImg]::Bounds($c.px, $c.w, $c.h); $c = Trim-Box $c $cb
      if ($CompanionWidth -gt 0) {
        $cpx = [HeroImg]::AreaResize($c.px, $c.w, $c.h, $CompanionWidth, $CompanionHeight)
        [HeroImg]::BinarizeAlpha($cpx, 128); [void][HeroImg]::Defringe($cpx, $CompanionWidth, $CompanionHeight, 2, 70)
        $comp = @{ px = $cpx; w = $CompanionWidth; h = $CompanionHeight }
      } else { $comp = Scale-Sprite $c ($CompanionHeight / $c.h) }
      $cdx, $cdy = $CompanionOffset.Split(',') | ForEach-Object { [int]$_ }
    }
    # cell extents around the anchor (feet centre)
    $left = 0; $right = 0; $up = 0; $down = 0
    foreach ($c in $cells) {
      $left = [Math]::Max($left, $c.ax); $right = [Math]::Max($right, $c.img.w - $c.ax)
      $up = [Math]::Max($up, $c.base + 1); $down = [Math]::Max($down, $c.img.h - $c.base - 1)
    }
    if ($comp) {
      $left = [Math]::Max($left, $comp.w / 2 - $cdx); $right = [Math]::Max($right, $comp.w / 2 + $cdx)
      $up = [Math]::Max($up, $comp.h - $cdy); $down = [Math]::Max($down, $cdy)
    }
    $half = [int][Math]::Ceiling([Math]::Max($left, $right)) + 1
    $cw = 2 * $half
    $padB = [Math]::Max($Pad, [int][Math]::Ceiling($down))
    $ch = [int][Math]::Ceiling($up) + $padB
    $baseY = $ch - $padB                        # ground line: first row below the feet
    $sheet = New-Object int[] ($cw * $Frames * $ch)
    $csheet = if ($comp) { New-Object int[] ($cw * $Frames * $ch) } else { $null }
    for ($i = 0; $i -lt $Frames; $i++) {
      $c = $cells[$i]
      $x = $i * $cw + $half - [int][Math]::Round($c.ax); $y = $baseY - ($c.base + 1)
      [HeroImg]::Blit($sheet, $cw * $Frames, $ch, $c.img.px, $c.img.w, $c.img.h, $x, $y)
      if ($comp) { [HeroImg]::Blit($csheet, $cw * $Frames, $ch, $comp.px, $comp.w, $comp.h, $i * $cw + $half + $cdx - [int]($comp.w / 2), $baseY + $cdy - $comp.h) }
    }
    Save @{ px = $sheet; w = $cw * $Frames; h = $ch } $Out
    $meta = [ordered]@{ w = $cw; h = $ch; pad = $padB; frames = $Frames; refHeight = $Height; anchorX = $half; groundY = $baseY }
    $meta | ConvertTo-Json | Set-Content -Encoding UTF8 ([IO.Path]::ChangeExtension((P $Out), '.json'))
    if ($comp) {
      Need 'CompanionOut' $CompanionOut
      Save @{ px = $csheet; w = $cw * $Frames; h = $ch } $CompanionOut
      $meta | ConvertTo-Json | Set-Content -Encoding UTF8 ([IO.Path]::ChangeExtension((P $CompanionOut), '.json'))
    }
    Write-Host ("Sheet: {0} frames of {1}x{2} (engine SHEETS: w {1}, h {2}, pad {3})" -f $Frames, $cw, $ch, $padB)
    Write-Host ("Partial-alpha pixels: {0} (should be 0)" -f [HeroImg]::PartialAlpha($sheet))
    if ($Preview) {
      # contact sheet at x3 on grey, companion composited, with a ground line
      $pv = New-Object int[] ($cw * $Frames * $ch)
      for ($i = 0; $i -lt $pv.Length; $i++) { $pv[$i] = [HeroImg]::Argb(255, 96, 104, 96) }
      for ($x = 0; $x -lt $cw * $Frames; $x++) { $pv[$baseY * $cw * $Frames + $x] = [HeroImg]::Argb(255, 200, 60, 60) }
      if ($comp -and -not $CompanionInFront) { [HeroImg]::Blit($pv, $cw * $Frames, $ch, $csheet, $cw * $Frames, $ch, 0, 0) }
      [HeroImg]::Blit($pv, $cw * $Frames, $ch, $sheet, $cw * $Frames, $ch, 0, 0)
      if ($comp -and $CompanionInFront) { [HeroImg]::Blit($pv, $cw * $Frames, $ch, $csheet, $cw * $Frames, $ch, 0, 0) }
      $up3 = [HeroImg]::UpNearest($pv, $cw * $Frames, $ch, 3)
      Save @{ px = $up3; w = $cw * $Frames * 3; h = $ch * 3 } ((P $Out) -replace '\.png$', '-preview.png')
    }
  }

  # Cut a window out of an image at 1:1 (e.g. 1536x1024 for models that only take standard sizes).
  'crop' {
    Need 'In' $In; Need 'Rect' $Rect; Need 'Out' $Out
    $img = Load $In
    $x, $y, $cw, $ch = $Rect.Split(',') | ForEach-Object { [int]$_ }
    Save @{ px = [HeroImg]::Crop($img.px, $img.w, $img.h, $x, $y, $cw, $ch); w = $cw; h = $ch } $Out
  }

  # Put an edited window back into a full-size copy of -Base at "x,y" (then run composite with the full mask).
  'place' {
    Need 'Base' $Base; Need 'In' $In; Need 'At' $At; Need 'Out' $Out
    $b = Load $Base; $c = Load $In
    $x, $y = $At.Split(',') | ForEach-Object { [int]$_ }
    $px = [int[]]$b.px.Clone()
    for ($i = 0; $i -lt $c.px.Length; $i++) { $c.px[$i] = $c.px[$i] -bor [int]0xFF000000 }  # opaque window
    [HeroImg]::Blit($px, $b.w, $b.h, $c.px, $c.w, $c.h, $x, $y)
    Save @{ px = $px; w = $b.w; h = $b.h } $Out
  }

  'check' {
    Need 'In' $In; Need 'Base' $Base
    $a = Load $In; $b = Load $Base
    if ($a.w -ne $b.w -or $a.h -ne $b.h) { throw "Both images must be the same size ($($a.w)x$($a.h) vs $($b.w)x$($b.h))." }
    $m = if ($Mask) { (Load $Mask).px } else { $null }
    $pct = 100 * [HeroImg]::CompareOutside($a.px, $b.px, $m, $Tol)
    $ok = $pct -le $Max
    Write-Host ("{0:N3}% of pixels outside the mask differ (limit {1}%): {2}" -f $pct, $Max, $(if ($ok) { 'PASS' } else { 'FAIL' }))
    if (-not $ok) { exit 1 }
  }
}
