const { execFile: defaultExecFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_SELECTION_LENGTH = 5000;

// Reading the script through Node also works when Electron packages it in app.asar.
// PowerShell itself cannot open a -File path inside an asar archive.
function createSelectionReader({
  execFile = defaultExecFile,
  platform = process.platform,
  scriptPath = path.join(__dirname, 'read-selection.ps1'),
  nativeSourcePath = path.join(__dirname, 'native-selection.cs'),
  timeoutMs = 2500,
  reportDiagnostic = () => {},
  now = Date.now,
} = {}) {
  let stopped = false;
  let active = null;
  let script;

  // Never forward helper output or exception messages to diagnostics: they can
  // contain document text. Only fixed statuses and timing leave the reader.
  const statuses = new Set(['selected', 'empty', 'unsupported', 'focus-changed',
    'protected', 'error', 'no-foreground', 'point-mismatch', 'oversized']);
  const phases = new Set(['initialization', 'foreground', 'focus', 'point', 'candidates',
    'context', 'selection', 'geometry', 'length', 'provider', 'text-pattern']);
  function report(status, startedAt, extra = {}) {
    try { reportDiagnostic({ stage: 'reader', status, elapsedMs: Math.max(0, now() - startedAt), ...extra }); } catch {}
  }

  function cancel() {
    const request = active;
    if (!request) return;
    active = null;
    report('cancelled', request.startedAt);
    request.resolve('');
    try { request.child?.kill(); } catch {}
  }

  function read({ x, y, originX, originY } = {}) {
    cancel();
    const startedAt = now();
    if (stopped || platform !== 'win32') {
      report(stopped ? 'stopped' : 'platform-unsupported', startedAt);
      return Promise.resolve('');
    }

    try {
      if (script === undefined) {
        let source = fs.readFileSync(scriptPath, 'utf8');
        if (source.includes('__VOCA_NATIVE_SOURCE_BASE64__')) {
          const nativeSource = fs.readFileSync(nativeSourcePath).toString('base64');
          source = source.replace('__VOCA_NATIVE_SOURCE_BASE64__', nativeSource);
        }
        script = source;
      }
    } catch {
      report('script-unavailable', startedAt);
      return Promise.resolve('');
    }

    // Only numeric arguments enter the command. Selected text is returned on
    // stdout; it is never part of a command, clipboard operation, or key event.
    const coordinate = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
    const hasPoint = coordinate(x) && coordinate(y);
    const hasOrigin = hasPoint && coordinate(originX) && coordinate(originY);
    let args = hasPoint ? ` -UsePoint -X ${x} -Y ${y}` : '';
    if (hasOrigin) args += ` -UseOrigin -OriginX ${originX} -OriginY ${originY}`;
    const command = `& {\n${script}\n}${args}`;
    // Pass bundled code over stdin: native interop definitions can exceed the
    // Windows command-line length limit after UTF-16/base64 expansion.
    const bootstrap = '[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false); & ([scriptblock]::Create([Console]::In.ReadToEnd()))';
    const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64');

    return new Promise((resolve) => {
      const request = { child: null, resolve, startedAt };
      active = request;
      try {
        request.child = execFile('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-Mta', '-ExecutionPolicy', 'Bypass',
          '-EncodedCommand', encoded,
        ], {
          windowsHide: true,
          timeout: timeoutMs,
          encoding: 'utf8',
          maxBuffer: 64 * 1024,
        }, (error, stdout, stderr) => {
          if (active !== request) return;
          active = null;
          if (error) {
            const extra = {};
            if (Number.isInteger(error.code)) extra.exitCode = error.code;
            // PowerShell's error identifier describes the failing operation;
            // unlike its message or source excerpt, it never includes UI text.
            const identifier = String(stderr || '').match(/FullyQualifiedErrorId\s*:\s*([A-Za-z][A-Za-z0-9_.-]{0,79})/);
            if (identifier) extra.errorType = identifier[1];
            report(error.killed || error.code === 'ETIMEDOUT' ? 'timeout' : 'helper-error', startedAt, extra);
            resolve(''); return;
          }
          try {
            const result = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
            // Accept the previous string protocol for an older helper supplied
            // by embedders; the bundled helper returns explicit status objects.
            const status = typeof result === 'string' ? 'selected' : result?.status;
            const text = typeof result === 'string' ? result : result?.text;
            if (!statuses.has(status) || typeof text !== 'string') {
              report('invalid-output', startedAt); resolve(''); return;
            }
            if (text.length > MAX_SELECTION_LENGTH) {
              report('oversized', startedAt); resolve(''); return;
            }
            const selected = status === 'selected' ? text.trim() : '';
            const extra = phases.has(result?.stage) ? { phase: result.stage } : {};
            report(selected ? 'selected' : status === 'selected' ? 'empty' : status, startedAt, extra);
            resolve(selected);
          } catch {
            report('invalid-output', startedAt);
            resolve('');
          }
        });
        request.child?.stdin?.on('error', () => {});
        request.child?.stdin?.end(command);
      } catch {
        if (active === request) active = null;
        report('spawn-error', startedAt);
        resolve('');
      }
    });
  }

  function stop() {
    stopped = true;
    cancel();
  }

  return { read, cancel, stop };
}

module.exports = { createSelectionReader, MAX_SELECTION_LENGTH };
