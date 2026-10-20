<#
.SYNOPSIS
  Generate a short video clip with OpenAI Sora (Videos API) and save it into the project.
  Good for subtle looping hero backgrounds: slow camera drift, leaves moving, light changing.

.EXAMPLE
  .\tools\generate-video.ps1 -Prompt "Slow aerial drift over a striped lawn and flower borders, gentle breeze" -Out images/hero-loop.mp4

.EXAMPLE
  # Animate an existing photo. The image is resized to match -Size automatically.
  .\tools\generate-video.ps1 -Prompt "Gentle breeze moves the trees, slow push-in" -Reference images/hero-hills.jpg -Out images/hero-loop.mp4
#>
param(
  [Parameter(Mandatory)] [string]$Prompt,
  [Parameter(Mandatory)] [string]$Out,                                  # e.g. images/hero-loop.mp4
  [ValidateSet('4', '8', '12')] [string]$Seconds = '8',
  [ValidateSet('1280x720', '720x1280', '1792x1024', '1024x1792')] [string]$Size = '1280x720',
  [ValidateSet('sora-2', 'sora-2-pro')] [string]$Model = 'sora-2',
  [string]$Reference,                                                   # optional starting image (jpg/png/webp)
  [switch]$NoHouseStyle
)

. "$PSScriptRoot\openai-common.ps1"

$headers = Get-AuthHeaders
$fullPrompt = if ($NoHouseStyle) { $Prompt } else { "$Prompt. $HouseStyle Smooth, slow, steady camera; calm and premium." }

# ---- 1. Create the job ----
Write-Host "Starting $Model video ($Seconds s, $Size)..."
if ($Reference) {
  # The reference image must exactly match the video size, so resize/crop a temp copy first.
  Add-Type -AssemblyName System.Drawing
  $refPath = if ([IO.Path]::IsPathRooted($Reference)) { $Reference } else { Join-Path $ProjectRoot $Reference }
  $w, $h = $Size.Split('x') | ForEach-Object { [int]$_ }
  $src = [Drawing.Image]::FromFile($refPath)
  $scale = [Math]::Max($w / $src.Width, $h / $src.Height)
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, [int](($w - $src.Width * $scale) / 2), [int](($h - $src.Height * $scale) / 2), [int]($src.Width * $scale), [int]($src.Height * $scale))
  $tmp = Join-Path $env:TEMP "sora-ref-$([guid]::NewGuid()).jpg"
  $bmp.Save($tmp, [Drawing.Imaging.ImageFormat]::Jpeg); $g.Dispose(); $bmp.Dispose(); $src.Dispose()

  # Windows PowerShell 5.1 has no multipart helper, so use the built-in curl.exe for the upload.
  $promptFile = Join-Path $env:TEMP "sora-prompt-$([guid]::NewGuid()).txt"
  [IO.File]::WriteAllText($promptFile, $fullPrompt)
  $raw = & curl.exe -sS https://api.openai.com/v1/videos -H "Authorization: $($headers.Authorization)" `
    -F "model=$Model" -F "prompt=<$promptFile" -F "seconds=$Seconds" -F "size=$Size" -F "input_reference=@$tmp;type=image/jpeg"
  Remove-Item $tmp, $promptFile -ErrorAction SilentlyContinue
  $job = $raw | ConvertFrom-Json
  if ($job.error) { throw "OpenAI error: $($job.error.message)" }
} else {
  $body = @{ model = $Model; prompt = $fullPrompt; seconds = $Seconds; size = $Size } | ConvertTo-Json
  try {
    $job = Invoke-RestMethod -Method Post -Uri "$ApiBase/videos" -Headers $headers -ContentType 'application/json' `
      -Body ([Text.Encoding]::UTF8.GetBytes($body))
  } catch { throw "OpenAI error: $(Read-ApiError $_)" }
}
Write-Host "Job $($job.id) queued."

# ---- 2. Wait for it to finish (usually 1-5 minutes) ----
do {
  Start-Sleep -Seconds 10
  try { $job = Invoke-RestMethod -Uri "$ApiBase/videos/$($job.id)" -Headers $headers }
  catch { throw "OpenAI error: $(Read-ApiError $_)" }
  Write-Host ("  {0} {1}%" -f $job.status, [int]$job.progress)
} while ($job.status -in @('queued', 'in_progress'))

if ($job.status -ne 'completed') { throw "Video failed: $($job.error.message)" }

# ---- 3. Download the MP4 ----
$path = Resolve-OutPath $Out
Invoke-WebRequest -Uri "$ApiBase/videos/$($job.id)/content" -Headers $headers -OutFile $path -UseBasicParsing
Write-Host ("Saved {0} ({1:N1} MB)" -f $path, ((Get-Item $path).Length / 1MB))
