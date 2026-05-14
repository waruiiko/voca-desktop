param(
  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$OutputDir = "C:\tmp\voca-release-$Version",

  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Write-Step "Updating version to $Version"
$pkgPath = Join-Path $root "package.json"
$lockPath = Join-Path $root "package-lock.json"

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8

if (Test-Path $lockPath) {
  $lock = Get-Content $lockPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $lock.version = $Version
  if ($lock.packages -and $lock.packages."") {
    $lock.packages."".version = $Version
  }
  $lock | ConvertTo-Json -Depth 100 | Set-Content $lockPath -Encoding UTF8
}

Write-Step "Checking working tree for ignored build outputs"
git status --short

if (-not $SkipBuild) {
  Write-Step "Building renderer"
  npm run build
}

Write-Step "Packaging to $OutputDir"
if (Test-Path $OutputDir) {
  Write-Host "Output directory exists. Remove it manually if Windows reports access denied." -ForegroundColor Yellow
}

.\node_modules\.bin\electron-builder.cmd --config.directories.output="$OutputDir"

Write-Step "Done"
Write-Host "Installer:" -ForegroundColor Green
Get-ChildItem $OutputDir -Filter "Voca Setup $Version.exe" | Select-Object -ExpandProperty FullName
