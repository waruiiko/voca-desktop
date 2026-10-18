const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real IPC handlers without starting Electron windows, global hooks,
// the API server, or touching the user's settings file.
function fixture(initialSettings, options = {}) {
  const handlers = new Map();
  const files = new Map();
  const calls = { enabled: [], hides: 0, overlays: [], writes: [], fetches: [] };
  let writeError = null;
  if (initialSettings !== undefined) files.set('settings.json', JSON.stringify(initialSettings));
  const fakeFs = {
    existsSync: file => files.has(file),
    readFileSync: file => files.get(file),
    writeFileSync(file, text) {
      if (writeError) throw writeError;
      files.set(file, text);
      calls.writes.push(file);
    },
  };
  const electron = {
    app: { whenReady: () => ({ then() {} }), on() {} },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'fs') return fakeFs;
      if (name === './selection-reader') return { createSelectionReader() {} };
      if (name === './selection-translation') return { createSelectionTranslationController() {} };
      return require(name);
    },
    __dirname: path.join(__dirname, '../src/main'),
    process,
    console,
    async fetch(url, config) {
      calls.fetches.push({ url, config });
      if (!options.fetch) throw new Error('unexpected network request in settings test');
      return options.fetch(url, config);
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    testController: { setEnabled: value => calls.enabled.push(value) },
    testIconWindow: { isDestroyed: () => false, hide: () => { calls.hides++; } },
    testShowOverlay: text => calls.overlays.push(text),
  });
  vm.runInContext(source, context, { filename: 'src/main/index.js' });
  vm.runInContext("SETTINGS_FILE = 'settings.json'; selectionController = testController; iconWindow = testIconWindow; showOverlay = testShowOverlay;", context);
  const invoke = (channel, ...args) => handlers.get(channel)(null, ...args);
  const plain = value => JSON.parse(JSON.stringify(value));
  return {
    calls,
    context,
    invoke,
    load: () => plain(invoke('load-settings')),
    persisted: () => JSON.parse(files.get('settings.json')),
    failWrites: error => { writeError = error; },
  };
}

test('existing settings gain the selection toggle default without losing API credentials', () => {
  const f = fixture({ translateApi: 'deepl', deeplKey: 'existing-key', targetLang: 'ja' });
  const settings = f.load();
  assert.equal(settings.translateApi, 'deepl');
  assert.equal(settings.deeplKey, 'existing-key');
  assert.equal(settings.targetLang, 'ja');
  assert.equal(settings.selectionTranslationEnabled, true);
  assert.equal(settings.dailyGoal, 10);
  assert.deepEqual(f.calls.writes, []);
});

test('saving a provider and toggle persists across a new main-process session', () => {
  const f = fixture();
  assert.equal(f.invoke('save-settings', { translateApi: 'mymemory', selectionTranslationEnabled: false }), true);
  const nextSession = fixture(f.persisted());
  assert.equal(nextSession.load().translateApi, 'mymemory');
  assert.equal(nextSession.load().selectionTranslationEnabled, false);
  assert.equal(nextSession.load().targetLang, 'zh-CN');
  assert.deepEqual(f.calls.enabled, [false]);
  assert.equal(f.calls.hides, 1);
});

test('partial settings saves preserve stored options and unknown settings', () => {
  const f = fixture({
    translateApi: 'deepl',
    deeplKey: 'retained-key',
    selectionTranslationEnabled: false,
    customFutureOption: 'keep-me',
  });
  f.invoke('save-settings', { translateApi: 'google' });
  const saved = f.persisted();
  assert.equal(saved.translateApi, 'google');
  assert.equal(saved.deeplKey, 'retained-key');
  assert.equal(saved.selectionTranslationEnabled, false);
  assert.equal(saved.customFutureOption, 'keep-me');
  assert.equal(saved.dailyGoal, 10);
});

test('a failed settings write leaves the running selection mode unchanged and propagates the error', () => {
  const f = fixture({ translateApi: 'google', selectionTranslationEnabled: true });
  f.failWrites(new Error('disk is read-only'));
  assert.throws(() => f.invoke('save-settings', { translateApi: 'mymemory', selectionTranslationEnabled: false }), /disk is read-only/);
  assert.equal(f.persisted().translateApi, 'google');
  assert.equal(f.persisted().selectionTranslationEnabled, true);
  assert.deepEqual(f.calls.enabled, []);
  assert.equal(f.calls.hides, 0);
  assert.equal(vm.runInContext('selectionTranslationEnabled', f.context), true);
});

test('saving selection mode applies immediately and blocks stale icon clicks after disabling', () => {
  const f = fixture();
  vm.runInContext("pendingText = 'old selected word'", f.context);
  f.invoke('save-settings', { selectionTranslationEnabled: false });
  f.invoke('icon-clicked');
  assert.deepEqual(f.calls.overlays, []);
  assert.equal(vm.runInContext('pendingText', f.context), '');
  f.invoke('save-settings', { selectionTranslationEnabled: true });
  vm.runInContext("pendingText = 'new selected word'", f.context);
  f.invoke('icon-clicked');
  assert.deepEqual(f.calls.overlays, ['new selected word']);
  assert.deepEqual(f.calls.enabled, [false, true]);
});

test('DeepL without a saved key reports the configuration error without contacting any provider', async t => {
  for (const [name, deeplKey] of [['missing', undefined], ['empty', ''], ['whitespace', '  \t\n  ']]) {
    await t.test(name, async () => {
      const f = fixture({ translateApi: 'deepl', deeplKey });
      const result = await f.invoke('translate', 'hello');
      assert.equal(result.success, false);
      assert.equal(result.error, '请在设置中填写 DeepL API Key 并保存');
      assert.deepEqual(f.calls.fetches, []);
    });
  }
});

test('translation uses the newly saved DeepL provider and a trimmed API key', async () => {
  const f = fixture({ translateApi: 'google' }, {
    fetch: async () => ({ ok: true, json: async () => ({ translations: [{ text: 'Hallo' }] }) }),
  });
  f.invoke('save-settings', { translateApi: 'deepl', deeplKey: '  saved-key  ', sourceLang: 'en', targetLang: 'de' });
  const result = await f.invoke('translate', 'hello');
  assert.equal(result.success, true);
  assert.equal(result.text, 'Hallo');
  assert.equal(f.calls.fetches.length, 1);
  const request = f.calls.fetches[0];
  assert.equal(request.url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(request.config.method, 'POST');
  assert.equal(request.config.headers.Authorization, 'DeepL-Auth-Key saved-key');
  assert.deepEqual(JSON.parse(request.config.body), { text: ['hello'], source_lang: 'EN', target_lang: 'DE' });
});
