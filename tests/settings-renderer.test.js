const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(saveSettings) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/pages/SettingsPage.vue'), 'utf8');
  const saveFunction = source.match(/async function save\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(saveFunction, 'the settings page exposes its save action');
  const backing = { translateApi: 'mymemory', selectionTranslationEnabled: false, deeplKey: 'test-key' };
  // Vue refs wrap object values in Proxy. Electron IPC uses structured cloning,
  // which rejects those proxies; this reproduces that boundary without Vue or Electron.
  const state = {
    settings: { value: new Proxy(backing, {}) },
    saved: { value: false },
    saving: { value: false },
    saveError: { value: '' },
  };
  const snapshots = [];
  const context = vm.createContext({
    ...state,
    setTimeout() { return 1; },
    window: { vocaAPI: { saveSettings(snapshot) {
      snapshots.push(structuredClone(snapshot));
      return saveSettings ? saveSettings(snapshot) : Promise.resolve(true);
    } } },
  });
  vm.runInContext(saveFunction, context);
  return { ...state, snapshots, save: () => vm.runInContext('save()', context) };
}

test('renderer saves a serializable snapshot of reactive settings through the IPC boundary', async () => {
  const f = fixture();
  assert.throws(() => structuredClone(f.settings.value), { name: 'DataCloneError' });
  await f.save();
  assert.deepEqual(f.snapshots, [{ translateApi: 'mymemory', selectionTranslationEnabled: false, deeplKey: 'test-key' }]);
  assert.equal(f.saved.value, true);
  assert.equal(f.saving.value, false);
  assert.equal(f.saveError.value, '');
});

test('the saved confirmation waits for persistence and overlapping saves are suppressed', async () => {
  let resolveWrite;
  const f = fixture(() => new Promise(resolve => { resolveWrite = resolve; }));
  const pending = f.save();
  assert.equal(f.saved.value, false);
  assert.equal(f.saving.value, true);
  await f.save();
  assert.equal(f.snapshots.length, 1);
  resolveWrite(true);
  await pending;
  assert.equal(f.saved.value, true);
  assert.equal(f.saving.value, false);
});

test('rejected disk writes show an actionable error and allow another save', async () => {
  const f = fixture(() => Promise.reject(new Error('access denied')));
  await f.save();
  assert.equal(f.saved.value, false);
  assert.equal(f.saving.value, false);
  assert.match(f.saveError.value, /保存失败.*access denied/);
  await f.save();
  assert.equal(f.snapshots.length, 2);
});

test('an explicit unsuccessful save never shows a saved confirmation', async () => {
  const f = fixture(() => Promise.resolve(false));
  await f.save();
  assert.equal(f.saved.value, false);
  assert.equal(f.saving.value, false);
  assert.match(f.saveError.value, /保存失败/);
});

