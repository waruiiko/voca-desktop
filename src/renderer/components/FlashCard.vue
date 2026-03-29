<template>
  <div class="fc">

    <!-- ① Setup screen -->
    <div class="fc-setup" v-if="mode === 'setup'">
      <div class="setup-card">
        <div class="setup-icon">🗂</div>
        <h2>闪卡复习</h2>

        <template v-if="words.length === 0">
          <div class="setup-empty">
            <p>闪卡池为空</p>
            <p class="setup-empty-hint">请在生词本页面点击 ⚡ 将单词加入闪卡池</p>
          </div>
        </template>

        <template v-else>
          <div class="setup-stats">
            <span class="stat-due">{{ dueCount }} 词待复习</span>
            <span class="stat-sep">·</span>
            <span class="stat-total">共 {{ words.length }} 词</span>
          </div>

          <div class="setup-section-label">每次复习数量</div>
          <div class="setup-counts">
            <button
              v-for="n in countOptions"
              :key="n.v"
              class="cnt-btn"
              :class="{ active: batchSize === n.v }"
              @click="batchSize = n.v"
            >{{ n.label }}</button>
          </div>
          <div class="setup-hint">
            将随机取 {{ batchSizeLabel }} 词进行复习
          </div>

          <button class="btn-start" @click="startSession(false)">
            开始复习待复习词 ({{ dueCount }})
          </button>
          <button class="btn-start-all" @click="startSession(true)">
            复习全部单词 ({{ words.length }})
          </button>
        </template>
      </div>
    </div>

    <!-- ② Done screen -->
    <div class="fc-done" v-else-if="mode === 'done'">
      <div class="done-icon">✅</div>
      <h2>本轮完成！</h2>
      <div class="done-stats">
        <div class="done-stat"><div class="ds-n green">{{ counts.known }}</div><div class="ds-l">认识</div></div>
        <div class="done-stat"><div class="ds-n orange">{{ counts.vague }}</div><div class="ds-l">模糊</div></div>
        <div class="done-stat"><div class="ds-n red">{{ counts.unknown }}</div><div class="ds-l">不认识</div></div>
      </div>
      <button class="btn-start" @click="mode = 'setup'">重新选择</button>
    </div>

    <!-- ③ Session screen -->
    <div class="fc-session" v-else-if="mode === 'session' && current">
      <!-- Header -->
      <div class="session-header">
        <span class="sh-title">单词复习</span>
        <div class="sh-progress">
          <div class="shp-bar"><div class="shp-fill" :style="{ width: progress + '%' }"></div></div>
          <span class="shp-counter">{{ idx + 1 }} / {{ session.length }}</span>
        </div>
      </div>

      <!-- Body -->
      <div class="session-body">
        <!-- Left: word card -->
        <div class="word-card" :class="{ flipped }" @click="flip">
          <div class="wc-badge" :class="memClass(current)">{{ memLabel(current) }}</div>
          <div class="wc-word">{{ current.word }}</div>
          <div class="wc-phonetic" v-if="detail?.phonetic">{{ detail.phonetic }}</div>
          <button class="wc-tts" @click.stop="speak" title="朗读">🔊</button>
          <transition name="fade">
            <div class="wc-trans" v-if="flipped">{{ current.translation }}</div>
            <div class="wc-hint" v-else>点击翻转查看释义</div>
          </transition>
        </div>

        <!-- Right: detail panel -->
        <div class="detail-panel">
          <div class="dp-scroll">
            <template v-if="detail?.meanings?.length">
              <div class="dp-meaning" v-for="(m, mi) in detail.meanings" :key="mi">
                <div class="dp-pos">{{ m.partOfSpeech.toUpperCase() }}</div>
                <ul class="dp-defs">
                  <li v-for="(d, di) in m.definitions" :key="di">
                    <span class="dp-def-text">{{ d.definition }}</span>
                    <span class="dp-example" v-if="d.example">"{{ d.example }}"</span>
                  </li>
                </ul>
                <div class="dp-tags" v-if="m.synonyms?.length">
                  <span class="dp-tag-label">同义词</span>
                  <span class="dp-tag syn" v-for="s in m.synonyms" :key="s">{{ s }}</span>
                </div>
                <div class="dp-tags" v-if="m.antonyms?.length">
                  <span class="dp-tag-label ant">反义词</span>
                  <span class="dp-tag ant" v-for="s in m.antonyms" :key="s">{{ s }}</span>
                </div>
              </div>
            </template>
            <div class="dp-loading" v-else-if="detailLoading">加载释义中…</div>
            <div class="dp-empty" v-else>暂无英文释义</div>

            <!-- Learning stats -->
            <div class="dp-divider"></div>
            <div class="dp-stats-title">学习记录</div>
            <div class="dp-stats">
              <div class="dp-stat">
                <div class="dp-stat-v">{{ current.reviewCount || 0 }}</div>
                <div class="dp-stat-l">复习次数</div>
              </div>
              <div class="dp-stat">
                <div class="dp-stat-v">{{ current.interval || 1 }}天</div>
                <div class="dp-stat-l">当前间隔</div>
              </div>
              <div class="dp-stat">
                <div class="dp-stat-v">{{ Math.round((current.easeFactor || 2.5) * 100) }}%</div>
                <div class="dp-stat-l">掌握系数</div>
              </div>
              <div class="dp-stat">
                <div class="dp-stat-v">{{ current.lastReview ? fmtDate(current.lastReview) : '未复习' }}</div>
                <div class="dp-stat-l">上次复习</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="session-footer">
        <div class="fc-key-hint" v-if="!flipped">← 点击卡片翻转 / 按空格键 →</div>
        <template v-else>
          <div class="fc-btns">
            <button class="fc-btn-unknown" @click="answer(0)">
              <span class="btn-icon">✗</span>
              <span class="btn-label">不认识</span>
              <span class="fc-next">明天</span>
            </button>
            <button class="fc-btn-vague" @click="answer(1)">
              <span class="btn-icon">≈</span>
              <span class="btn-label">模糊</span>
              <span class="fc-next">{{ fmt(nextVague) }}</span>
            </button>
            <button class="fc-btn-known" @click="answer(2)">
              <span class="btn-icon">✓</span>
              <span class="btn-label">认识</span>
              <span class="fc-next">{{ fmt(nextKnown) }}</span>
            </button>
          </div>
          <div class="fc-key-hint">⌨️ 1=不认识  2=模糊  3=认识</div>
        </template>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTTS } from '../composables/useTTS.js';

const props = defineProps({ words: Array });
const emit = defineEmits(['update']);
const { speak: ttsSpeak } = useTTS();

const mode = ref('setup');   // 'setup' | 'session' | 'done'
const session = ref([]);
const idx = ref(0);
const flipped = ref(false);
const counts = ref({ known: 0, vague: 0, unknown: 0 });
const batchSize = ref(20);

const countOptions = [
  { v: 10, label: '10' }, { v: 20, label: '20' }, { v: 30, label: '30' },
  { v: 50, label: '50' }, { v: 100, label: '100' }, { v: -1, label: '全部' },
];

const detailCache = {};
const detail = ref(null);
const detailLoading = ref(false);

const current = computed(() => session.value[idx.value] || null);
const progress = computed(() => session.value.length ? (idx.value / session.value.length) * 100 : 0);

const dueCount = computed(() => {
  const now = Date.now();
  return props.words.filter(w => !w.mastered && (!w.nextReview || w.nextReview <= now)).length;
});

const batchSizeLabel = computed(() => {
  if (batchSize.value === -1) return props.words.length;
  return Math.min(batchSize.value, props.words.length);
});

const nextVague = computed(() => calcNext(current.value, 1));
const nextKnown = computed(() => calcNext(current.value, 2));

function startSession(useAll) {
  const now = Date.now();
  let pool = useAll
    ? [...props.words]
    : props.words.filter(w => !w.mastered && (!w.nextReview || w.nextReview <= now));

  // If no due words, fall back to full pool
  if (pool.length === 0) pool = [...props.words];

  pool = pool.sort(() => Math.random() - 0.5);
  if (batchSize.value !== -1) pool = pool.slice(0, batchSize.value);

  session.value = pool;
  idx.value = 0;
  flipped.value = false;
  counts.value = { known: 0, vague: 0, unknown: 0 };
  detail.value = null;
  mode.value = 'session';
  loadDetail();
}

function flip() {
  flipped.value = !flipped.value;
}

async function loadDetail() {
  if (!current.value) return;
  const w = current.value.word.trim().toLowerCase();
  if (!w || /\s/.test(w) || /[\u4e00-\u9fa5]/.test(w)) { detail.value = null; return; }
  if (detailCache[w] !== undefined) { detail.value = detailCache[w]; return; }
  detailLoading.value = true;
  detail.value = null;
  const res = await window.vocaAPI.getWordDetail(w);
  const d = res.success ? res : null;
  detailCache[w] = d;
  detail.value = d;
  detailLoading.value = false;
}

function answer(q) {
  const card = current.value;
  if (!card) return;
  if (q === 2) counts.value.known++;
  else if (q === 1) counts.value.vague++;
  else counts.value.unknown++;
  sm2(card, q);
  emit('update', card);
  if (idx.value < session.value.length - 1) {
    idx.value++;
    flipped.value = false;
    detail.value = null;
    loadDetail();
  } else {
    mode.value = 'done';
    window.vocaAPI.updateStats(session.value.length);
  }
}

function speak() {
  if (!current.value) return;
  ttsSpeak(current.value.word, 'en-US');
}

function calcNext(card, q) {
  if (!card) return 1;
  const { interval = 1, easeFactor = 2.5, reviewCount = 0 } = card;
  if (q === 1) return Math.max(2, Math.round(interval * 1.2));
  const eb = [1, 2, 4, 7, 15, 30];
  return reviewCount < eb.length - 1 ? eb[reviewCount + 1] : Math.round(interval * easeFactor);
}

function sm2(card, q) {
  if (!card.easeFactor) card.easeFactor = 2.5;
  if (!card.reviewCount) card.reviewCount = 0;
  card.reviewCount++;
  const eb = [1, 2, 4, 7, 15, 30];
  if (q === 0) {
    card.interval = 1;
    card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
  } else if (q === 1) {
    card.interval = Math.max(2, Math.round((card.interval || 1) * 1.2));
    card.easeFactor = Math.max(1.3, card.easeFactor - 0.1);
  } else {
    const rc = card.reviewCount - 1;
    card.interval = rc < eb.length - 1 ? eb[rc + 1] : Math.round((card.interval || 1) * card.easeFactor);
    card.easeFactor = Math.max(1.3, card.easeFactor + 0.05);
  }
  card.nextReview = Date.now() + card.interval * 86400000;
  card.lastReview = Date.now();
}

function fmt(d) {
  if (d <= 1) return '明天';
  if (d < 30) return `${d}天后`;
  return `${Math.round(d / 30)}个月后`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 30) return `${diff}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function memLabel(w) {
  const rc = w.reviewCount || 0;
  const iv = w.interval || 1;
  if (rc === 0) return '🌱 新词';
  if (iv < 7) return '🌿 初记';
  if (iv < 21) return '🌳 熟悉';
  return '💎 掌握';
}
function memClass(w) {
  const rc = w.reviewCount || 0;
  const iv = w.interval || 1;
  if (rc === 0) return 'badge-new';
  if (iv < 7) return 'badge-learning';
  if (iv < 21) return 'badge-familiar';
  return 'badge-mastered';
}

function onKey(e) {
  if (mode.value !== 'session') return;
  if (e.code === 'Space') { e.preventDefault(); flip(); }
  else if (e.code === 'Digit1' && flipped.value) answer(0);
  else if (e.code === 'Digit2' && flipped.value) answer(1);
  else if (e.code === 'Digit3' && flipped.value) answer(2);
}

onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));
</script>

<style scoped>
.fc {
  flex: 1; display: flex; flex-direction: column;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

/* ── Setup ─────────────────────────────────────────────── */
.fc-setup {
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px;
}
.setup-card {
  background: rgba(255,255,255,0.12); backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 24px; padding: 36px 40px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  width: 100%; max-width: 420px; color: white;
}
.setup-icon { font-size: 48px; }
.setup-card h2 { font-size: 22px; font-weight: 700; margin: 0; }
.setup-stats { display: flex; align-items: center; gap: 8px; font-size: 14px; opacity: 0.85; }
.stat-due { color: #ffd066; font-weight: 600; }
.stat-sep { opacity: 0.4; }
.setup-section-label { font-size: 12px; opacity: 0.6; text-transform: uppercase; letter-spacing: .5px; margin-top: 4px; }
.setup-counts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.cnt-btn {
  padding: 8px 16px; border-radius: 10px; border: 1.5px solid rgba(255,255,255,0.3);
  background: transparent; color: rgba(255,255,255,0.8); font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
}
.cnt-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.6); }
.cnt-btn.active { background: white; color: #764ba2; border-color: white; }
.setup-hint { font-size: 12px; opacity: 0.55; text-align: center; }
.setup-empty { text-align: center; display: flex; flex-direction: column; gap: 6px; }
.setup-empty p { font-size: 16px; opacity: 0.85; }
.setup-empty-hint { font-size: 12px; opacity: 0.5; }
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
  flex: 1; display: flex; gap: 20px; padding: 0 24px 16px; overflow: hidden;
}

/* Word card */
.word-card {
  flex-shrink: 0; width: 280px;
  background: white; border-radius: 20px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 28px 24px; gap: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  cursor: pointer; user-select: none;
  transition: transform 0.15s;
}
.word-card:hover { transform: translateY(-2px); }

.wc-badge {
  font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 10px;
  margin-bottom: 4px;
}
.badge-new      { background: #e8f5e9; color: #388e3c; }
.badge-learning { background: #f1f8e9; color: #558b2f; }
.badge-familiar { background: #e3f2fd; color: #1565c0; }
.badge-mastered { background: #fce4ec; color: #c62828; }

.wc-word { font-size: 36px; font-weight: 800; color: #1a1a1a; text-align: center; line-height: 1.1; }
.wc-phonetic { font-size: 13px; color: #999; }
.wc-tts {
  background: none; border: none; font-size: 18px; cursor: pointer;
  opacity: 0.5; padding: 4px; border-radius: 6px; transition: opacity 0.15s;
}
.wc-tts:hover { opacity: 1; }
.wc-trans { font-size: 22px; font-weight: 700; color: #4a90d9; text-align: center; margin-top: 8px; }
.wc-hint { font-size: 12px; color: #bbb; margin-top: 8px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Detail panel */
.detail-panel {
  flex: 1; background: rgba(20, 16, 40, 0.75); border-radius: 20px;
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
.dp-stat-v { font-size: 18px; font-weight: 700; color: white; }
.dp-stat-l { font-size: 11px; color: rgba(255,255,255,0.4); }

/* Session footer */
.session-footer {
  flex-shrink: 0; padding: 12px 24px 20px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.fc-key-hint { color: rgba(255,255,255,0.45); font-size: 12px; }
.fc-btns { display: flex; gap: 10px; width: 100%; max-width: 520px; }
.fc-btn-unknown, .fc-btn-vague, .fc-btn-known {
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
</style>
