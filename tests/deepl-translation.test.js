const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real translation IPC handler without starting Electron, reading
// user settings, or making network requests. No extra test dependencies needed.
function fixture(settings, response) {
  const handlers = new Map();
  const requests = [];
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return {
        app: { whenReady: () => ({ then() {} }), on() {} },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      };
      if (name === 'fs') return {
        existsSync: filename => filename === 'settings.json',
        readFileSync: filename => {
          assert.equal(filename, 'settings.json');
          return JSON.stringify({ translateApi: 'deepl', deeplKey: 'test-key', ...settings });
        },
      };
      return require(name);
    },
    __dirname: path.join(__dirname, '../src/main'),
    process,
    console,
    async fetch(url, config) {
      requests.push({ url, config });
      return response || { ok: true, json: async () => ({ translations: [{ text: 'translated' }] }) };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'src/main/index.js' });
  vm.runInContext("SETTINGS_FILE = 'settings.json';", context);
  return {
    requests,
    translate: (...args) => handlers.get('translate')(null, ...args),
  };
}

test('DeepL uses supported language codes in translation requests', async t => {
  const cases = [
    ['auto', 'zh-CN', { target_lang: 'ZH-HANS' }],
    ['auto', 'zh-TW', { target_lang: 'ZH-HANT' }],
    ['zh-CN', 'en', { source_lang: 'ZH', target_lang: 'EN' }],
    ['zh-TW', 'en-US', { source_lang: 'ZH', target_lang: 'EN-US' }],
    ['en', 'pt-BR', { source_lang: 'EN', target_lang: 'PT-BR' }],
    ['en', 'de', { source_lang: 'EN', target_lang: 'DE' }],
  ];
  for (const [sourceLang, targetLang, expected] of cases) {
    await t.test(`${sourceLang} to ${targetLang}`, async () => {
      const f = fixture({ sourceLang, targetLang });
      const result = await f.translate('hello');
      assert.equal(result.success, true);
      assert.equal(result.text, 'translated');
      assert.equal(f.requests.length, 1);
      assert.equal(f.requests[0].url, 'https://api-free.deepl.com/v2/translate');
      assert.deepEqual(JSON.parse(f.requests[0].config.body), { text: ['hello'], ...expected });
    });
  }
});

test('DeepL also maps the per-request language selected in the overlay', async () => {
  const f = fixture({ sourceLang: 'auto', targetLang: 'zh-CN' });
  const result = await f.translate('hello', 'en', 'zh-TW');
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(f.requests[0].config.body), {
    text: ['hello'], source_lang: 'EN', target_lang: 'ZH-HANT',
  });
});

test('DeepL errors include the service explanation and redact the API key', async () => {
  const f = fixture({ deeplKey: 'secret-test-key' }, {
    ok: false,
    status: 400,
    json: async () => ({ message: 'Value for target_lang not supported (secret-test-key)' }),
  });
  const result = await f.translate('hello');
  assert.equal(result.success, false);
  assert.match(result.error, /DeepL HTTP 400/);
  assert.match(result.error, /Value for target_lang not supported/);
  assert.ok(!result.error.includes('secret-test-key'));
  assert.equal(f.requests.length, 1);
});

test('DeepL preserves the HTTP status if the error response is not JSON', async () => {
  const f = fixture({}, {
    ok: false, status: 503, json: async () => { throw new SyntaxError('not JSON'); },
  });
  const result = await f.translate('hello');
  assert.equal(result.success, false);
  assert.equal(result.error, 'DeepL HTTP 503');
});
