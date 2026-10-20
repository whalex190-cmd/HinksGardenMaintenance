# Shared helpers for the OpenAI generation tools. Dot-sourced by the other scripts.
# The API key is read from $env:OPENAI_API_KEY, or from the project's .env file.
# It is only ever sent to api.openai.com and is never written into the website.

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ApiBase = 'https://api.openai.com/v1'

# Shared house style, so generated imagery matches design.md → Imagery.
$HouseStyle = 'Photorealistic, bright natural daylight, wide-angle, lush well-kept British domestic garden, ' +
              'aspirational but achievable, soft clear sky, natural colours, no text, no logos, no watermarks.'

# Pixel-art style for the hero animation assets (see images/hero/ and the hero plan).
$PixelStyle = 'Polished pixel art between painterly illustration and a high-end 2D game background. ' +
              'Crisp square pixels on one consistent grid, limited rich palette, no blur, no noisy dithering. ' +
              'Warm, nostalgic, cinematic and calm. Early sunrise: peach, pink and gold sky, soft morning mist ' +
              'over distant countryside, long gentle light from the left. Deep greens, lavender, golden yellow, ' +
              'pink roses, clear blue water, warm stone. English country garden. No text, logos, UI or watermark.'

function Get-StyleSuffix([string]$Style) {
  switch ($Style) {
    'photo' { return $HouseStyle }
    'pixel' { return $PixelStyle }
    default { return '' }
  }
}

# POST multipart/form-data with curl.exe (Windows PowerShell 5.1 has no multipart helper).
# $Fields: name -> string value. Long values (e.g. prompts) are sent from a temp file so nothing
# needs shell quoting. $Files: array of @{ Name = 'image[]'; Path = 'C:\...png' }.
function Invoke-OpenAIMultipart([string]$Endpoint, [hashtable]$Fields, [array]$Files, [int]$TimeoutSec = 600) {
  $headers = Get-AuthHeaders
  $tmp = @()
  $curlArgs = @('-sS', '--max-time', "$TimeoutSec", '-X', 'POST', "$ApiBase/$Endpoint", '-H', "Authorization: $($headers.Authorization)")
  foreach ($k in $Fields.Keys) {
    $f = Join-Path $env:TEMP "oai-field-$([guid]::NewGuid()).txt"
    [IO.File]::WriteAllText($f, [string]$Fields[$k], (New-Object Text.UTF8Encoding $false))
    $tmp += $f
    $curlArgs += @('-F', "$k=<$f")
  }
  foreach ($file in $Files) {
    $p = (Resolve-Path $file.Path).Path
    $mime = @{ '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp' }[[IO.Path]::GetExtension($p).ToLower()]
    if (-not $mime) { throw "Unsupported upload type: $p" }
    $curlArgs += @('-F', "$($file.Name)=@$($p -replace '\\','/');type=$mime")
  }
  $outFile = Join-Path $env:TEMP "oai-resp-$([guid]::NewGuid()).json"
  $tmp += $outFile
  try {
    $code = & curl.exe @curlArgs -o $outFile -w '%{http_code}'
    $body = if (Test-Path $outFile) { [IO.File]::ReadAllText($outFile) } else { '' }
    $json = $null
    try { $json = $body | ConvertFrom-Json } catch { }
    if ("$code" -notmatch '^2') {
      $msg = if ($json -and $json.error) { $json.error.message } else { "HTTP $code $body" }
      throw "OpenAI error: $msg"
    }
    return $json
  } finally {
    $tmp | ForEach-Object { Remove-Item $_ -ErrorAction SilentlyContinue }
  }
}

function Get-OpenAIKey {
  if ($env:OPENAI_API_KEY) { return $env:OPENAI_API_KEY }
  $envFile = Join-Path $ProjectRoot '.env'
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$') { return $Matches[1].Trim('"', "'") }
    }
  }
  throw "No OpenAI API key found. Copy .env.example to .env and paste your key into it."
}

function Get-AuthHeaders {
  $key = Get-OpenAIKey
  if ($key -like 'sk-your-key*') { throw "The key in .env is still the placeholder. Paste your real key." }
  @{ Authorization = "Bearer $key" }
}

function Resolve-OutPath([string]$Path) {
  if (-not [IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $ProjectRoot $Path }
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $Path
}

function Read-ApiError($err) {
  # Surface OpenAI's own error message instead of a generic HTTP failure.
  try {
    $stream = $err.Exception.Response.GetResponseStream()
    $body = (New-Object IO.StreamReader $stream).ReadToEnd()
    $msg = ($body | ConvertFrom-Json).error.message
    if ($msg) { return $msg }
    return $body
  } catch { return $err.Exception.Message }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
