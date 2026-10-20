<#
.SYNOPSIS
  Generate or edit an image with the OpenAI Images API and save it into the project.

.DESCRIPTION
  Without -Image: text-to-image (POST /v1/images/generations).
  With -Image:    edit / image-to-image (POST /v1/images/edits). The first image is the one
                  edited; any others are references (up to 16). -Mask marks the area to change
                  (its transparent pixels), and must be a PNG the same size as the first image.

.EXAMPLE
  .\tools\generate-image.ps1 -Prompt "Freshly striped lawn with curved border of lavender" -Out images/lawn.jpg

.EXAMPLE
  # Hero pixel art: edit the tidy plate only inside the mask
  .\tools\generate-image.ps1 -Style pixel -Image images/hero/src/d-tidy-clean-striped.png `
    -Mask images/hero/src/mask-untidy.png -Prompt "..." -Size 1920x1088 -Out images/hero/src/d-untidy-raw.png

.EXAMPLE
  # Transparent sprite using reference images
  .\tools\generate-image.ps1 -Style pixel -Transparent -Image images/hero/src/gardener-model.png `
    -Prompt "..." -Size 1536x1024 -Count 4 -Out images/hero/src/walk-back.png
#>
param(
  [Parameter(Mandatory)] [string]$Prompt,
  [Parameter(Mandatory)] [string]$Out,                 # e.g. images/hero.jpg (extension sets the format)
  [string]$Size = '1536x1024',                         # gpt-image-2: any WxH divisible by 16, ratio 1:3 to 3:1
  [ValidateSet('low', 'medium', 'high', 'auto')] [string]$Quality = 'high',
  [string]$Model = 'gpt-image-2',
  [int]$Count = 1,                                     # 1-10 variations; extra ones get -2, -3... suffixes
  [string[]]$Image,                                    # edit mode: image(s) to edit / use as reference
  [string]$Mask,                                       # edit mode: PNG, transparent = area to change
  [switch]$Transparent,                                # transparent background (forces PNG)
  [ValidateSet('', 'high', 'low')] [string]$InputFidelity = '',  # edits: 'high' keeps the input's layout (gpt-image-1 / 1.5 only)
  [ValidateSet('photo', 'pixel', 'none')] [string]$Style = 'photo',
  [switch]$NoHouseStyle                                # same as -Style none (kept for older commands)
)

. "$PSScriptRoot\openai-common.ps1"

$ext = [IO.Path]::GetExtension($Out).TrimStart('.').ToLower()
$format = @{ jpg = 'jpeg'; jpeg = 'jpeg'; png = 'png'; webp = 'webp' }[$ext]
if (-not $format) { throw "Use a .jpg, .png or .webp file name for -Out." }
if ($Transparent -and $format -eq 'jpeg') { throw "Transparent images need a .png or .webp file name." }
if ($NoHouseStyle) { $Style = 'none' }
# "-Image a,b" arrives as one string when run via powershell -File: accept both forms.
if ($Image) { $Image = @($Image | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }

$suffix = Get-StyleSuffix $Style
$fullPrompt = if ($suffix) { "$Prompt. $suffix" } else { $Prompt }

$fields = [ordered]@{ model = $Model; prompt = $fullPrompt; size = $Size; quality = $Quality; n = "$Count"; output_format = $format }
if ($format -ne 'png') { $fields.output_compression = '85' }
if ($Transparent) { $fields.background = 'transparent' }
if ($InputFidelity) {
  if (-not $Image) { throw "-InputFidelity needs -Image." }
  $fields.input_fidelity = $InputFidelity
}

if ($Image) {
  if ($Image.Count -gt 16) { throw "The edits endpoint takes at most 16 images." }
  $files = @($Image | ForEach-Object {
    $p = if ([IO.Path]::IsPathRooted($_)) { $_ } else { Join-Path $ProjectRoot $_ }
    if (-not (Test-Path $p)) { throw "Image not found: $p" }
    @{ Name = 'image[]'; Path = $p }
  })
  if ($Mask) {
    $m = if ([IO.Path]::IsPathRooted($Mask)) { $Mask } else { Join-Path $ProjectRoot $Mask }
    if (-not (Test-Path $m)) { throw "Mask not found: $m" }
    $files += @{ Name = 'mask'; Path = $m }
  }
  Write-Host "Editing with $Model at $Size ($Quality), $($Image.Count) image(s)$(if ($Mask) { ' + mask' })... this can take a minute or two."
  $h = @{}; foreach ($k in $fields.Keys) { $h[$k] = $fields[$k] }
  $res = Invoke-OpenAIMultipart -Endpoint 'images/edits' -Fields $h -Files $files
} else {
  if ($Mask) { throw "-Mask needs -Image." }
  $headers = Get-AuthHeaders
  $body = @{}; foreach ($k in $fields.Keys) { $body[$k] = $fields[$k] }
  $body.n = $Count
  if ($body.output_compression) { $body.output_compression = 85 }
  Write-Host "Generating $Count image(s) with $Model at $Size ($Quality)... this can take up to a minute."
  try {
    $res = Invoke-RestMethod -Method Post -Uri "$ApiBase/images/generations" -Headers $headers `
      -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json))) -TimeoutSec 300
  } catch { throw "OpenAI error: $(Read-ApiError $_)" }
}

$base = Resolve-OutPath $Out
$i = 0
foreach ($img in $res.data) {
  $i++
  $path = if ($i -eq 1) { $base } else { $base -replace "\.$ext$", "-$i.$ext" }
  [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($img.b64_json))
  Write-Host ("Saved {0} ({1:N0} KB)" -f $path, ((Get-Item $path).Length / 1KB))
}
