const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const literal = value => "'" + value.replace(/'/g, "''") + "'";
function runValidation(body) {
  const command = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n" + body;
  const child = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64'),
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.replace(/^\uFEFF/, '').trim());
}

test('Windows helper parses and native COM interop compiles without invoking desktop APIs', { skip: process.platform !== 'win32' }, () => {
  const ps = literal(path.join(__dirname, '../src/main/read-selection.ps1'));
  const cs = literal(path.join(__dirname, '../src/main/native-selection.cs'));
  const result = runValidation(`
$tokens=$null; $parseErrors=$null
[void][System.Management.Automation.Language.Parser]::ParseFile(${ps}, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw ($parseErrors | Out-String) }
Add-Type -Path ${cs}
$read = [VocaNativeSelection].GetMethod('Read')
if ($null -eq $read -or $read.GetParameters().Count -ne 6) { throw 'Native read contract missing' }
$resultType = $read.ReturnType
foreach ($name in @('status','text','stage','candidateCount')) {
  if ($null -eq $resultType.GetField($name) -and $null -eq $resultType.GetProperty($name)) { throw 'Native result contract missing' }
}
[pscustomobject]@{ parsed=$true; compiled=$true; readParameters=$read.GetParameters().Count } | ConvertTo-Json -Compress
`);
  assert.deepEqual(result, { parsed: true, compiled: true, readParameters: 6 });
});

test('native geometry accepts current gestures and rejects old, hidden or invalid selections', { skip: process.platform !== 'win32' }, () => {
  const cs = literal(path.join(__dirname, '../src/main/native-selection.cs'));
  const checks = runValidation(`
Add-Type -Path ${cs}
[ordered]@{
  endpoint = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0),150,110,$false,0,0)
  glyphEdge = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0),208,110,$false,0,0)
  dragThrough = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0),250,110,$true,50,110)
  reverseDrag = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0),50,110,$true,250,110)
  multiLine = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0,100.0,130.0,100.0,20.0),250,140,$true,50,110)
  negativeMonitor = [VocaNativeSelection]::TestSelectionGeometry(@(-500.0,100.0,100.0,20.0),-450,110,$false,0,0)
  stalePane = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,100.0,20.0),600,110,$true,500,110)
  diagonalMiss = [VocaNativeSelection]::TestSelectionGeometry(@(100.0,100.0,20.0,20.0),250,150,$true,50,250)
  hidden = [VocaNativeSelection]::TestSelectionGeometry(@(0.0,0.0,0.0,0.0),0,0,$false,0,0)
  missing = [VocaNativeSelection]::TestSelectionGeometry(@(),0,0,$false,0,0)
  invalid = [VocaNativeSelection]::TestSelectionGeometry(@([double]::NaN,100.0,100.0,20.0),150,110,$false,0,0)
} | ConvertTo-Json -Compress
`);
  for (const name of ['endpoint','glyphEdge','dragThrough','reverseDrag','multiLine','negativeMonitor']) assert.equal(checks[name], true, name);
  for (const name of ['stalePane','diagonalMiss','hidden','missing','invalid']) assert.equal(checks[name], false, name);
});
