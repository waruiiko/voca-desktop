const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const RENDERER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
let DATA_FILE, SETTINGS_FILE;

let mainWindow = null;
let overlayWindow = null;
let iconWindow = null;
let screenshotWindow = null;
let tray = null;
let pendingText = '';
let overlayPinned = false;
let recentLookups = [];
let apiServerStatus = { running: false, port: 27149, error: '', lastSyncAt: 0, lastSyncSummary: '' };

// ── 默认设置 ──────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  translateApi: 'google',
  deeplKey: '',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  ttsVoice: '',
  dailyGoal: 10,
  syncConflictStrategy: 'merge',
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8');
}

// ── 数据（多生词本）───────────────────────────────────────────────
const DEFAULT_STATS = { streak: 0, lastStudyDate: '', todayReviewed: 0, totalReviewed: 0 };

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!raw.books) {
        return { activeBookId: 'default', saveBookId: 'default', flashPool: [], stats: { ...DEFAULT_STATS }, books: { default: { name: '默认生词本', words: raw } } };
      }
      if (!raw.saveBookId) raw.saveBookId = raw.activeBookId;
      if (!raw.flashPool) raw.flashPool = [];
      if (!raw.stats) raw.stats = { ...DEFAULT_STATS };
      return raw;
    }
  } catch {}
  return { activeBookId: 'default', saveBookId: 'default', flashPool: [], stats: { ...DEFAULT_STATS }, books: { default: { name: '默认生词本', words: {} } } };
}

function saveData(data) {
  createDataBackup();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch {}
}

function createDataBackup() {
  try {
    if (!DATA_FILE || !fs.existsSync(DATA_FILE)) return;
    const dir = path.join(path.dirname(DATA_FILE), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(dir, `voca-words-${stamp}.json`));
    const backups = fs.readdirSync(dir)
      .filter(name => /^voca-words-.+\.json$/.test(name))
      .map(name => ({ name, path: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of backups.slice(20)) fs.unlinkSync(old.path);
  } catch {}
}

function listBackups() {
  try {
    const dir = path.join(path.dirname(DATA_FILE), 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(name => /^voca-words-.+\.json$/.test(name))
      .map(name => {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        return { name, path: file, time: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

function restoreBackup(backupPath) {
  const backups = listBackups();
  const target = backups.find(b => b.path === backupPath);
  if (!target || !fs.existsSync(target.path)) return { success: false, error: 'backup not found' };
  createDataBackup();
  fs.copyFileSync(target.path, DATA_FILE);
  mainWindow?.webContents.send('words-updated');
  return { success: true };
}

function inspectData() {
  const data = loadData();
  const books = data.books || {};
  const seen = new Map();
  let totalWords = 0;
  let emptyTranslations = 0;
  let invalidWords = 0;
  let duplicateAcrossBooks = 0;

  for (const [bookId, book] of Object.entries(books)) {
    for (const [key, w] of Object.entries(book.words || {})) {
      totalWords += 1;
      const normalized = String(w.word || key || '').trim().toLowerCase();
      if (!normalized) invalidWords += 1;
      if (!w.translation) emptyTranslations += 1;
      const owner = seen.get(normalized);
      if (owner && owner !== bookId) duplicateAcrossBooks += 1;
      else seen.set(normalized, bookId);
    }
  }

  const flashPool = data.flashPool || [];
  const flashOrphans = flashPool.filter(p => !books[p.bookId]?.words?.[p.key]).length;
  const backups = listBackups();

  return {
    bookCount: Object.keys(books).length,
    totalWords,
    emptyTranslations,
    duplicateAcrossBooks,
    invalidWords,
    flashPoolCount: flashPool.length,
    flashOrphans,
    backupCount: backups.length,
    latestBackupTime: backups[0]?.time || 0,
  };
}

function repairData() {
  const data = loadData();
  const books = data.books || {};
  let removedInvalidWords = 0;
  let fixedMissingKeys = 0;

  for (const book of Object.values(books)) {
    const nextWords = {};
    for (const [key, w] of Object.entries(book.words || {})) {
      const word = String(w.word || key || '').trim();
      if (!word) {
        removedInvalidWords += 1;
        continue;
      }
      const normalizedKey = String(w.key || key || word).trim().toLowerCase();
      if (!w.key) fixedMissingKeys += 1;
      nextWords[normalizedKey] = { ...w, key: normalizedKey, word };
    }
    book.words = nextWords;
  }

  const beforePool = (data.flashPool || []).length;
  data.flashPool = (data.flashPool || []).filter(p => books[p.bookId]?.words?.[p.key]);
  const removedFlashOrphans = beforePool - data.flashPool.length;

  if (!books[data.activeBookId]) data.activeBookId = Object.keys(books)[0] || 'default';
  if (!books[data.saveBookId]) data.saveBookId = data.activeBookId;

  saveData(data);
  mainWindow?.webContents.send('words-updated');
  return { success: true, removedInvalidWords, fixedMissingKeys, removedFlashOrphans, summary: inspectData() };
}

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// ── 翻译 ──────────────────────────────────────────────────────────
async function doTranslate(text, sl, tl, settings) {
  const api = settings.translateApi || 'google';

  if (api === 'deepl' && settings.deeplKey) {
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': `DeepL-Auth-Key ${settings.deeplKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: [text],
        source_lang: sl === 'auto' ? undefined : sl.toUpperCase().split('-')[0],
        target_lang: tl.toUpperCase().replace('-', '_'),
      }),
    });
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
    const d = await res.json();
    return d.translations[0].text;
  }

  if (api === 'mymemory') {
    const langpair = `${sl === 'auto' ? 'en' : sl}|${tl}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langpair}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
    const d = await res.json();
    if (d.responseStatus !== 200) throw new Error(d.responseDetails);
    return d.responseData.translatedText;
  }

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const d = await res.json();
  return d[0]?.filter(Boolean).map(i => i[0] || '').join('') || '';
}

// ── 主窗口 ────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1060, height: 700, minWidth: 860, minHeight: 520,
    title: 'Voca',
    icon: path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'assets/favicon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f7',
  });
  if (isDev) mainWindow.loadURL(RENDERER_URL);
  else mainWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/dist/index.html'));
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
}

// ── 悬浮翻译窗口 ──────────────────────────────────────────────────
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 380, height: 160, show: false,
    frame: false, transparent: true, backgroundColor: '#00000000',
    alwaysOnTop: true, skipTaskbar: true, resizable: true,
    minWidth: 280, minHeight: 100,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isDev) overlayWindow.loadURL(`${RENDERER_URL}/#/overlay`);
  else overlayWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/dist/index.html'), { hash: 'overlay' });

  let blurTimer = null;
  overlayWindow.on('blur', () => {
    if (overlayPinned) return;
    blurTimer = setTimeout(() => { if (!overlayWindow.isDestroyed()) overlayWindow.hide(); }, 200);
  });
  overlayWindow.on('focus', () => { if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } });
  overlayWindow.on('hide', () => { overlayPinned = false; });
}

// ── 悬浮图标窗口 ──────────────────────────────────────────────────
function createIconWindow() {
  iconWindow = new BrowserWindow({
    width: 32, height: 32, show: false,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  iconWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isDev) iconWindow.loadURL(`${RENDERER_URL}/#/icon`);
  else iconWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/dist/index.html'), { hash: 'icon' });
  iconWindow.webContents.on('did-finish-load', () => {
    if (!iconWindow.isDestroyed()) iconWindow.setSize(32, 32);
  });
  iconWindow.on('blur', () => setTimeout(() => { if (!iconWindow.isDestroyed()) iconWindow.hide(); }, 150));
}

// ── 截图选区窗口 ──────────────────────────────────────────────────
function createScreenshotWindow() {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.close();
  }
  const { bounds } = screen.getPrimaryDisplay();
  screenshotWindow = new BrowserWindow({
    x: 0, y: 0, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  screenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isDev) screenshotWindow.loadURL(`${RENDERER_URL}/#/screenshot`);
  else screenshotWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/dist/index.html'), { hash: 'screenshot' });
}

// ── 图标显示/隐藏 ─────────────────────────────────────────────────
let iconHideTimer = null;

function showIcon(text) {
  if (!iconWindow || !text) return;
  pendingText = text;
  const point = screen.getCursorScreenPoint();
  const { workArea: wa } = screen.getDisplayNearestPoint(point);
  const x = Math.max(wa.x, Math.min(point.x + 16, wa.x + wa.width - 32));
  const y = Math.max(wa.y, Math.min(point.y + 16, wa.y + wa.height - 32));
  iconWindow.setSize(32, 32);
  iconWindow.setPosition(Math.round(x), Math.round(y));
  iconWindow.showInactive();
  if (iconHideTimer) clearTimeout(iconHideTimer);
  iconHideTimer = setTimeout(() => {
    if (iconWindow && !iconWindow.isDestroyed()) iconWindow.hide();
  }, 1000);
}

function hideIcon() {
  if (iconHideTimer) { clearTimeout(iconHideTimer); iconHideTimer = null; }
  if (iconWindow && !iconWindow.isDestroyed()) iconWindow.hide();
}

// ── 复习到期提醒 ──────────────────────────────────────────────────
function checkDueAndNotify() {
  try {
    if (!Notification.isSupported()) return;
    const data = loadData();
    const pool = data.flashPool || [];
    const now = Date.now();
    const due = pool.filter(w => !w.mastered && (!w.nextReview || w.nextReview <= now)).length;
    if (due > 0) {
      const n = new Notification({
        title: 'Voca 复习提醒',
        body: `你有 ${due} 个单词待复习，点击开始`,
      });
      n.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
      n.show();
    }
  } catch {}
}

// ── OCR 空格修复（基于词语坐标）────────────────────────────────────
function fixOcrSpaces(jsonText) {
  let lines;
  try { lines = JSON.parse(jsonText); } catch { return jsonText; }
  return lines.map(line => {
    const words = line.words || [];
    if (!words.length) return '';
    // 计算行内所有相邻词间距，取中位数作为"正常词间距"参考
    const gaps = words.slice(1).map((w, i) => Math.max(0, w.x - (words[i].x + words[i].w)));
    const sorted = [...gaps].sort((a, b) => a - b);
    const medianGap = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // 阈值 = 中位间距的 32%；若行只有一个间距则用字符宽估算
    const dynThreshold = gaps.length > 1
      ? medianGap * 0.36
      : ((words[0].w / (words[0].t.length || 1)) * 0.45);

    const merged = [];
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const prev = cur;
      const next = words[i];
      const gap = Math.max(0, next.x - (prev.x + prev.w));
      if (gap < dynThreshold) {
        cur = { t: prev.t + next.t, x: prev.x, w: next.x + next.w - prev.x, h: Math.max(prev.h, next.h) };
      } else {
        merged.push(cur.t);
        cur = next;
      }
    }
    merged.push(cur.t);
    return merged.join(' ');
  }).join('\n')
  // 修复大写 I 夹在字母之间被误读为 l（Silverton, also 等）
  .replace(/([a-zA-Z])I([a-zA-Z])/g, (m, a, b) => {
    // 两边都是小写，或前小后大 → I 应为 l
    if (/[a-z]/.test(a) || /[a-z]/.test(b)) return a + 'l' + b;
    return m;
  })
  // 修复大写 S 夹在小写字母之间（iSJust → isJust，aISo → also）
  .replace(/([a-z])S([a-z])/g, '$1s$2')
  // 修复数字 0 混入字母词（0 当字母 o 用）
  .replace(/([a-zA-Z])0([a-zA-Z])/g, '$1o$2')
  .replace(/\b0([a-zA-Z]{2,})/g, 'o$1')
  // 修复词尾大写 O 应为小写（tO→to，intO→into；保留全大写缩写）
  .replace(/\b([a-zA-Z]+)O\b/g, (m, pre) => /^[A-Z]+$/.test(pre) ? m : pre + 'o')
  // 修复词首大写 O 接小写（Of→of，Oil→oil 等）
  .replace(/\bO([a-z]{2,})\b/g, 'o$1')
  // 修复独立数字 0 夹在字母词之间（fro m 0 u r → from our）
  .replace(/(?<=[a-zA-Z]) 0 (?=[a-zA-Z])/g, ' o ');
}

// ── OCR ───────────────────────────────────────────────────────────
async function captureAndOcr(x, y, w, h) {
  const os = require('os');
  const cp = require('child_process');

  const imgPath = path.join(os.tmpdir(), `voca-ocr-${Date.now()}.png`);
  const imgPathPs = imgPath; // 单反斜杠直接嵌入 PS1 单引号字符串，无需转义
  const ps1Content = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

# 截图
$bmp = New-Object System.Drawing.Bitmap(${w}, ${h})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${x}, ${y}, 0, 0, (New-Object System.Drawing.Size(${w}, ${h})))
$g.Dispose()
$bmp.Save('${imgPathPs}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# 加载 WinRT 类型
[void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream,Windows.Storage,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrResult,Windows.Foundation,ContentType=WindowsRuntime]

# 加载 WinRT 互操作 DLL，通过 Assembly 对象获取类型（不能用 [] 语法）
$rtDll = $null
foreach ($c in @(
  "$env:windir\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Runtime.WindowsRuntime.dll",
  "$env:windir\\Microsoft.NET\\Framework\\v4.0.30319\\System.Runtime.WindowsRuntime.dll",
  [IO.Path]::Combine([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory(), 'System.Runtime.WindowsRuntime.dll')
)) { if (Test-Path $c) { $rtDll = $c; break } }
if (-not $rtDll) { Write-Error 'Cannot find System.Runtime.WindowsRuntime.dll'; exit 1 }
$rtAsm = [Reflection.Assembly]::LoadFile($rtDll)
$extType = $rtAsm.GetType('System.WindowsRuntimeSystemExtensions')
$_asTask = $extType.GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1

function Await([object]$op, [Type]$t) {
  $task = $_asTask.MakeGenericMethod($t).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}

$file    = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${imgPathPs}')) ([Windows.Storage.StorageFile])
$stream  = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap  = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine  = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Error 'OcrEngine not available'; exit 1 }
$result  = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) {
  $ws = @()
  foreach ($word in $line.Words) {
    $r = $word.BoundingRect
    $ws += [PSCustomObject]@{ t = $word.Text; x = [int]$r.X; w = [int]$r.Width; h = [int]$r.Height }
  }
  $lines += [PSCustomObject]@{ words = $ws }
}
Write-Output (ConvertTo-Json @($lines) -Compress -Depth 3)
`.trim();

  const ps1Path = path.join(os.tmpdir(), 'voca-ocr.ps1');
  fs.writeFileSync(ps1Path, ps1Content, 'utf-8');

  return new Promise((resolve) => {
    cp.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
      { windowsHide: true, timeout: 20000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(ps1Path); } catch {}
        if (err) { console.error('[OCR]', stderr); resolve(''); return; }
        resolve(fixOcrSpaces(stdout.trim()));
      }
    );
  });
}

// ── 划词 & 双击 Ctrl+C 检测 ───────────────────────────────────────
function startDoubleCtrlCDetection() {
  // OCR shortcut (works even without uiohook)
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    createScreenshotWindow();
  });

  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    const cp = require('child_process');
    const os = require('os');

    let ctrlDown = false;
    let lastCtrlCTime = 0;
    let suppressCtrlCUntil = 0;

    let vbsPath = null;
    if (process.platform === 'win32') {
      vbsPath = path.join(os.tmpdir(), 'voca-sim.vbs');
      try {
        fs.writeFileSync(vbsPath, 'CreateObject("WScript.Shell").SendKeys "^c"\r\n');
      } catch (err) {
        console.warn('[Voca] 无法创建 VBS 文件:', err.message);
      }
    }

    let mouseDownX = 0, mouseDownY = 0;

    uIOhook.on('mousedown', (e) => {
      if (e.button === 1) { mouseDownX = e.x; mouseDownY = e.y; }
    });

    uIOhook.on('mouseup', (e) => {
      if (e.button !== 1 || !vbsPath) return;
      const dx = e.x - mouseDownX, dy = e.y - mouseDownY;
      if (Math.sqrt(dx * dx + dy * dy) < 15) return;

      const prevClip = clipboard.readText();
      suppressCtrlCUntil = Date.now() + 600;

      cp.execFile('cscript.exe', ['//nologo', vbsPath], { windowsHide: true }, () => {
        suppressCtrlCUntil = 0;
        setTimeout(() => {
          const newText = clipboard.readText().trim();
          if (newText && newText !== prevClip.trim() && newText.length <= 5000) {
            hideIcon();
            showIcon(newText);
          }
        }, 150);
      });
    });

    uIOhook.on('keydown', (e) => {
      if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) { ctrlDown = true; return; }
      if (ctrlDown && e.keycode === UiohookKey.C) {
        if (Date.now() < suppressCtrlCUntil) return;
        const now = Date.now();
        const elapsed = now - lastCtrlCTime;
        if (elapsed < 600 && elapsed > 0) {
          lastCtrlCTime = 0;
          hideIcon();
          setTimeout(() => {
            const text = clipboard.readText().trim();
            if (text && text.length <= 5000) showOverlay(text);
          }, 100);
        } else {
          lastCtrlCTime = now;
          setTimeout(() => {
            const text = clipboard.readText().trim();
            if (text && text.length <= 5000) showIcon(text);
          }, 100);
        }
      }
    });

    uIOhook.on('keyup', (e) => {
      if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) ctrlDown = false;
    });

    uIOhook.start();
    console.log('[Voca] 划词翻译 + 双击 Ctrl+C 已启用');
  } catch (e) {
    console.warn('[Voca] uiohook-napi 不可用，降级为 Ctrl+Shift+D:', e.message);
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      const text = clipboard.readText().trim();
      if (text && text.length <= 5000) showOverlay(text);
    });
  }
}

// ── 显示翻译悬浮窗 ────────────────────────────────────────────────
function showOverlay(text) {
  if (!overlayWindow) return;
  overlayPinned = false;
  const point = screen.getCursorScreenPoint();
  const { workArea: wa } = screen.getDisplayNearestPoint(point);
  const [, h] = overlayWindow.getSize();
  const x = Math.max(wa.x, Math.min(point.x + 12, wa.x + wa.width - 380));
  const y = Math.max(wa.y, Math.min(point.y + 12, wa.y + wa.height - h));
  overlayWindow.setPosition(Math.round(x), Math.round(y));
  overlayWindow.showInactive();
  overlayWindow.webContents.send('translate-text', text);
}

// ── 系统托盘 ──────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'assets/icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Voca');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Voca', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.exit(0); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC ───────────────────────────────────────────────────────────
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => { saveSettings(s); return true; });
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('load-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });
ipcMain.handle('list-backups', () => listBackups());
ipcMain.handle('restore-backup', (_, backupPath) => restoreBackup(backupPath));
ipcMain.handle('get-sync-status', () => ({
  ...apiServerStatus,
  lastLookupCount: recentLookups.length,
}));
ipcMain.handle('inspect-data', () => inspectData());
ipcMain.handle('repair-data', () => repairData());
ipcMain.handle('open-external', (_, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle('check-for-updates', async () => {
  try {
    const res = await fetch('https://api.github.com/repos/waruiiko/voca-desktop/releases/latest', {
      headers: { 'User-Agent': 'Voca Desktop' },
    });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const latest = await res.json();
    const latestVersion = String(latest.tag_name || latest.name || '').replace(/^v/i, '');
    const currentVersion = app.getVersion();
    return {
      success: true,
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      url: latest.html_url || 'https://github.com/waruiiko/voca-desktop/releases/latest',
    };
  } catch (e) {
    return { success: false, error: e.message, currentVersion: app.getVersion() };
  }
});

ipcMain.handle('load-words', () => {
  const data = loadData();
  const bookId = data.saveBookId || data.activeBookId;
  return data.books[bookId]?.words || {};
});
ipcMain.handle('save-words', (_, words) => {
  const data = loadData();
  const bookId = data.saveBookId || data.activeBookId;
  if (data.books[bookId]) data.books[bookId].words = words;
  saveData(data);
  return true;
});

ipcMain.handle('hide-overlay', () => { overlayPinned = false; overlayWindow?.hide(); });
ipcMain.handle('show-main', () => { mainWindow?.show(); mainWindow?.focus(); });
ipcMain.handle('notify-words-updated', () => mainWindow?.webContents.send('words-updated'));

ipcMain.handle('toggle-overlay-pin', () => {
  overlayPinned = !overlayPinned;
  return overlayPinned;
});

ipcMain.handle('resize-overlay', (_, w, h) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const [cx, cy] = overlayWindow.getPosition();
  const { workArea: wa } = screen.getDisplayNearestPoint({ x: cx, y: cy });
  const maxH = Math.floor(wa.height * 0.85);
  const newH = Math.min(h, maxH);
  const newW = Math.min(Math.max(w, 280), wa.width - 20);
  const newX = Math.min(cx, wa.x + wa.width - newW);
  const newY = Math.min(cy, wa.y + wa.height - newH);
  overlayWindow.setSize(Math.round(newW), Math.round(newH));
  overlayWindow.setPosition(Math.round(newX), Math.round(newY));
});

ipcMain.handle('open-translate', (_, text) => {
  overlayPinned = false;
  overlayWindow?.hide();
  mainWindow?.show();
  mainWindow?.focus();
  mainWindow?.webContents.send('open-translate', text);
});

ipcMain.handle('icon-clicked', () => {
  hideIcon();
  if (pendingText) showOverlay(pendingText);
});

ipcMain.handle('translate', async (_, text, sl, tl) => {
  try {
    const settings = loadSettings();
    const result = await doTranslate(text, sl || settings.sourceLang, tl || settings.targetLang, settings);
    return { success: true, text: result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-word-detail', async (_, word) => {
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
    if (!res.ok) return { success: false };
    const data = await res.json();
    const entry = data[0];
    return {
      success: true,
      phonetic: entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '',
      meanings: entry.meanings?.map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: m.definitions?.slice(0, 4).map(d => ({ definition: d.definition, example: d.example || '' })),
        synonyms: m.synonyms?.slice(0, 8) || [],
        antonyms: m.antonyms?.slice(0, 6) || [],
      })),
    };
  } catch {
    return { success: false };
  }
});

ipcMain.handle('get-word-meanings', async (_, word, tl) => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl || 'zh-CN'}&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) return { success: false };
    const d = await res.json();
    const meanings = (d[1] || []).map(entry => ({
      pos: entry[0],
      translations: (entry[2] || []).slice(0, 6).map(t => t[0]),
    })).filter(m => m.translations.length > 0);
    return { success: true, meanings };
  } catch {
    return { success: false };
  }
});

ipcMain.handle('export-book', async (_, bookId) => {
  const data = loadData();
  const book = data.books[bookId];
  if (!book) return { success: false };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${book.name}.json`,
    filters: [
      { name: 'JSON', extensions: ['json'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'Anki 导入格式 (TSV)', extensions: ['txt'] },
    ],
  });
  if (!filePath) return { success: false };
  if (filePath.endsWith('.csv')) {
    const csv = ['word,translation,reviewCount,interval']
      .concat(Object.values(book.words).map(w =>
        `"${w.word}","${(w.translation || '').replace(/"/g, '""')}",${w.reviewCount || 0},${w.interval || 1}`
      )).join('\n');
    fs.writeFileSync(filePath, csv, 'utf-8');
  } else if (filePath.endsWith('.txt')) {
    const tsv = Object.values(book.words)
      .map(w => `${w.word}\t${(w.translation || '').replace(/\t/g, ' ')}`)
      .join('\n');
    fs.writeFileSync(filePath, tsv, 'utf-8');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(book, null, 2), 'utf-8');
  }
  return { success: true };
});

ipcMain.handle('import-words', async (_, targetBookId) => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Files', extensions: ['json', 'csv', 'txt'] }],
    properties: ['openFile'],
  });
  if (!filePaths?.length) return { success: false };
  const content = fs.readFileSync(filePaths[0], 'utf-8');
  const data = loadData();
  let imported = {};
  if (filePaths[0].endsWith('.json')) {
    const parsed = JSON.parse(content);
    imported = parsed.words || parsed;
  } else {
    const lines = content.split('\n').filter(l => l.trim());
    const isCSV = filePaths[0].endsWith('.csv');
    const start = (isCSV && lines[0]?.startsWith('word,')) ? 1 : 0;
    for (const line of lines.slice(start)) {
      if (isCSV) {
        const parts = line.split(',').map(s => s.replace(/^"|"$/g, '').trim());
        const [word, translation] = parts;
        if (word) imported[word.toLowerCase()] = { word, translation: translation || '', timestamp: Date.now(), reviewCount: 0 };
      } else {
        const w = line.trim();
        if (w) imported[w.toLowerCase()] = { word: w, translation: '', timestamp: Date.now(), reviewCount: 0 };
      }
    }
  }
  if (data.books[targetBookId]) Object.assign(data.books[targetBookId].words, imported);
  saveData(data);
  return { success: true, count: Object.keys(imported).length };
});

// 统计更新（学习 streak）
ipcMain.handle('update-stats', (_, count) => {
  const data = loadData();
  const today = new Date().toISOString().slice(0, 10);
  const stats = data.stats || { ...DEFAULT_STATS };
  const last = stats.lastStudyDate;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  stats.totalReviewed = (stats.totalReviewed || 0) + count;
  if (last === today) {
    stats.todayReviewed = (stats.todayReviewed || 0) + count;
  } else if (last === yesterday) {
    stats.streak = (stats.streak || 0) + 1;
    stats.todayReviewed = count;
    stats.lastStudyDate = today;
  } else {
    stats.streak = 1;
    stats.todayReviewed = count;
    stats.lastStudyDate = today;
  }
  data.stats = stats;
  saveData(data);
  return stats;
});

// OCR
ipcMain.handle('capture-region-ocr', async (_, x, y, w, h) => {
  // 获取 DPI 缩放比例（CSS 逻辑像素 → 物理像素）
  const winPos = screenshotWindow?.getPosition() || [0, 0];
  const display = screen.getDisplayNearestPoint({ x: winPos[0], y: winPos[1] });
  const scale = display.scaleFactor || 1;
  const px = Math.round(x * scale);
  const py = Math.round(y * scale);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);

  // 先隐藏窗口，等待完全消失后再截图
  if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.hide();
  await new Promise(r => setTimeout(r, 350));
  try {
    const text = await captureAndOcr(px, py, pw, ph);
    console.log('[OCR] result:', JSON.stringify(text));
    if (text?.trim()) showOverlay(text.trim());
    return { success: true, text: text || '' };
  } catch (e) {
    console.error('[OCR error]', e.message);
    return { success: false, error: e.message };
  } finally {
    if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.close();
  }
});

ipcMain.handle('cancel-screenshot', () => {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.close();
});

ipcMain.handle('ocr-result', (_, text) => {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) screenshotWindow.close();
  if (text?.trim()) showOverlay(text.trim());
});

ipcMain.handle('start-ocr-shortcut', () => {
  createScreenshotWindow();
});

ipcMain.handle('get-login-item', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-login-item', (_, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
  return true;
});

ipcMain.handle('get-recent-lookups', () => recentLookups);
ipcMain.handle('add-recent-lookup', (_, item) => {
  recentLookups = [item, ...recentLookups.filter(x => x.text !== item.text)].slice(0, 5);
  return true;
});

// ── 本地 HTTP API（供浏览器插件共享生词本）────────────────────────
function startApiServer() {
  const http = require('http');
  const PORT = 27149;

  function normalizeWord(raw) {
    const word = String(raw?.word || '').trim();
    if (!word) return null;
    const key = String(raw.key || word).trim().toLowerCase();
    return {
      key,
      value: {
        ...raw,
        word,
        translation: raw.translation || '',
        timestamp: raw.timestamp || Date.now(),
        reviewCount: raw.reviewCount || 0,
      },
    };
  }

  function normalizeWords(rawWords) {
    const words = {};
    const entries = Array.isArray(rawWords)
      ? rawWords.map(w => [w.key || w.word, w])
      : Object.entries(rawWords || {});
    for (const [key, raw] of entries) {
      const normalized = normalizeWord({ ...raw, key });
      if (normalized) words[normalized.key] = normalized.value;
    }
    return words;
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  function mergeBookWords(existing, incoming, strategy) {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const [key, word] of Object.entries(incoming)) {
      if (!existing[key]) {
        existing[key] = word;
        added += 1;
      } else if (strategy === 'overwrite') {
        existing[key] = { ...existing[key], ...word, timestamp: existing[key].timestamp || word.timestamp || Date.now() };
        updated += 1;
      } else {
        skipped += 1;
        if (strategy === 'merge') {
          existing[key] = {
            ...existing[key],
            translation: existing[key].translation || word.translation || '',
            timestamp: existing[key].timestamp || word.timestamp || Date.now(),
          };
        }
      }
    }
    return { added, updated, skipped };
  }

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;

    // GET /health
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        version: '1.0.9',
        endpoints: ['/health', '/words', '/books'],
        sync: apiServerStatus,
      });
      return;
    }

    // GET /books — 返回完整词书结构，供网页端读取/比对
    if (req.method === 'GET' && pathname === '/books') {
      const data = loadData();
      sendJson(res, 200, {
        ok: true,
        activeBookId: data.activeBookId,
        saveBookId: data.saveBookId,
        books: data.books || {},
      });
      return;
    }

    // POST /books — 接收网页端共享来的一个或多个词书
    if (req.method === 'POST' && pathname === '/books') {
      readJsonBody(req).then(payload => {
        const data = loadData();
        const settings = loadSettings();
        const strategy = url.searchParams.get('strategy') || payload.strategy || settings.syncConflictStrategy || 'merge';
        const incoming = Array.isArray(payload) ? payload : (payload.books ? Object.entries(payload.books).map(([id, b]) => ({ id, ...b })) : [payload]);
        const imported = [];

        for (const book of incoming) {
          const name = String(book.name || book.title || '网页端词书').trim();
          const baseId = String(book.id || book.bookId || `web_${Date.now()}`).replace(/[^\w-]/g, '_');
          let id = baseId || `web_${Date.now()}`;
          if (!data.books[id]) data.books[id] = { name, words: {} };
          else data.books[id] = { ...data.books[id], name: data.books[id].name || name };

          const words = normalizeWords(book.words || book.items || {});
          const result = mergeBookWords(data.books[id].words, words, strategy);
          imported.push({ id, name: data.books[id].name, count: Object.keys(words).length, ...result });
        }

        if (!data.saveBookId) data.saveBookId = data.activeBookId || imported[0]?.id || 'default';
        if (!data.activeBookId && imported[0]?.id) data.activeBookId = imported[0].id;
        saveData(data);
        apiServerStatus.lastSyncAt = Date.now();
        apiServerStatus.lastSyncSummary = `网页端同步 ${imported.length} 本词书，策略：${strategy}`;
        mainWindow?.webContents.send('words-updated');
        sendJson(res, 200, { ok: true, strategy, imported });
      }).catch(e => sendJson(res, 400, { ok: false, error: e.message }));
      return;
    }

    // DELETE /books/:id — 删除指定词书（至少保留一本）
    if (req.method === 'DELETE' && pathname.startsWith('/books/')) {
      const id = decodeURIComponent(pathname.slice('/books/'.length));
      const data = loadData();
      if (data.books?.[id] && Object.keys(data.books).length > 1) {
        delete data.books[id];
        const firstId = Object.keys(data.books)[0];
        if (data.activeBookId === id) data.activeBookId = firstId;
        if (data.saveBookId === id) data.saveBookId = firstId;
        data.flashPool = (data.flashPool || []).filter(w => w.bookId !== id);
        saveData(data);
        mainWindow?.webContents.send('words-updated');
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // GET /words
    if (req.method === 'GET' && pathname === '/words') {
      const data = loadData();
      const bookId = url.searchParams.get('bookId') || data.saveBookId || data.activeBookId;
      const words = data.books[bookId]?.words || {};
      sendJson(res, 200, words);
      return;
    }

    // POST /words — 单个对象或数组，仅新增（不覆盖已有词条）
    if (req.method === 'POST' && pathname === '/words') {
      readJsonBody(req).then(payload => {
        try {
          const data = loadData();
          const settings = loadSettings();
          const strategy = url.searchParams.get('strategy') || payload.strategy || settings.syncConflictStrategy || 'merge';
          const bookId = url.searchParams.get('bookId') || data.saveBookId || data.activeBookId;
          const words = data.books[bookId]?.words;
          if (!words) { sendJson(res, 404, { ok: false, error: 'book not found' }); return; }
          const items = Array.isArray(payload) ? payload : [payload];
          const incoming = {};
          for (const w of items) {
            const normalized = normalizeWord(w);
            if (normalized) incoming[normalized.key] = normalized.value;
          }
          const result = mergeBookWords(words, incoming, strategy);
          saveData(data);
          apiServerStatus.lastSyncAt = Date.now();
          apiServerStatus.lastSyncSummary = `网页端同步 ${Object.keys(incoming).length} 个词，策略：${strategy}`;
          mainWindow?.webContents.send('words-updated');
          sendJson(res, 200, { ok: true, strategy, ...result });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      }).catch(e => sendJson(res, 400, { ok: false, error: e.message }));
      return;
    }

    // DELETE /words/:key
    if (req.method === 'DELETE' && pathname.startsWith('/words/')) {
      const key = decodeURIComponent(pathname.slice('/words/'.length)).toLowerCase();
      const data = loadData();
      const bookId = url.searchParams.get('bookId') || data.saveBookId || data.activeBookId;
      if (data.books[bookId]?.words[key]) {
        delete data.books[bookId].words[key];
        saveData(data);
        mainWindow?.webContents.send('words-updated');
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    apiServerStatus = { running: true, port: PORT, error: '' };
    console.log(`[Voca] API server → http://127.0.0.1:${PORT}`);
  });
  server.on('error', e => {
    apiServerStatus = { running: false, port: PORT, error: e.message };
    console.warn('[Voca] API server error:', e.message);
  });
}

// ── App 生命周期 ──────────────────────────────────────────────────
app.whenReady().then(() => {
  DATA_FILE = path.join(app.getPath('userData'), 'voca-words.json');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'voca-settings.json');
  createMainWindow();
  createOverlayWindow();
  createIconWindow();
  createTray();
  startDoubleCtrlCDetection();
  startApiServer();

  // 复习提醒：启动后 30 秒检查一次，之后每 30 分钟
  setTimeout(checkDueAndNotify, 30000);
  setInterval(checkDueAndNotify, 30 * 60 * 1000);
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  try { require('uiohook-napi').uIOhook.stop(); } catch {}
  globalShortcut.unregisterAll();
});
app.on('activate', () => mainWindow?.show());
