const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu, nativeImage, screen, dialog, Notification } = require('electron');
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

// ── 默认设置 ──────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  translateApi: 'google',
  deeplKey: '',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  ttsVoice: '',
  dailyGoal: 10,
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
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  try { fs.copyFileSync(DATA_FILE, DATA_FILE + '.bak'); } catch {}
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
    alwaysOnTop: true, skipTaskbar: true, resizable: false,
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
    width: 44, height: 44, show: false,
    frame: false, transparent: false, backgroundColor: '#6366f1',
    alwaysOnTop: true, skipTaskbar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  iconWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isDev) iconWindow.loadURL(`${RENDERER_URL}/#/icon`);
  else iconWindow.loadFile(path.join(app.getAppPath(), 'src/renderer/dist/index.html'), { hash: 'icon' });
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
  const x = Math.max(wa.x, Math.min(point.x + 16, wa.x + wa.width - 44));
  const y = Math.max(wa.y, Math.min(point.y + 16, wa.y + wa.height - 44));
  iconWindow.setPosition(Math.round(x), Math.round(y));
  iconWindow.showInactive();
  if (iconHideTimer) clearTimeout(iconHideTimer);
  iconHideTimer = setTimeout(() => iconWindow?.hide(), 4000);
}

function hideIcon() {
  if (iconHideTimer) { clearTimeout(iconHideTimer); iconHideTimer = null; }
  iconWindow?.hide();
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
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Voca');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Voca', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.quit(); } },
  ]));
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── IPC ───────────────────────────────────────────────────────────
ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => { saveSettings(s); return true; });

ipcMain.handle('load-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });

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
  const newH = Math.min(h, wa.height - 20);
  const newY = Math.min(cy, wa.y + wa.height - newH);
  overlayWindow.setSize(Math.round(w), Math.round(newH));
  overlayWindow.setPosition(cx, Math.round(newY));
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
      meanings: entry.meanings?.slice(0, 2).map(m => ({
        partOfSpeech: m.partOfSpeech,
        definitions: m.definitions?.slice(0, 2).map(d => ({ definition: d.definition, example: d.example || '' })),
        synonyms: m.synonyms?.slice(0, 6) || [],
        antonyms: m.antonyms?.slice(0, 4) || [],
      })),
    };
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

ipcMain.handle('get-recent-lookups', () => recentLookups);
ipcMain.handle('add-recent-lookup', (_, item) => {
  recentLookups = [item, ...recentLookups.filter(x => x.text !== item.text)].slice(0, 5);
  return true;
});

// ── App 生命周期 ──────────────────────────────────────────────────
app.whenReady().then(() => {
  DATA_FILE = path.join(app.getPath('userData'), 'voca-words.json');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'voca-settings.json');
  createMainWindow();
  createOverlayWindow();
  createIconWindow();
  createTray();
  startDoubleCtrlCDetection();

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
