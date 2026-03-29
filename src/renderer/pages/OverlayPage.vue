<template>
  <div class="overlay" ref="rootRef">
    <!-- 拖动条 + pin 按钮 -->
    <div class="ov-titlebar">
      <div class="ov-drag-handle">Voca</div>
      <button class="ov-pin" :class="{ pinned }" @click="togglePin" :title="pinned ? '取消固定' : '固定窗口'">📌</button>
    </div>

    <!-- 语言切换栏 -->
    <div class="ov-langs">
      <div class="ov-lang-wrap">
        <button class="ov-lang-btn" @click.stop="toggleSl">{{ slLabel }}</button>
        <div class="ov-dropdown" v-if="showSl" @click.stop>
          <div
            class="ov-opt"
            v-for="l in sourceLangs" :key="l.code"
            :class="{ selected: sl === l.code }"
            @click="pickSl(l.code)"
          >{{ l.name }}</div>
        </div>
      </div>

      <button class="ov-swap" @click="swapLangs" title="互换语言">⇄</button>

      <div class="ov-lang-wrap">
        <button class="ov-lang-btn" @click.stop="toggleTl">{{ tlLabel }}</button>
        <div class="ov-dropdown ov-dropdown-right" v-if="showTl" @click.stop>
          <div
            class="ov-opt"
            v-for="l in targetLangs" :key="l.code"
            :class="{ selected: tl === l.code }"
            @click="pickTl(l.code)"
          >{{ l.name }}</div>
        </div>
      </div>
    </div>

    <!-- 最近查词 -->
    <div class="ov-recents" v-if="recentLookups.length">
      <div class="ov-recents-label">最近</div>
      <div class="ov-recents-list">
        <button
          class="ov-recent-chip"
          v-for="r in recentLookups"
          :key="r.text"
          :class="{ active: r.text === text }"
          @click="loadRecent(r)"
          :title="r.translation"
        >{{ r.text.length > 20 ? r.text.slice(0, 20) + '…' : r.text }}</button>
      </div>
    </div>

    <div class="ov-word" style="white-space: pre-wrap">{{ text }}</div>
    <div class="ov-translation" :class="{ loading }">
      {{ loading ? '翻译中…' : (result || '未找到翻译') }}
    </div>
    <div class="ov-actions">
      <button class="ov-btn ov-tts" @click="speak" title="朗读">🔊</button>
      <button class="ov-btn ov-save" @click="save" v-if="result && !saved">⭐ 收藏</button>
      <button class="ov-btn ov-unsave" @click="unsave" v-if="saved">✕ 取消收藏</button>
      <button class="ov-btn ov-open" @click="openTranslate" title="在翻译工作台打开">↗</button>
      <button class="ov-btn ov-close" @click="close">✕</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTTS } from '../composables/useTTS.js';

const { speak: ttsSpeak } = useTTS();
const rootRef = ref(null);
const text = ref('');
const result = ref('');
const loading = ref(false);
const saved = ref(false);
const pinned = ref(false);
const recentLookups = ref([]);

const sl = ref('auto');
const tl = ref('zh-CN');
const showSl = ref(false);
const showTl = ref(false);

const sourceLangs = [
  { code: 'auto',  name: '自动检测' },
  { code: 'en',    name: '英语' },
  { code: 'zh-CN', name: '中文（简体）' },
  { code: 'zh-TW', name: '中文（繁体）' },
  { code: 'ja',    name: '日语' },
  { code: 'ko',    name: '韩语' },
  { code: 'fr',    name: '法语' },
  { code: 'de',    name: '德语' },
  { code: 'es',    name: '西班牙语' },
  { code: 'ru',    name: '俄语' },
];
const targetLangs = sourceLangs.filter(l => l.code !== 'auto');

const slLabel = computed(() => sourceLangs.find(l => l.code === sl.value)?.name || sl.value);
const tlLabel = computed(() => targetLangs.find(l => l.code === tl.value)?.name || tl.value);

function toggleSl() { showSl.value = !showSl.value; showTl.value = false; }
function toggleTl() { showTl.value = !showTl.value; showSl.value = false; }

function pickSl(code) { sl.value = code; showSl.value = false; retranslate(); }
function pickTl(code) { tl.value = code; showTl.value = false; retranslate(); }

function swapLangs() {
  if (sl.value === 'auto') return;
  [sl.value, tl.value] = [tl.value, sl.value];
  retranslate();
}

function closeDropdowns() { showSl.value = false; showTl.value = false; }

function resizeWindow() {
  nextTick(() => {
    if (!rootRef.value) return;
    const h = rootRef.value.offsetHeight;
    window.vocaAPI.resizeOverlay(380, h + 2);
  });
}

onMounted(async () => {
  const settings = await window.vocaAPI.loadSettings();
  sl.value = settings.sourceLang || 'auto';
  tl.value = settings.targetLang || 'zh-CN';

  recentLookups.value = await window.vocaAPI.getRecentLookups();

  document.addEventListener('click', closeDropdowns);

  window.vocaAPI.onTranslate(async (t) => {
    text.value = t;
    result.value = '';
    loading.value = true;
    showSl.value = false;
    showTl.value = false;

    const [res, words] = await Promise.all([
      window.vocaAPI.translate(t.replace(/\n+/g, ' '), sl.value, tl.value),
      window.vocaAPI.loadWords(),
    ]);
    result.value = res.success ? res.text : ('翻译失败：' + res.error);
    saved.value = !!words[t.trim().toLowerCase()];
    loading.value = false;
    resizeWindow();

    if (res.success && res.text) {
      await window.vocaAPI.addRecentLookup({ text: t, translation: res.text });
      recentLookups.value = await window.vocaAPI.getRecentLookups();
    }
  });
});

async function loadRecent(r) {
  text.value = r.text;
  result.value = r.translation;
  saved.value = false;
  const words = await window.vocaAPI.loadWords();
  saved.value = !!words[r.text.trim().toLowerCase()];
  resizeWindow();
}

async function retranslate() {
  if (!text.value) return;
  loading.value = true;
  result.value = '';
  resizeWindow();
  const res = await window.vocaAPI.translate(text.value.replace(/\n+/g, ' '), sl.value, tl.value);
  result.value = res.success ? res.text : ('翻译失败：' + res.error);
  loading.value = false;
  resizeWindow();
}

function speak() {
  ttsSpeak(text.value, sl.value === 'auto' ? 'en-US' : sl.value);
}

async function save() {
  const word = text.value.trim().toLowerCase();
  if (!word || !result.value) return;
  const words = await window.vocaAPI.loadWords();
  if (!words[word]) {
    words[word] = { word: text.value.trim(), translation: result.value, timestamp: Date.now(), reviewCount: 0 };
    await window.vocaAPI.saveWords(words);
    window.vocaAPI.notifyWordsUpdated();
  }
  saved.value = true;
}

async function unsave() {
  const word = text.value.trim().toLowerCase();
  if (!word) return;
  const words = await window.vocaAPI.loadWords();
  delete words[word];
  await window.vocaAPI.saveWords(words);
  window.vocaAPI.notifyWordsUpdated();
  saved.value = false;
}

function openTranslate() {
  window.vocaAPI.openTranslate(text.value);
}

function close() { window.vocaAPI.hideOverlay(); }

async function togglePin() {
  const newState = await window.vocaAPI.toggleOverlayPin();
  pinned.value = newState;
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: transparent; overflow: hidden; }

.overlay {
  background: #1e1530;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px;
  padding: 10px 14px 12px;
  width: 378px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  position: relative;
}

/* Titlebar */
.ov-titlebar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px; -webkit-app-region: drag;
}
.ov-drag-handle {
  font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.3);
  letter-spacing: .5px; text-transform: uppercase;
}
.ov-pin {
  -webkit-app-region: no-drag;
  background: none; border: none; cursor: pointer;
  font-size: 14px; opacity: 0.3; padding: 0 2px;
  transition: opacity 0.15s;
  line-height: 1;
}
.ov-pin:hover { opacity: 0.7; }
.ov-pin.pinned { opacity: 1; filter: none; }

/* Language bar */
.ov-langs {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
}
.ov-lang-wrap { flex: 1; position: relative; }
.ov-lang-btn {
  width: 100%; padding: 5px 10px;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.8); border-radius: 8px;
  font-size: 12px; cursor: pointer; font-family: inherit;
  text-align: center; transition: background 0.15s; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.ov-lang-btn:hover { background: rgba(255,255,255,0.13); }

.ov-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0;
  background: #2a2040; border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px; overflow: hidden; z-index: 100;
  min-width: 140px; max-height: 220px; overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
}
.ov-dropdown-right { left: auto; right: 0; }
.ov-opt {
  padding: 7px 14px; font-size: 12px; color: rgba(255,255,255,0.75);
  cursor: pointer; transition: background 0.1s; white-space: nowrap;
}
.ov-opt:hover { background: rgba(255,255,255,0.08); color: #fff; }
.ov-opt.selected { background: rgba(99,102,241,0.25); color: #a78bfa; font-weight: 600; }

.ov-swap {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.55); border-radius: 6px; padding: 5px 8px;
  font-size: 13px; cursor: pointer; flex-shrink: 0; line-height: 1;
  transition: background 0.15s;
}
.ov-swap:hover { background: rgba(255,255,255,0.14); color: #fff; }

/* Recent lookups */
.ov-recents {
  display: flex; align-items: flex-start; gap: 6px; margin-bottom: 8px;
}
.ov-recents-label {
  font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.25);
  text-transform: uppercase; letter-spacing: .4px; flex-shrink: 0; margin-top: 4px;
}
.ov-recents-list {
  display: flex; flex-wrap: wrap; gap: 4px; flex: 1;
}
.ov-recent-chip {
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.55); border-radius: 6px;
  font-size: 11px; padding: 2px 8px; cursor: pointer;
  font-family: inherit; transition: all 0.12s; white-space: nowrap;
  max-width: 140px; overflow: hidden; text-overflow: ellipsis;
}
.ov-recent-chip:hover { background: rgba(255,255,255,0.13); color: rgba(255,255,255,0.9); }
.ov-recent-chip.active { background: rgba(99,102,241,0.2); color: #a78bfa; border-color: rgba(99,102,241,0.3); }

.ov-word {
  font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 5px;
  word-break: break-word;
}
.ov-translation {
  font-size: 14px; color: rgba(255,255,255,0.88);
  line-height: 1.55; margin-bottom: 10px; min-height: 20px;
}
.ov-translation.loading { color: rgba(255,255,255,0.4); font-style: italic; }

.ov-actions {
  display: flex; align-items: center; gap: 5px; justify-content: flex-end;
}
.ov-btn {
  background: rgba(255,255,255,0.08); border: none;
  color: rgba(255,255,255,0.65); font-size: 11px;
  padding: 4px 9px; border-radius: 6px; cursor: pointer;
  font-family: inherit; transition: background 0.15s;
}
.ov-btn:hover { background: rgba(255,255,255,0.16); color: #fff; }
.ov-save   { color: #ffd066; }
.ov-save:hover { background: rgba(255,208,102,0.15); color: #ffd066; }
.ov-unsave { color: #ff9a9a; }
.ov-unsave:hover { background: rgba(255,154,154,0.15); color: #ff9a9a; }
.ov-close  { color: rgba(255,255,255,0.35); }
</style>
