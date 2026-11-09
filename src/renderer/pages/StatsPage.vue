<template>
  <div class="sp">
    <div class="sp-header">
      <h1 class="sp-title">学习统计</h1>
    </div>

    <div class="sp-body">
      <!-- Top row: streak + today + total -->
      <div class="sp-row sp-row-top">
        <div class="sp-card sp-streak">
          <div class="sp-card-icon">🔥</div>
          <div class="sp-card-val">{{ stats.streak || 0 }}</div>
          <div class="sp-card-label">连续打卡天数</div>
        </div>
        <div class="sp-card sp-today">
          <div class="sp-card-icon">📅</div>
          <div class="sp-card-val">{{ stats.todayReviewed || 0 }}</div>
          <div class="sp-card-label">今日复习</div>
        </div>
        <div class="sp-card sp-total">
          <div class="sp-card-icon">📚</div>
          <div class="sp-card-val">{{ stats.totalReviewed || 0 }}</div>
          <div class="sp-card-label">累计复习</div>
        </div>
        <div class="sp-card sp-words">
          <div class="sp-card-icon">🗂</div>
          <div class="sp-card-val">{{ totalWords }}</div>
          <div class="sp-card-label">词库总词数</div>
        </div>
        <div class="sp-card sp-due">
          <div class="sp-card-icon">⏰</div>
          <div class="sp-card-val" :class="{ 'val-due': dueCount > 0 }">{{ dueCount }}</div>
          <div class="sp-card-label">待复习（闪卡池）</div>
        </div>
      </div>

      <!-- Daily goal -->
      <div class="sp-section">
        <div class="sp-section-title">今日目标</div>
        <div class="sp-goal">
          <div class="sp-goal-info">
            <span class="sp-goal-cur">{{ stats.todayReviewed || 0 }}</span>
            <span class="sp-goal-sep"> / </span>
            <span class="sp-goal-total">{{ dailyGoal }} 次作答</span>
            <span class="sp-goal-done" v-if="goalPct >= 100">✓ 已完成</span>
          </div>
          <div class="sp-goal-bar-wrap">
            <div class="sp-goal-bar" :style="{ width: goalPct + '%' }" :class="{ done: goalPct >= 100 }"></div>
          </div>
        </div>
      </div>

      <!-- Mastery distribution -->
      <div class="sp-section">
        <div class="sp-section-title">学习阶段分布（闪卡池）</div>
        <div v-if="poolWords.length === 0" class="sp-empty">闪卡池为空，在生词本点击 ⚡ 加入单词</div>
        <div v-else class="sp-dist">
          <div class="sp-dist-bar">
            <div
              v-for="seg in distSegments" :key="seg.label"
              class="sp-dist-seg"
              :style="{ width: seg.pct + '%', background: seg.color }"
              :title="`${seg.label}: ${seg.count}`"
            ></div>
          </div>
          <div class="sp-dist-legend">
            <div class="sp-legend-item" v-for="seg in distSegments" :key="seg.label">
              <span class="sp-legend-dot" :style="{ background: seg.color }"></span>
              <span class="sp-legend-label">{{ seg.label }}</span>
              <span class="sp-legend-count">{{ seg.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Books overview -->
      <div class="sp-section">
        <div class="sp-section-title">各生词本</div>
        <div class="sp-books">
          <div class="sp-book-row" v-for="(book, id) in data.books" :key="id">
            <span class="sp-book-name">{{ book.name }}</span>
            <span class="sp-book-count">{{ Object.keys(book.words || {}).length }} 词</span>
            <div class="sp-book-bar-wrap">
              <div
                class="sp-book-bar"
                :style="{ width: bookBarPct(book) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { stageLabel, buildQueue, newRemaining, localDay } from '../composables/review-queue.mjs';

const props = defineProps({ data: Object, settings: Object });

const stats = computed(() => {
  const value = props.data?.stats || {};
  return { ...value, todayReviewed: value.lastStudyDate === localDay(now.value) ? value.todayReviewed : 0 };
});
const flashPool = computed(() => props.data?.flashPool || []);
const dailyGoal = computed(() => props.settings?.dailyGoal || 10);
const goalPct = computed(() => Math.min(100, Math.round(((stats.value.todayReviewed || 0) / dailyGoal.value) * 100)));
const poolWords = computed(() => flashPool.value);

const totalWords = computed(() => {
  let n = 0;
  for (const book of Object.values(props.data?.books || {})) {
    n += Object.keys(book.words || {}).length;
  }
  return n;
});

const now = ref(Date.now());
let reviewTimer;
onMounted(() => { reviewTimer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => clearInterval(reviewTimer));
const dueCount = computed(() =>
  buildQueue(poolWords.value, { now: now.value, limit: -1, newLimit: newRemaining(props.data?.reviewLogs, props.data?.reviewOptions, now.value) }).length
);

const distSegments = computed(() => {
  const pool = poolWords.value;
  if (!pool.length) return [];
  const total = pool.length;
  return ['新词', '学习中', '间隔复习', '重新学习', '待迁移', '已暂停'].map((label, i) => {
    const count = pool.filter(w => stageLabel(w) === label).length;
    return { label, count, pct: Math.round(count / total * 100), color: ['#86efac', '#67e8f9', '#818cf8', '#f472b6', '#fbbf24', '#94a3b8'][i] };
  }).filter(s => s.count > 0);
});

const maxBookCount = computed(() => {
  let m = 0;
  for (const book of Object.values(props.data?.books || {})) {
    m = Math.max(m, Object.keys(book.words || {}).length);
  }
  return m || 1;
});

function bookBarPct(book) {
  return Math.round(Object.keys(book.words || {}).length / maxBookCount.value * 100);
}
</script>

<style scoped>
.sp {
  display: flex; flex-direction: column; height: 100%;
  background: #f5f5f7; overflow: hidden;
}

.sp-header {
  padding: 24px 32px 0; flex-shrink: 0;
}
.sp-title {
  font-size: 20px; font-weight: 800; color: #1a1a1a; margin: 0;
}

.sp-body {
  flex: 1; overflow-y: auto; padding: 20px 32px 32px;
  display: flex; flex-direction: column; gap: 20px;
}

/* Top cards */
.sp-row-top {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
}

.sp-card {
  background: #fff; border-radius: 16px; padding: 20px 16px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}
.sp-card-icon { font-size: 24px; }
.sp-card-val  { font-size: 28px; font-weight: 800; color: #1a1a1a; }
.sp-card-label { font-size: 11px; color: #aaa; text-align: center; }
.val-due { color: #6366f1; }

/* Sections */
.sp-section {
  background: #fff; border-radius: 16px; padding: 20px 24px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}
.sp-section-title {
  font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase;
  letter-spacing: .5px; margin-bottom: 14px;
}
.sp-empty { font-size: 13px; color: #ccc; }

/* Daily goal */
.sp-goal { display: flex; flex-direction: column; gap: 10px; }
.sp-goal-info { display: flex; align-items: baseline; gap: 4px; }
.sp-goal-cur { font-size: 22px; font-weight: 800; color: #6366f1; }
.sp-goal-sep, .sp-goal-total { font-size: 14px; color: #aaa; }
.sp-goal-done { font-size: 12px; color: #22c55e; font-weight: 700; margin-left: 8px; }
.sp-goal-bar-wrap { height: 8px; background: #f0f0f5; border-radius: 4px; overflow: hidden; }
.sp-goal-bar { height: 100%; background: #6366f1; border-radius: 4px; transition: width 0.4s; }
.sp-goal-bar.done { background: #22c55e; }

/* Distribution */
.sp-dist-bar {
  height: 10px; border-radius: 5px; overflow: hidden;
  display: flex; background: #f0f0f5; margin-bottom: 12px;
}
.sp-dist-seg { transition: width 0.3s; }
.sp-dist-legend {
  display: flex; gap: 16px; flex-wrap: wrap;
}
.sp-legend-item {
  display: flex; align-items: center; gap: 5px; font-size: 12px; color: #555;
}
.sp-legend-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
}
.sp-legend-count { color: #888; margin-left: 2px; }

/* Books */
.sp-books { display: flex; flex-direction: column; gap: 10px; }
.sp-book-row {
  display: flex; align-items: center; gap: 10px;
}
.sp-book-name { font-size: 13px; color: #333; width: 120px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-book-count { font-size: 12px; color: #aaa; width: 50px; flex-shrink: 0; text-align: right; }
.sp-book-bar-wrap { flex: 1; height: 6px; background: #f0f0f5; border-radius: 3px; overflow: hidden; }
.sp-book-bar { height: 100%; background: #6366f1; border-radius: 3px; transition: width 0.3s; }
</style>
