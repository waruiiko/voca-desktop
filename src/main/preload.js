const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vocaAPI', {
  // 设置
  loadSettings:       ()           => ipcRenderer.invoke('load-settings'),
  saveSettings:       (s)          => ipcRenderer.invoke('save-settings', s),
  // 完整数据（多生词本）
  loadData:           ()           => ipcRenderer.invoke('load-data'),
  saveData:           (d)          => ipcRenderer.invoke('save-data', d),
  // 当前生词本快捷读写（向后兼容）
  loadWords:          ()           => ipcRenderer.invoke('load-words'),
  saveWords:          (words)      => ipcRenderer.invoke('save-words', words),
  // 翻译（sl/tl 可选，不传则用设置里的默认值）
  translate:          (text, sl, tl) => ipcRenderer.invoke('translate', text, sl, tl),
  // 单词详情（Free Dictionary API）
  getWordDetail:      (word)       => ipcRenderer.invoke('get-word-detail', word),
  // 多义词翻译（Google Translate dt=bd）
  getWordMeanings:    (word, tl)   => ipcRenderer.invoke('get-word-meanings', word, tl),
  // 悬浮窗
  hideOverlay:        ()           => ipcRenderer.invoke('hide-overlay'),
  showMain:           ()           => ipcRenderer.invoke('show-main'),
  resizeOverlay:      (w, h)       => ipcRenderer.invoke('resize-overlay', w, h),
  openTranslate:      (text)       => ipcRenderer.invoke('open-translate', text),
  // 图标点击
  iconClicked:        ()           => ipcRenderer.invoke('icon-clicked'),
  // 导入 / 导出
  exportBook:         (bookId)     => ipcRenderer.invoke('export-book', bookId),
  importWords:        (bookId)     => ipcRenderer.invoke('import-words', bookId),
  // 悬浮窗 pin
  toggleOverlayPin:   ()           => ipcRenderer.invoke('toggle-overlay-pin'),
  // 统计
  updateStats:        (count)      => ipcRenderer.invoke('update-stats', count),
  // OCR
  captureRegionOcr:   (x, y, w, h) => ipcRenderer.invoke('capture-region-ocr', x, y, w, h),
  cancelScreenshot:   ()           => ipcRenderer.invoke('cancel-screenshot'),
  ocrResult:          (text)       => ipcRenderer.invoke('ocr-result', text),
  startOcrShortcut:   ()           => ipcRenderer.invoke('start-ocr-shortcut'),
  // 开机自启
  getLoginItem:       ()           => ipcRenderer.invoke('get-login-item'),
  setLoginItem:       (enable)     => ipcRenderer.invoke('set-login-item', enable),
  // 最近查词
  getRecentLookups:   ()           => ipcRenderer.invoke('get-recent-lookups'),
  addRecentLookup:    (item)       => ipcRenderer.invoke('add-recent-lookup', item),
  // 事件
  onTranslate:        (cb) => ipcRenderer.on('translate-text', (_, text) => cb(text)),
  onOpenTranslate:    (cb) => ipcRenderer.on('open-translate', (_, text) => cb(text)),
  notifyWordsUpdated: ()   => ipcRenderer.invoke('notify-words-updated'),
  onWordsUpdated:     (cb) => ipcRenderer.on('words-updated', () => cb()),
  onOcrShortcut:      (cb) => ipcRenderer.on('ocr-shortcut', () => cb()),
});
