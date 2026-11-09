const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voca-review-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'words.json');
  const word = { bookId: 'default', key: 'test', word: 'test', translation: '测试' };
  const initial = { flashPool: [word], activeBookId: 'default', saveBookId: 'default', books: { default: { name: 'Test', words: { test: word } } }, stats: {} };
  fs.writeFileSync(file, JSON.stringify(initial));
  const handlers = new Map();
  let fail = false;
  const wrappedFs = { ...fs, renameSync(src, dest) { if (fail) throw new Error('disk blocked'); fs.renameSync(src, dest); } };
  const main = path.join(__dirname, '../src/main/index.js');
  const realRequire = createRequire(main);
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return { app: { whenReady: () => ({ then() {} }), on() {} }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
      if (name === 'fs') return wrappedFs;
      return realRequire(name);
    },
    process, console, __dirname: path.dirname(main), setInterval() {}, setTimeout() {}, clearTimeout() {}, file,
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context);
  vm.runInContext('DATA_FILE = file', context);
  return { invoke: (name, ...args) => handlers.get(name)(null, ...args), read: () => JSON.parse(fs.readFileSync(file, 'utf8')), fail(value) { fail = value; }, file };
}

test('real IPC saves card, log and statistics atomically and retries once', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  f.invoke('preview-review', { bookId: 'default', key: 'test' });
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  const request = { id: 'durable-review-event', key: 'test', bookId: 'default', rating: 1, expectedLastReview: 0 };
  f.fail(true);
  assert.throws(() => f.invoke('review-card', request), /disk blocked/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  f.fail(false);
  f.invoke('review-card', request);
  const first = f.read();
  assert.equal(first.reviewLogs.length, 1);
  assert.equal(first.stats.todayReviewed, 1);
  assert.equal(first.flashPool[0].fsrs.state, 1);
  assert.deepEqual(first.flashPool[0].fsrs, first.books.default.words.test.fsrs);
  f.invoke('review-card', request);
  assert.deepEqual(f.read(), first);
});

test('review options save independently without rescheduling cards', t => {
  const f = fixture(t);
  const original = f.read().flashPool;
  f.invoke('save-review-options', { newPerDay: 5, retention: .95, relearnMinutes: 15, batchSize: 50 });
  assert.deepEqual(f.read().flashPool, original);
  assert.equal(f.read().reviewOptions.retention, .95);
  assert.equal(f.read().reviewOptions.batchSize, 50);
  assert.throws(() => f.invoke('save-review-options', { retention: 2 }), /保持率/);
  assert.equal(f.read().reviewOptions.retention, .95);
});

test('overlay adds sentences to the target book and pool once, preserving review state', t => {
  const f = fixture(t);
  const req = { text: 'She is walking with purpose', translation: '她目标明确地走着。', action: 'add-to-pool' };
  f.invoke('overlay-item', req);
  f.invoke('overlay-item', req);
  const data = f.read();
  assert.equal(data.flashPool.filter(w => w.key === req.text.toLowerCase()).length, 1);
  assert.equal(data.books.default.words[req.text.toLowerCase()].translation, req.translation);
  const prior = data.flashPool.find(w => w.key === 'test');
  f.invoke('overlay-item', { text: 'test', translation: 'different', action: 'add-to-pool' });
  assert.deepEqual(f.read().flashPool.find(w => w.key === 'test'), prior);
  f.invoke('overlay-item', { ...req, action: 'unsave' });
  assert.equal(f.read().flashPool.some(w => w.key === req.text.toLowerCase()), false);
});
test('overlay status is read-only and failed saves do not report success', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  const status = f.invoke('overlay-item', { text: 'test', action: 'status' });
  assert.equal(status.inPool, true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  f.fail(true);
  assert.throws(() => f.invoke('overlay-item', { text: 'new', translation: '新', action: 'add-to-pool' }), /disk blocked/);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});
