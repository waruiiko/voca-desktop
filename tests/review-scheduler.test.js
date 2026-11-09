const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY, previewReview, applyReview, reviewOptions, localDay, toCard, availableReviewCount } = require('../src/main/review-scheduler');
const NOW = +new Date(2026, 10, 9, 18, 30);
function fixture(word = {}) {
  const card = { word: 'example', translation: '例子', key: 'example', bookId: 'default', ...word };
  return { flashPool: [card], books: { default: { words: { example: { ...card } } } }, stats: {} };
}
const request = (data, rating, id = 'review-event-0001', extra = {}) => ({ id, rating, key: 'example', bookId: 'default', expectedLastReview: data.flashPool[0].lastReview || 0, ...extra });

test('four failures followed by recall never jumps to the old 30-day staircase', () => {
  let data = fixture();
  let now = NOW;
  for (let i = 0; i < 4; i++) {
    data = applyReview(data, request(data, 1, `failure-event-${i}`), now).data;
    assert.equal(data.flashPool[0].nextReview - now, 10 * 60000);
    assert.equal(data.flashPool[0].fsrs.state, 1);
    now = data.flashPool[0].nextReview;
  }
  data = applyReview(data, request(data, 3), now).data;
  assert.ok(data.flashPool[0].interval < 30);
  assert.equal(data.reviewLogs.length, 5);
  assert.equal(data.stats.totalReviewed, 5);
  assert.equal(data.flashPool[0].fsrs.state, 2);
});

test('legacy progress only seeds memory estimates and does not reschedule untouched cards', () => {
  const data = fixture({ reviewCount: 4, interval: 1, nextReview: NOW, lastReview: NOW - DAY });
  const snapshot = structuredClone(data);
  const preview = previewReview(data.flashPool[0], undefined, NOW);
  assert.deepEqual(data, snapshot);
  assert.equal(preview.legacyEstimate, true);
  assert.ok(preview.choices[3].intervalMs < 30 * DAY);
  const result = applyReview(data, request(data, 3), NOW);
  assert.equal(result.log.legacyEstimate, true);
  assert.equal(result.word.reviewCount, 5);
  assert.deepEqual(result.data.books.default.words.example.fsrs, result.word.fsrs);
  assert.equal(result.log.elapsedDays, 1);
  assert.equal(result.log.before.state, 1);
  assert.ok(result.log.after.stability > 0);
});

test('preview and commit use the same scheduler and persist complete serializable records', () => {
  for (const rating of [1, 2, 3, 4]) {
    const data = fixture();
    const preview = previewReview(data.flashPool[0], undefined, NOW);
    const result = applyReview(data, request(data, rating), NOW);
    assert.equal(result.word.nextReview, preview.choices[rating].due);
    assert.deepEqual(result.word.fsrs, preview.choices[rating].card);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    assert.equal(+toCard(result.word, NOW).due, result.word.nextReview);
  }
});

test('all ratings have ordered intervals for new, learning, and mature cards', () => {
  const mature = fixture({ interval: 30, reviewCount: 20, lastReview: NOW - 30 * DAY, nextReview: NOW }).flashPool[0];
  for (const word of [{}, { ...mature, interval: 1 }, mature]) {
    const choices = previewReview(word, { relearnMinutes: 20 }, NOW).choices;
    assert.equal(choices[1].intervalMs, 20 * 60000);
    for (const r of [1, 2, 3]) assert.ok(choices[r].intervalMs <= choices[r + 1].intervalMs);
  }
});

test('retries are idempotent and conflicting requests cannot reuse an event id', () => {
  const data = fixture();
  const req = request(data, 3);
  const first = applyReview(data, req, NOW);
  const retry = applyReview(first.data, req, NOW + 5000);
  assert.deepEqual(retry.data, first.data);
  assert.equal(retry.duplicate, true);
  assert.throws(() => applyReview(first.data, { ...req, rating: 4 }, NOW), /重复请求/);
});

test('practice records the answer without mutating the schedule or review statistics', () => {
  const data = fixture({ reviewCount: 8, interval: 30, nextReview: NOW + DAY, lastReview: NOW - DAY, mastered: true });
  const result = applyReview(data, request(data, 1, undefined, { practice: true }), NOW);
  assert.deepEqual(result.data.flashPool, data.flashPool);
  assert.deepEqual(result.data.books, data.books);
  assert.deepEqual(result.data.stats, data.stats);
  assert.equal(result.log.mode, 'practice');
  assert.equal(result.log.scheduler, undefined);
});

test('future, removed, stale and malformed cards cannot be scheduled', () => {
  const future = fixture({ nextReview: NOW + DAY });
  assert.throws(() => applyReview(future, request(future, 3), NOW), /尚未到期/);
  const missing = fixture(); delete missing.books.default.words.example;
  assert.throws(() => applyReview(missing, request(missing, 3), NOW), /移动或删除/);
  const stale = fixture({ lastReview: NOW - DAY });
  assert.throws(() => applyReview(stale, { ...request(stale, 3), expectedLastReview: 0 }, NOW), /已更新/);
  assert.throws(() => applyReview(fixture(), { id: 'x', rating: 99 }, NOW), /无效/);
});

test('new word limits are enforced per local day and do not count practice', () => {
  const data = fixture();
  data.reviewOptions = { newPerDay: 1 };
  data.reviewLogs = [{ mode: 'review', wasNew: true, at: NOW - 60000 }];
  assert.equal(availableReviewCount(data, NOW), 0);
  assert.throws(() => applyReview(data, request(data, 3), NOW), /新词/);
  data.reviewLogs[0].mode = 'practice';
  assert.equal(applyReview(data, request(data, 3), NOW).word.reviewCount, 1);
  data.reviewOptions.newPerDay = 0;
  assert.throws(() => applyReview(data, request(data, 3), NOW), /新词/);
});

test('statistics update on each answer using local calendar boundaries', () => {
  const data = fixture();
  const yesterday = new Date(NOW); yesterday.setDate(yesterday.getDate() - 1);
  data.stats = { streak: 4, lastStudyDate: localDay(+yesterday), todayReviewed: 7, totalReviewed: 100 };
  const result = applyReview(data, request(data, 3), NOW);
  assert.deepEqual(result.data.stats, { streak: 5, lastStudyDate: localDay(NOW), todayReviewed: 1, totalReviewed: 101 });
});

test('higher retention shortens mature intervals and options reject invalid ranges', () => {
  const word = fixture({ interval: 30, reviewCount: 8, lastReview: NOW - 30 * DAY }).flashPool[0];
  assert.ok(previewReview(word, { retention: .95 }, NOW).choices[3].intervalMs < previewReview(word, { retention: .8 }, NOW).choices[3].intervalMs);
  assert.equal(reviewOptions({ retention: .9 }).batchSize, 20);
  assert.equal(reviewOptions({ batchSize: -1 }).batchSize, -1);
  for (const options of [{ retention: 1 }, { newPerDay: -1 }, { newPerDay: 1.5 }, { relearnMinutes: 0 }, { batchSize: 0 }]) assert.throws(() => reviewOptions(options));
});
