const { fsrs, generatorParameters, createEmptyCard, State } = require('ts-fsrs');

const DAY = 86400000;
const DEFAULT_REVIEW_OPTIONS = Object.freeze({ retention: 0.9, newPerDay: 10, relearnMinutes: 10, batchSize: 20 });
const copy = value => JSON.parse(JSON.stringify(value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function reviewOptions(input = {}) {
  const options = { ...DEFAULT_REVIEW_OPTIONS, ...input };
  if (!Number.isFinite(options.retention) || options.retention < 0.8 || options.retention > 0.97) throw new Error('目标保持率应在 80%–97% 之间');
  if (!Number.isInteger(options.newPerDay) || options.newPerDay < 0 || options.newPerDay > 200) throw new Error('每日新词应在 0–200 之间');
  if (!Number.isInteger(options.relearnMinutes) || options.relearnMinutes < 1 || options.relearnMinutes > 60) throw new Error('重学间隔应在 1–60 分钟之间');
  if (![10, 20, 30, 50, 100, -1].includes(options.batchSize)) throw new Error('每轮数量应为 10、20、30、50、100 或全部');
  return options;
}

function localDay(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isNew(word) {
  return !(word.reviewCount > 0 || word.lastReview > 0 || word.fsrs?.reps > 0);
}

function availableReviewCount(data, now = Date.now()) {
  const options = reviewOptions(data.reviewOptions);
  const todayNew = (data.reviewLogs || []).filter(l => l.mode === 'review' && l.wasNew && localDay(l.at) === localDay(now)).length;
  const eligible = (data.flashPool || []).filter(w => !w.mastered && (w.nextReview || 0) <= now);
  return eligible.filter(w => !isNew(w)).length + Math.min(eligible.filter(isNew).length, Math.max(0, options.newPerDay - todayNew));
}

// Legacy cards retain their existing due dates. Their initial memory state is
// only an estimate: the old aggregate counters cannot reconstruct past answers.
function toCard(word, now) {
  if (word.fsrs) {
    const card = { ...word.fsrs, due: new Date(word.fsrs.due) };
    if (card.last_review) card.last_review = new Date(card.last_review);
    if (!Number.isFinite(+card.due) || (card.last_review && !Number.isFinite(+card.last_review))) throw new Error('卡片时间无效，请检查学习数据');
    return card;
  }
  const card = createEmptyCard(new Date(now));
  if (isNew(word)) return card;
  const interval = Math.min(36500, Math.max(1, finite(word.interval, 1)));
  card.due = new Date(finite(word.nextReview, now));
  card.last_review = new Date(Math.min(now, finite(word.lastReview, now - interval * DAY)));
  card.stability = interval;
  card.difficulty = 5;
  card.scheduled_days = interval;
  card.reps = Math.max(1, Math.floor(finite(word.reviewCount, 1)));
  card.state = interval <= 1 ? State.Learning : State.Review;
  return card;
}

function previewReview(word, input, now = Date.now()) {
  const options = reviewOptions(input);
  const step = `${options.relearnMinutes}m`;
  const scheduler = fsrs(generatorParameters({ request_retention: options.retention, enable_fuzz: false, enable_short_term: true, learning_steps: [step], relearning_steps: [step] }));
  const before = toCard(word, now);
  const choices = scheduler.repeat(before, new Date(now));
  const previews = {};
  for (const rating of [1, 2, 3, 4]) {
    const result = choices[rating];
    previews[rating] = { due: +result.card.due, state: result.card.state, intervalMs: +result.card.due - now, card: copy(result.card), log: copy(result.log) };
  }
  return { choices: previews, before: copy(before), legacyEstimate: !word.fsrs && !isNew(word) };
}

function updateReviewStats(stats, now) {
  const today = localDay(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameDay = stats.lastStudyDate === today;
  return {
    ...stats,
    totalReviewed: (stats.totalReviewed || 0) + 1,
    todayReviewed: sameDay ? (stats.todayReviewed || 0) + 1 : 1,
    streak: sameDay ? (stats.streak || 1) : stats.lastStudyDate === localDay(+yesterday) ? (stats.streak || 0) + 1 : 1,
    lastStudyDate: today,
  };
}

// One transaction updates the card, its source book, the durable review log,
// and statistics. No renderer-supplied memory state or timestamps are trusted.
function applyReview(original, request, now = Date.now()) {
  if (!request || ![1, 2, 3, 4].includes(request.rating) || !/^[\w-]{8,100}$/.test(request.id || '')) throw new Error('复习请求无效');
  const data = copy(original);
  const logs = data.reviewLogs || [];
  const duplicate = logs.find(log => log.id === request.id);
  if (duplicate) {
    if (duplicate.bookId !== request.bookId || duplicate.key !== request.key || duplicate.rating !== request.rating || duplicate.mode !== (request.practice ? 'practice' : 'review')) throw new Error('重复请求不一致');
    return { data, duplicate: true };
  }
  const index = (data.flashPool || []).findIndex(w => w.bookId === request.bookId && w.key === request.key);
  const word = data.flashPool?.[index];
  const bookWord = data.books?.[request.bookId]?.words?.[request.key];
  if (!word || !bookWord) throw new Error('卡片已被移动或删除，请重新开始');
  if ((word.lastReview || 0) !== request.expectedLastReview) throw new Error('卡片记录已更新，请重新开始');
  const options = reviewOptions(data.reviewOptions);
  const wasNew = isNew(word);
  if (!request.practice) {
    if (word.mastered || (word.nextReview || 0) > now) throw new Error('这张卡片尚未到期，可使用提前练习');
    const todayNew = logs.filter(log => log.mode === 'review' && log.wasNew && localDay(log.at) === localDay(now)).length;
    if (wasNew && todayNew >= options.newPerDay) throw new Error('今日新词已达到上限');
  }
  let updated = word;
  let entry = { id: request.id, bookId: request.bookId, key: request.key, rating: request.rating, at: now, mode: request.practice ? 'practice' : 'review', wasNew };
  if (!request.practice) {
    const preview = previewReview(word, options, now);
    const result = preview.choices[request.rating];
    updated = { ...word, fsrs: result.card, scheduler: 'fsrs-6', reviewCount: (word.reviewCount || 0) + 1, lastReview: now, nextReview: result.due, interval: result.intervalMs / DAY };
    data.flashPool[index] = updated;
    data.books[request.bookId].words[request.key] = { ...bookWord, ...updated };
    data.stats = updateReviewStats(data.stats || {}, now);
    entry = { ...entry, scheduler: 'fsrs-6', retention: options.retention, legacyEstimate: preview.legacyEstimate, before: preview.before, after: result.card, elapsedDays: word.lastReview ? (now - word.lastReview) / DAY : null, intervalMs: result.intervalMs, fsrsLog: result.log };
  }
  data.reviewLogs = [...logs, entry];
  return { data, word: updated, log: entry };
}

module.exports = { DAY, DEFAULT_REVIEW_OPTIONS, reviewOptions, localDay, isNew, availableReviewCount, toCard, previewReview, updateReviewStats, applyReview };
