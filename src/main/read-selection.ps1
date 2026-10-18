param(
  [switch]$UsePoint,
  [int]$X = 0,
  [int]$Y = 0,
  [switch]$UseOrigin,
  [int]$OriginX = 0,
  [int]$OriginY = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

try {
  # Node injects the bundled source, including when packaged inside app.asar.
  # Native COM avoids the legacy managed RawTextRange_GetText crash on Windows 11.
  $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__VOCA_NATIVE_SOURCE_BASE64__'))
  Add-Type -TypeDefinition $source -Language CSharp
  $result = [VocaNativeSelection]::Read([bool]$UsePoint, $X, $Y, [bool]$UseOrigin, $OriginX, $OriginY)
  [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress))
} catch {
  # No raw exception messages or UI text enter diagnostics.
  [Console]::WriteLine('{"status":"error","text":"","stage":"initialization","candidateCount":0}')
}
