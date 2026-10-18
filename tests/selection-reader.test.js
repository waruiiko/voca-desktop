const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createSelectionReader, MAX_SELECTION_LENGTH } = require('../src/main/selection-reader');

function fixture(options = {}) {
  const calls = [];
  const reader = createSelectionReader({
    platform: 'win32',
    execFile(file, args, config, callback) {
      const call = { file, args, config, callback, kills: 0 };
      calls.push(call);
      return { stdin: { on() {}, end(text) { call.input = text; } }, kill() { call.kills++; } };
    },
    ...options,
  });
  const answer = (index, text, error = null, stderr = '') => calls[index].callback(error, text, stderr);
  const command = index => calls[index].input;
  return { reader, calls, answer, command };
}

test('reader launches hidden MTA PowerShell and sends bounded numeric coordinates over stdin', async () => {
  const f = fixture({ timeoutMs: 1700 });
  const result = f.reader.read({ x: -2048, y: 500 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].file, 'powershell.exe');
  assert.deepEqual(f.calls[0].args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
  assert.equal(Buffer.from(f.calls[0].args.at(-1), 'base64').toString('utf16le'), '[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); & ([scriptblock]::Create([Console]::In.ReadToEnd()))');
  assert.match(f.command(0), /\} -UsePoint -X -2048 -Y 500$/);
  assert.equal(f.calls[0].config.windowsHide, true);
  assert.equal(f.calls[0].config.timeout, 1700);
  assert.equal(f.calls[0].config.encoding, 'utf8');
  assert.equal(f.calls[0].config.maxBuffer, 64 * 1024);
  f.answer(0, JSON.stringify('selected text'));
  assert.equal(await result, 'selected text');
});

test('reader safely omits point arguments for non-numeric or overflowing coordinates', async t => {
  for (const [name, point] of [
    ['command text', { x: '1; Write-Host injected', y: 2 }],
    ['fractional', { x: 1.1, y: 2 }],
    ['non-finite', { x: Infinity, y: 2 }],
    ['outside Int32', { x: 2147483648, y: -2147483649 }],
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = f.reader.read(point);
      assert.ok(f.command(0).endsWith('}'));
      assert.doesNotMatch(f.command(0), /Write-Host injected/);
      f.answer(0, '"safe"');
      assert.equal(await result, 'safe');
    });
  }
});

test('reader preserves Unicode, quotes and line breaks from JSON stdout and tolerates a BOM', async () => {
  const f = fixture();
  const result = f.reader.read();
  const selection = '中文 café "quoted"\n第二行 🐱';
  f.answer(0, '\uFEFF' + JSON.stringify('  ' + selection + '  ') + '\r\n');
  assert.equal(await result, selection);
  assert.doesNotMatch(f.command(0), /café|第二行|quoted/);
});

test('empty, malformed, non-string, and oversized output produce no selection', async t => {
  for (const [name, output] of [
    ['empty', ''],
    ['malformed', 'unexpected warning\n"word"'],
    ['object', '{"text":"word"}'],
    ['null', 'null'],
    ['oversized', JSON.stringify('x'.repeat(MAX_SELECTION_LENGTH + 1))],
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      const result = f.reader.read();
      f.answer(0, output);
      assert.equal(await result, '');
    });
  }
});

test('the maximum allowed selection is accepted without truncating its text', async () => {
  const f = fixture();
  const result = f.reader.read();
  const selection = 'x'.repeat(MAX_SELECTION_LENGTH);
  f.answer(0, JSON.stringify(selection));
  assert.equal(await result, selection);
});

test('helper errors and timeouts cannot return partial stdout as a valid selection', async t => {
  for (const code of ['ETIMEDOUT', 'ENOENT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']) {
    await t.test(code, async () => {
      const f = fixture();
      const result = f.reader.read();
      f.answer(0, '"partial text"', Object.assign(new Error(code), { code }));
      assert.equal(await result, '');
    });
  }
});

test('a synchronous spawn failure resolves safely instead of rejecting the reader promise', async () => {
  const f = fixture({ execFile() { throw new Error('cannot spawn helper'); } });
  assert.equal(await f.reader.read(), '');
});

test('cancel settles the pending read and terminates the helper; late output is ignored', async () => {
  const f = fixture();
  const result = f.reader.read();
  f.reader.cancel();
  assert.equal(await result, '');
  assert.equal(f.calls[0].kills, 1);
  f.answer(0, '"stale text"');
  f.reader.cancel();
  assert.equal(f.calls[0].kills, 1);
});

test('a newer read supersedes the older helper and receives only its own response', async () => {
  const f = fixture();
  const older = f.reader.read({ x: 10, y: 10 });
  const newer = f.reader.read({ x: 20, y: 20 });
  assert.equal(await older, '');
  assert.equal(f.calls[0].kills, 1);
  f.answer(0, '"obsolete selection"');
  f.answer(1, '"current selection"');
  assert.equal(await newer, 'current selection');
});

test('stop cancels current work and makes all future reads inert', async () => {
  const f = fixture();
  const pending = f.reader.read();
  f.reader.stop();
  assert.equal(await pending, '');
  assert.equal(f.calls[0].kills, 1);
  assert.equal(await f.reader.read(), '');
  assert.equal(f.calls.length, 1);
  f.answer(0, '"text after stop"');
});

test('non-Windows platforms and missing packaged script files do not launch a helper', async () => {
  for (const options of [{ platform: 'linux' }, { scriptPath: path.join(__dirname, 'does-not-exist.ps1') }]) {
    const f = fixture(options);
    assert.equal(await f.reader.read(), '');
    assert.equal(f.calls.length, 0);
  }
});

test('mouse gesture origin is passed only when all coordinates are valid', async () => {
  const f = fixture();
  const pending = f.reader.read({ x: 100, y: 200, originX: -100, originY: 190 });
  assert.match(f.command(0), /-UsePoint -X 100 -Y 200 -UseOrigin -OriginX -100 -OriginY 190$/);
  f.answer(0, JSON.stringify({ status: 'selected', text: 'word' }));
  assert.equal(await pending, 'word');
  const invalid = f.reader.read({ x: 100, y: 200, originX: 'malicious', originY: 1 });
  assert.doesNotMatch(f.command(1), /-UseOrigin|malicious/);
  f.answer(1, JSON.stringify({ status: 'empty', text: '' }));
  assert.equal(await invalid, '');
});

test('structured helper statuses cannot accidentally return non-selection text or leak diagnostics', async () => {
  const diagnostics = [];
  const f = fixture({ reportDiagnostic: entry => diagnostics.push(entry), now: () => 100 });
  for (const status of ['selected', 'empty', 'unsupported', 'focus-changed', 'protected', 'error', 'no-foreground', 'point-mismatch', 'oversized']) {
    const index = f.calls.length;
    const pending = f.reader.read();
    f.answer(index, JSON.stringify({ status, text: 'sensitive selected text', error: 'private exception message' }));
    assert.equal(await pending, status === 'selected' ? 'sensitive selected text' : '');
    assert.equal(diagnostics.at(-1).status, status);
  }
  assert.doesNotMatch(JSON.stringify(diagnostics), /sensitive|private|exception|text/);
  assert.ok(diagnostics.every(entry => entry.elapsedMs === 0));
});

test('diagnostics distinguish spawn failure, timeout and malformed output without reporting exception messages', async () => {
  const diagnostics = [];
  const f = fixture({ reportDiagnostic: entry => diagnostics.push(entry) });
  let pending = f.reader.read();
  f.answer(0, 'private partial output', Object.assign(new Error('private document text'), { code: 'ETIMEDOUT' }));
  assert.equal(await pending, '');
  assert.equal(diagnostics.at(-1).status, 'timeout');
  pending = f.reader.read();
  f.answer(1, '{private invalid output}');
  assert.equal(await pending, '');
  assert.equal(diagnostics.at(-1).status, 'invalid-output');
  const spawn = fixture({ reportDiagnostic: entry => diagnostics.push(entry), execFile() { throw new Error('private input'); } });
  assert.equal(await spawn.reader.read(), '');
  assert.equal(diagnostics.at(-1).status, 'spawn-error');
  assert.doesNotMatch(JSON.stringify(diagnostics), /private/);
});

test('diagnostic callback failures cannot prevent selection reads or cancellation', async () => {
  const f = fixture({ reportDiagnostic() { throw new Error('logger unavailable'); } });
  const pending = f.reader.read();
  f.answer(0, JSON.stringify({ status: 'selected', text: 'word' }));
  assert.equal(await pending, 'word');
  const cancelled = f.reader.read();
  f.reader.cancel();
  assert.equal(await cancelled, '');
});

test('the real PowerShell transport handles large bundled source and Unicode without touching the desktop', { skip: process.platform !== 'win32' }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voca-selection-transport-'));
  t.after(() => {
    const resolved = path.resolve(tempRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('voca-selection-transport-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const scriptPath = path.join(tempRoot, 'transport.ps1');
  fs.writeFileSync(scriptPath, `param([switch]$UsePoint,[int]$X,[int]$Y,[switch]$UseOrigin,[int]$OriginX,[int]$OriginY)\n# ${'x'.repeat(48000)}\n[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)\n[Console]::WriteLine((@{status='selected';text="中文 x=$X y=$Y origin=$OriginX,$OriginY"} | ConvertTo-Json -Compress))\n`);
  const diagnostics = [];
  const reader = createSelectionReader({ scriptPath, timeoutMs: 10000, reportDiagnostic: value => diagnostics.push(value) });
  assert.equal(await reader.read({ x: -2048, y: 500, originX: -2100, originY: 499 }), '中文 x=-2048 y=500 origin=-2100,499');
  assert.equal(diagnostics.at(-1).status, 'selected');
});

