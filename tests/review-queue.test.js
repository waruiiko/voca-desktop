const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../src/renderer/composables/review-queue.mjs');
const NOW = +new Date(2026, 10, 9, 15);
const card = (key, fields = {}) => ({ bookId: 'default', key, word: key, ...fields });

test('due cards precede new words with learning cards first and oldest due first', async () => {
  const { buildQueue } = await modulePromise;
  const cards = [card('new'), card('late', { reviewCount: 3, nextReview: NOW - 500 }), card('old', { reviewCount: 3, nextReview: NOW - 1000 }), card('relearn', { reviewCount: 4, nextReview: NOW, fsrs: { state: 3 } })];
  assert.deepEqual(buildQueue(cards, { now: NOW }).map(w => w.key), ['relearn', 'old', 'late', 'new']);
  assert.equal(buildQueue(cards, { now: NOW, limit: 2 })[1].key, 'old');
});
test('empty due queues never fall back to future or suspended cards', async () => {
  const { buildQueue } = await modulePromise;
  const cards = [card('future', { reviewCount: 1, nextReview: NOW + 1000 }), card('paused', { mastered: true }), card('new')];
  assert.deepEqual(buildQueue(cards, { now: NOW, newLimit: 0 }), []);
  assert.equal(buildQueue(cards, { now: NOW, practice: true }).length, 3);
});
test('daily new quota counts initial formal reviews and resets the next day', async () => {
  const { newRemaining } = await modulePromise;
  const logs = [{ mode: 'practice', wasNew: true, at: NOW }, { mode: 'review', wasNew: false, at: NOW }, { mode: 'review', wasNew: true, at: NOW }];
  assert.equal(newRemaining(logs, { newPerDay: 2 }, NOW), 1);
  assert.equal(newRemaining(logs, { newPerDay: 2 }, NOW + 86400000), 2);
});
test('short-term relearning can resume after leaving and queues do not mutate props', async () => {
  const { buildQueue } = await modulePromise;
  const word = card('again', { reviewCount: 1, nextReview: NOW + 600000, fsrs: { state: 1 } });
  assert.deepEqual(buildQueue([word], { now: NOW }), []);
  const result = buildQueue([word, word], { now: NOW + 600000 });
  assert.equal(result.length, 1);
  result[0].fsrs.state = 2;
  assert.equal(word.fsrs.state, 1);
});
