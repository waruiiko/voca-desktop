export const DAY = 86400000;
export const cardId = w => JSON.stringify([w.bookId, w.key]);
export const isNewCard = w => !(w.reviewCount > 0 || w.lastReview > 0 || w.fsrs?.reps > 0);
export const isDue = (w, now) => !w.mastered && !isNewCard(w) && (w.nextReview || 0) <= now;
export function localDay(time) {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function newRemaining(logs, options, now) {
  const count = (logs || []).filter(l => l.mode === 'review' && l.wasNew && localDay(l.at) === localDay(now)).length;
  return Math.max(0, (options?.newPerDay ?? 10) - count);
}
export function buildQueue(words, { now = Date.now(), limit = 20, newLimit = 10, practice = false } = {}) {
  const unique = [...new Map(words.map(w => [cardId(w), w])).values()];
  let pool;
  if (practice) pool = unique.sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
  else {
    const due = unique.filter(w => isDue(w, now)).sort((a, b) => {
      const learning = w => [1, 3].includes(w.fsrs?.state) ? 0 : 1;
      return learning(a) - learning(b) || (a.nextReview || 0) - (b.nextReview || 0);
    });
    const fresh = unique.filter(w => !w.mastered && isNewCard(w) && (w.nextReview || 0) <= now)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(0, newLimit);
    pool = [...due, ...fresh];
  }
  return (limit === -1 ? pool : pool.slice(0, limit)).map(w => JSON.parse(JSON.stringify(w)));
}
export function stageLabel(w) {
  if (w.mastered) return '已暂停';
  if (!w.fsrs) return isNewCard(w) ? '新词' : '待迁移';
  return ['新词', '学习中', '间隔复习', '重新学习'][w.fsrs.state] || '待复习';
}
export function formatInterval(ms) {
  if (ms < 60000) return '马上';
  if (ms < 3600000) return `${Math.ceil(ms / 60000)} 分钟后`;
  if (ms < DAY) return `${Math.round(ms / 3600000 * 10) / 10} 小时后`;
  return `${Math.round(ms / DAY)} 天后`;
}
