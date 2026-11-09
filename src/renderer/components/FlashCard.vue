<template>
  <div class="fc">
    <div class="fc-done" v-if="mode === 'loading'"><p>正在准备卡片…</p></div>
    <div class="fc-done" v-else-if="mode === 'idle'">
      <div class="done-icon">{{ words.length ? '✅' : '🗂' }}</div>
      <h2>{{ words.length ? '当前没有待复习卡片' : '闪卡池为空' }}</h2>
      <p class="setup-hint">{{ words.length ? nextDueText : '在生词本点击 ⚡ 将单词加入闪卡池，再来开始背诵。' }}</p>
      <p class="fc-message" role="alert" v-if="message">{{ message }}</p>
      <div class="idle-actions">
        <button v-if="message || availableCount" class="btn-start" :disabled="busy" @click="startSession(false)">{{ message ? '重试' : '继续背诵' }}</button>
        <button v-if="words.length" class="btn-start-all" :disabled="busy" @click="startSession(true)">提前练习</button>
        <button class="btn-start-all" @click="emit('close-review')">返回生词本</button>
        <button class="settings-link" @click="emit('open-settings')">复习设置</button>
      </div>
    </div>
    <div class="fc-done" v-else-if="mode === 'done'">
      <div class="done-icon">✅</div><h2>{{ practice ? '本轮练习完成' : '本轮复习完成' }}</h2>
      <div class="done-stats"><div class="done-stat" v-for="r in ratings" :key="r.value"><div class="ds-n">{{ counts[r.value] || 0 }}</div><div class="ds-l">{{ r.label }}</div></div></div>
      <p class="setup-hint">每次作答均已保存{{ practice ? '；正式复习计划保持不变' : '' }}。</p>
      <div class="idle-actions"><button v-if="availableCount" class="btn-start" @click="startSession(false)">继续背诵</button><button class="btn-start-all" @click="startSession(true)">提前练习</button><button class="btn-start-all" @click="emit('close-review')">返回生词本</button></div>
    </div>

    <div class="fc-done" v-else-if="mode === 'session' && !current">
      <h2>这一批已答完，等待短时重学</h2>
      <p>{{ nextWaitingText }}</p><p class="setup-hint">可以留在这里等待，或稍后从复习入口继续，进度已保存。</p>
      <div class="idle-actions"><button class="btn-start" @click="emit('close-review')">稍后继续</button></div>
    </div>

    <div class="fc-session" v-else-if="mode === 'session' && current">
      <div class="session-header"><span class="sh-title">{{ practice ? '提前练习 · 不改计划' : '闪卡复习' }}</span><span class="shp-counter">已答 {{ answered }} 次 · 剩余 {{ queue.length }} 张</span><div class="session-actions"><button v-if="isPassage" class="toggle-details" :aria-expanded="showDetails" aria-controls="review-details" @click="showDetails = !showDetails">{{ showDetails ? '收起学习记录' : '显示学习记录' }}</button><button class="exit-session" :disabled="busy" @click="emit('close-review')">结束本轮</button></div></div>
      <div class="session-body" :class="{ 'reading-wide': isPassage && !showDetails }">
        <div ref="cardElement" class="word-card" :class="{ flipped, 'passage-card': isPassage, 'long-text': contentLength > 100, 'very-long-text': contentLength > 500 }" @click="flip">
          <div class="card-content">
            <div class="wc-badge badge-learning">{{ stageLabel(current) }}</div>
            <div class="wc-word">{{ current.word }}</div>
            <div class="wc-phonetic" v-if="flipped && detail?.phonetic">{{ detail.phonetic }}</div>
            <button class="wc-tts" @click.stop="speak" title="朗读">🔊</button>
            <div class="wc-trans" v-if="flipped">{{ current.translation || '暂无中文释义' }}</div>
            <div class="wc-hint" v-else>先回忆含义，再翻面核对</div>
          </div>
        </div>
        <div v-if="!isPassage || showDetails" class="detail-panel" id="review-details"><div class="dp-scroll">
          <div class="dp-empty" v-if="!flipped">释义、例句和同义词将在翻面后显示</div>
          <template v-else>
            <template v-if="detail?.meanings?.length">
              <div class="dp-meaning" v-for="(m, mi) in detail.meanings" :key="mi">
                <div class="dp-pos">{{ m.partOfSpeech?.toUpperCase() }}</div>
                <ul class="dp-defs"><li v-for="(d, di) in m.definitions" :key="di"><span class="dp-def-text">{{ d.definition }}</span><span class="dp-example" v-if="d.example">{{ d.example }}</span></li></ul>
                <div class="dp-tags" v-if="m.synonyms?.length"><span class="dp-tag-label">同义词</span><span class="dp-tag syn" v-for="s in m.synonyms" :key="s">{{ s }}</span></div>
                <div class="dp-tags" v-if="m.antonyms?.length"><span class="dp-tag-label ant">反义词</span><span class="dp-tag ant" v-for="s in m.antonyms" :key="s">{{ s }}</span></div>
              </div>
            </template>
            <div class="dp-loading" v-else-if="detailLoading">加载释义中…</div><div class="dp-empty" v-else>暂无英文释义</div>
          </template>
          <div class="dp-divider"></div><div class="dp-stats-title">学习记录</div>
          <div class="dp-stats">
            <div class="dp-stat"><div class="dp-stat-v">{{ current.reviewCount || 0 }}</div><div class="dp-stat-l">正式复习次数</div></div>
            <div class="dp-stat"><div class="dp-stat-v">{{ stageLabel(current) }}</div><div class="dp-stat-l">学习阶段</div></div>
            <div class="dp-stat"><div class="dp-stat-v">{{ current.nextReview ? formatDate(current.nextReview) : '未安排' }}</div><div class="dp-stat-l">下次复习</div></div>
            <div class="dp-stat"><div class="dp-stat-v">{{ current.lastReview ? formatDate(current.lastReview) : '未复习' }}</div><div class="dp-stat-l">上次复习</div></div>
          </div>
          <template v-if="flipped && recentLogs.length"><div class="dp-stats-title">最近作答</div><div class="review-log" v-for="log in recentLogs" :key="log.id">{{ formatDate(log.at) }} · {{ ratings.find(r => r.value === log.rating)?.label }} · {{ log.mode === 'practice' ? '提前练习' : '正式复习' }}</div></template>
        </div></div>
      </div>
      <div class="session-footer">
        <p class="fc-message" role="alert" v-if="message">{{ message }}</p>
        <div class="fc-key-hint" v-if="!flipped">空格键 / 点击卡片翻面</div>
        <template v-else>
          <div class="fc-btns"><button v-for="r in ratings" :key="r.value" :class="r.class" :disabled="busy || (!practice && !preview)" @click="answer(r.value)"><span class="btn-label">{{ r.value }} · {{ r.label }}</span><span class="fc-next">{{ practice ? '不改计划' : preview ? formatInterval(preview.choices[r.value].intervalMs) : '计算中…' }}</span></button></div>
          <div class="fc-key-hint">没想起来就选 1；“费力想起”表示独立答对，但回忆困难。</div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useTTS } from '../composables/useTTS.js';
import { cardId, buildQueue, newRemaining, stageLabel, formatInterval, DAY } from '../composables/review-queue.mjs';

const props = defineProps({ words: { type: Array, default: () => [] }, reviewOptions: Object, reviewLogs: Array });
const emit = defineEmits(['committed', 'open-settings', 'close-review']);
const { speak: ttsSpeak } = useTTS();
const mode = ref('loading');
const queue = ref([]);
const practice = ref(false);
const flipped = ref(false);
const busy = ref(false);
const message = ref('');
const preview = ref(null);
const counts = ref({});
const clock = ref(Date.now());
const ratings = [
  { value: 1, label: '没想起来', class: 'fc-btn-unknown' },
  { value: 2, label: '费力想起', class: 'fc-btn-vague' },
  { value: 3, label: '正常想起', class: 'fc-btn-known' },
  { value: 4, label: '轻松想起', class: 'fc-btn-easy' },
];
const answered = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0));
const recentLogs = computed(() => (props.reviewLogs || []).filter(l => current.value && l.bookId === current.value.bookId && l.key === current.value.key).slice(-5).reverse());
const current = computed(() => queue.value.find(w => practice.value || (w.nextReview || 0) <= clock.value) || null);
const contentLength = computed(() => Array.from(current.value?.word || '').length);
const isPassage = computed(() => /\s/.test(current.value?.word?.trim() || '') || contentLength.value > 28);
const showDetails = ref(false);
const cardElement = ref(null);
const availableCount = computed(() => buildQueue(props.words, { now: clock.value, limit: props.reviewOptions?.batchSize ?? 20, newLimit: newRemaining(props.reviewLogs, props.reviewOptions, clock.value) }).length);
const nextDueText = computed(() => {
  const future = props.words.filter(w => !w.mastered && w.nextReview > clock.value).map(w => w.nextReview);
  return future.length ? `下次复习：${formatDate(Math.min(...future))}` : '今天先到这里。也可以提前练习，正式复习计划保持不变。';
});
const nextWaitingText = computed(() => queue.value.length ? `下张卡片：${formatInterval(Math.min(...queue.value.map(w => w.nextReview)) - clock.value)}` : '本轮完成');
const detailCache = new Map();
const detail = ref(null);
const detailLoading = ref(false);
let timer;
let generation = 0;
let pendingRequest = null;
let disposed = false;

watch(current, async card => {
  const token = ++generation;
  flipped.value = false;
  showDetails.value = false;
  detail.value = null;
  detailLoading.value = false;
  preview.value = null;
  pendingRequest = null;
  if (!card) return;
  await nextTick();
  if (token !== generation) return;
  if (cardElement.value) cardElement.value.scrollTop = 0;
  if (!practice.value) {
    try {
      const result = await window.vocaAPI.previewReview({ bookId: card.bookId, key: card.key });
      if (token === generation) preview.value = result;
    } catch (e) { if (token === generation) message.value = `调度失败：${e.message}`; }
  }
});

async function startSession(usePractice) {
  if (busy.value) return;
  busy.value = true; message.value = '';
  mode.value = 'loading';
  try {
    const data = await window.vocaAPI.loadData();
    if (disposed) return;
    emit('committed', data);
    practice.value = usePractice;
    clock.value = Date.now();
    queue.value = buildQueue(data.flashPool || [], { now: clock.value, limit: data.reviewOptions?.batchSize ?? 20, newLimit: newRemaining(data.reviewLogs, data.reviewOptions, clock.value), practice: usePractice });
    counts.value = {};
    if (queue.value.length) mode.value = 'session';
    else mode.value = 'idle';
  } catch (e) { mode.value = 'idle'; message.value = `开始失败：${e.message}`; }
  finally { busy.value = false; }
}
async function flip() {
  if (busy.value || !current.value) return;
  flipped.value = !flipped.value;
  await nextTick();
  if (contentLength.value > 100 && cardElement.value) {
    const element = cardElement.value;
    const answerElement = element.querySelector('.wc-trans');
    element.scrollTop = answerElement ? element.scrollTop + answerElement.getBoundingClientRect().top - element.getBoundingClientRect().top - 24 : 0;
  }
  if (!flipped.value || detail.value || detailLoading.value) return;
  const token = generation;
  const word = current.value.word.trim().toLowerCase();
  if (/\s|[\u4e00-\u9fa5]/.test(word)) return;
  if (detailCache.has(word)) { detail.value = detailCache.get(word); return; }
  detailLoading.value = true;
  try {
    const result = await window.vocaAPI.getWordDetail(word);
    const value = result.success ? result : null;
    detailCache.set(word, value);
    if (generation === token) detail.value = value;
  } catch { /* Dictionary availability must not block reviews. */ }
  finally { if (generation === token) detailLoading.value = false; }
}
async function answer(rating) {
  const card = current.value;
  if (busy.value || !card || !flipped.value || (!practice.value && !preview.value)) return;
  busy.value = true; message.value = '';
  if (!pendingRequest) pendingRequest = { id: crypto.randomUUID(), bookId: card.bookId, key: card.key, rating, expectedLastReview: card.lastReview || 0, practice: practice.value };
  try {
    const result = await window.vocaAPI.reviewCard({ ...pendingRequest });
    emit('committed', result.data);
    const actualRating = pendingRequest.rating;
    counts.value[actualRating] = (counts.value[actualRating] || 0) + 1;
    const next = queue.value.filter(w => cardId(w) !== cardId(card));
    const updated = result.word || result.data.flashPool.find(w => cardId(w) === cardId(card));
    if (!practice.value && updated && [1, 3].includes(updated.fsrs?.state) && updated.nextReview < Date.now() + DAY) next.push(updated);
    pendingRequest = null;
    clock.value = Date.now();
    queue.value = next;
    if (!next.length) mode.value = 'done';
  } catch (e) { message.value = `保存失败，当前卡片已保留；再次评分可重试：${e.message}`; }
  finally { busy.value = false; }
}
function speak() { if (current.value) ttsSpeak(current.value.word, 'en-US'); }
function formatDate(ts) { return new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function onKey(e) {
  if (mode.value !== 'session' || busy.value || e.repeat || e.target?.closest('input, select, textarea, button')) return;
  if (e.code === 'Space') { e.preventDefault(); flip(); }
  else if (/^Digit[1-4]$/.test(e.code) && flipped.value) { e.preventDefault(); answer(Number(e.code.slice(-1))); }
}
onMounted(() => { timer = setInterval(() => { clock.value = Date.now(); }, 1000); document.addEventListener('keydown', onKey); startSession(false); });
onUnmounted(() => { disposed = true; clearInterval(timer); generation++; document.removeEventListener('keydown', onKey); });
</script>

<style scoped>
.idle-actions { width: min(360px, 85%); display: grid; gap: 10px; }
.settings-link { background: transparent; color: #eee; border: 0; cursor: pointer; padding: 6px; }
.review-log { font-size: 12px; color: #e0dcf2; line-height: 1.6; }
.fc-message { color: #ffe6a7; font-size: 13px; text-align: center; max-width: 700px; }
.exit-session { background: transparent; color: white; border: 1px solid #ffffff70; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.session-actions { display: flex; gap: 10px; align-items: center; }
.toggle-details { background: transparent; border: 0; color: #f1edff; padding: 6px 0; cursor: pointer; font: inherit; font-size: 12px; }
button:disabled { opacity: .5; cursor: default; }
.fc-btn-easy { background: #fff; color: #6052c5; }
.fc {
  flex: 1; display: flex; flex-direction: column;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100%;
  height: 100%; overflow-y: auto;
}

.setup-hint { font-size: 13px; color: #e1def1; text-align: center; max-width: 85%; line-height: 1.6; }
.btn-start {
  width: 100%; padding: 13px; background: white; color: #764ba2;
  border: none; border-radius: 12px; font-size: 15px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: opacity 0.15s; margin-top: 4px;
}
.btn-start:hover { opacity: 0.9; }
.btn-start:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-start-all {
  width: 100%; padding: 10px; background: transparent;
  border: 1.5px solid rgba(255,255,255,0.35); color: rgba(255,255,255,0.75);
  border-radius: 12px; font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.btn-start-all:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.6); color: white; }
.btn-start-all:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Done ──────────────────────────────────────────────── */
.fc-done {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 20px; color: white;
}
.done-icon { font-size: 56px; }
.fc-done h2 { font-size: 24px; font-weight: 700; }
.done-stats { display: flex; gap: 20px; background: rgba(255,255,255,0.15); border-radius: 16px; padding: 18px 32px; }
.done-stat { text-align: center; }
.ds-n { font-size: 30px; font-weight: 800; margin-bottom: 4px; }
.ds-n.green { color: #7fff9a; }
.ds-n.orange { color: #ffc97a; }
.ds-n.red { color: #ff9a9a; }
.ds-l { font-size: 12px; opacity: 0.7; }

/* ── Session ───────────────────────────────────────────── */
.fc-session {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}

.session-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px 12px; flex-shrink: 0;
}
.sh-title { font-size: 16px; font-weight: 700; color: white; }
.sh-progress { display: flex; align-items: center; gap: 10px; }
.shp-bar { width: 120px; height: 4px; background: rgba(255,255,255,0.25); border-radius: 2px; overflow: hidden; }
.shp-fill { height: 100%; background: white; transition: width 0.3s; }
.shp-counter { font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 600; white-space: nowrap; }

.session-body {
  flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 30%);
  gap: 16px; padding: 0 24px 16px; overflow: hidden;
}
.session-body.reading-wide { grid-template-columns: minmax(0, 1fr); }

/* Word card */
.word-card {
  min-width: 0; min-height: 0; width: auto; overflow-y: auto; overflow-x: hidden;
  background: white; border-radius: 20px;
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  cursor: pointer; user-select: none;
  transition: transform 0.15s;
}
.card-content { width: 100%; max-width: 72ch; flex: 0 0 auto; margin-block: auto; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.word-card:hover { transform: translateY(-2px); }

.wc-badge {
  font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 10px;
  margin-bottom: 4px;
}
.badge-new      { background: #e8f5e9; color: #388e3c; }
.badge-learning { background: #f1f8e9; color: #558b2f; }
.badge-familiar { background: #e3f2fd; color: #1565c0; }
.badge-mastered { background: #fce4ec; color: #c62828; }

.wc-word { width: 100%; font-size: 36px; font-weight: 800; color: #1a1a1a; text-align: center; line-height: 1.25; white-space: pre-wrap; overflow-wrap: anywhere; }
.passage-card .wc-word { font-size: 30px; font-weight: 650; line-height: 1.6; }
.long-text .wc-word { font-size: 24px; text-align: left; }
.very-long-text .wc-word { font-size: 19px; }
.wc-phonetic { font-size: 13px; color: #999; }
.wc-tts {
  background: none; border: none; font-size: 18px; cursor: pointer;
  opacity: 0.5; padding: 4px; border-radius: 6px; transition: opacity 0.15s;
}
.wc-tts:hover { opacity: 1; }
.wc-trans { width: 100%; font-size: 22px; font-weight: 600; color: #4a90d9; text-align: center; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 8px; }
.long-text .wc-trans { font-size: 19px; text-align: left; }
.wc-hint { font-size: 12px; color: #bbb; margin-top: 8px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Detail panel */
.detail-panel {
  min-width: 0; min-height: 0; background: rgba(20, 16, 40, 0.75); border-radius: 20px;
  overflow: hidden; display: flex; flex-direction: column;
}
.dp-scroll {
  flex: 1; overflow-y: auto; padding: 20px 20px 16px;
  display: flex; flex-direction: column; gap: 12px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent;
}
.dp-scroll::-webkit-scrollbar { width: 4px; }
.dp-scroll::-webkit-scrollbar-track { background: transparent; }
.dp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

.dp-meaning { display: flex; flex-direction: column; gap: 6px; }
.dp-pos { font-size: 11px; font-weight: 700; color: #a78bfa; text-transform: uppercase; letter-spacing: .5px; }
.dp-defs { padding-left: 14px; display: flex; flex-direction: column; gap: 4px; }
.dp-defs li { list-style: disc; }
.dp-def-text { font-size: 13px; color: rgba(255,255,255,0.85); line-height: 1.45; }
.dp-example { display: block; font-size: 11px; color: rgba(255,255,255,0.45); font-style: italic; margin-top: 2px; }
.dp-tags { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 2px; }
.dp-tag-label { font-size: 11px; color: rgba(255,255,255,0.4); }
.dp-tag-label.ant { color: rgba(255,180,180,0.6); }
.dp-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: rgba(167,139,250,0.15); color: #c4b5fd;
}
.dp-tag.ant { background: rgba(255,100,100,0.12); color: #fca5a5; }

.dp-loading { font-size: 12px; color: rgba(255,255,255,0.35); text-align: center; padding: 12px 0; }
.dp-empty   { font-size: 12px; color: rgba(255,255,255,0.2); text-align: center; padding: 12px 0; }

.dp-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 4px 0; }
.dp-stats-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: .5px; }
.dp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.dp-stat {
  background: rgba(255,255,255,0.06); border-radius: 10px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 3px;
}
.dp-stat-v { font-size: 16px; font-weight: 700; color: white; overflow-wrap: anywhere; }
.dp-stat-l { font-size: 11px; color: rgba(255,255,255,0.4); }

/* Session footer */
.session-footer {
  flex-shrink: 0; padding: 12px 24px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.fc-key-hint { color: rgba(255,255,255,0.45); font-size: 12px; }
.fc-btns { display: flex; gap: 10px; width: 100%; max-width: 720px; }
.fc-btn-unknown, .fc-btn-vague, .fc-btn-known, .fc-btn-easy {
  flex: 1; padding: 12px 8px; border: none; border-radius: 14px;
  font-weight: 700; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); font-family: inherit;
  transition: transform 0.15s;
}
.fc-btn-unknown:active, .fc-btn-vague:active, .fc-btn-known:active { transform: scale(0.97); }
.fc-btn-unknown { background: #fff; color: #e74c3c; }
.fc-btn-vague   { background: #fff; color: #e8820c; }
.fc-btn-known   { background: #fff; color: #27ae60; }
.btn-icon { font-size: 16px; }
.btn-label { font-size: 13px; font-weight: 700; }
.fc-next { font-size: 11px; opacity: 0.55; font-weight: 400; }
@media (max-height: 650px) {
  .btn-start, .btn-start-all { padding: 8px; }
  .session-header { padding: 8px 16px; }
  .session-footer { padding: 8px 16px; }
}
@media (max-width: 900px) {
  .session-header { gap: 8px; flex-wrap: wrap; }
  .session-actions { margin-left: auto; }
  .session-body { padding: 0 16px 12px; gap: 12px; }
  .word-card { padding: 22px 20px; }
  .passage-card .wc-word { font-size: 26px; }
  .long-text .wc-word { font-size: 22px; }
  .very-long-text .wc-word { font-size: 18px; }
}
</style>
