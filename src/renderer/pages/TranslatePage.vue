<template>
  <div class="tp">
    <!-- Header -->
    <div class="tp-header">
      <!-- Source lang bar -->
      <div class="tp-lang-bar tp-lang-bar-left">
        <button
          v-for="l in quickSourceLangs" :key="l.code"
          class="tp-lang-btn"
          :class="{ active: sl === l.code }"
          @click="setSl(l.code)"
        >{{ l.name }}</button>
        <div class="tp-lang-more-wrap">
          <button class="tp-lang-btn tp-lang-more" @click.stop="showSlMore = !showSlMore" title="更多语言">
            更多 ▾
          </button>
          <div class="tp-dropdown" v-if="showSlMore" @click.stop>
            <div
              class="tp-opt"
              v-for="l in sourceLangsExtra" :key="l.code"
              :class="{ active: sl === l.code }"
              @click="setSl(l.code); showSlMore = false"
            >{{ l.name }}</div>
          </div>
        </div>
      </div>

      <button class="tp-swap" @click="swap" title="互换语言">⇄</button>

      <!-- Target lang bar -->
      <div class="tp-lang-bar tp-lang-bar-right">
        <button
          v-for="l in quickTargetLangs" :key="l.code"
          class="tp-lang-btn"
          :class="{ active: tl === l.code }"
          @click="setTl(l.code)"
        >{{ l.name }}</button>
        <div class="tp-lang-more-wrap">
          <button class="tp-lang-btn tp-lang-more" @click.stop="showTlMore = !showTlMore" title="更多语言">
            更多 ▾
          </button>
          <div class="tp-dropdown tp-dropdown-right" v-if="showTlMore" @click.stop>
            <div
              class="tp-opt"
              v-for="l in targetLangsExtra" :key="l.code"
              :class="{ active: tl === l.code }"
              @click="setTl(l.code); showTlMore = false"
            >{{ l.name }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- History drawer -->
    <div class="tp-history" v-if="history.length">
      <div class="tp-history-title">最近翻译</div>
      <div class="tp-history-list">
        <div
          class="tp-history-item"
          v-for="(h, i) in history" :key="i"
          @click="loadHistory(h)"
        >
          <span class="tp-history-src">{{ h.src }}</span>
          <span class="tp-history-sep">→</span>
          <span class="tp-history-res">{{ h.res }}</span>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="tp-body">
      <!-- Left: source input -->
      <div class="tp-panel tp-left">
        <textarea
          class="tp-textarea"
          v-model="sourceText"
          placeholder="输入或粘贴文本进行翻译…"
          @input="onInput"
          ref="srcRef"
        ></textarea>
        <div class="tp-panel-footer">
          <span class="tp-char-count" :class="{ warn: sourceText.length > 4500 }">
            {{ sourceText.length }} / 5000
          </span>
          <button class="tp-clear" v-if="sourceText" @click="clear" title="清除">✕</button>
          <button class="tp-tts" @click="speakSrc" title="朗读原文">🔊</button>
        </div>
      </div>

      <!-- Divider -->
      <div class="tp-divider"></div>

      <!-- Right: translation output -->
      <div class="tp-panel tp-right">
        <div class="tp-result" :class="{ loading: translating }">
          <span v-if="translating" class="tp-loading-text">翻译中…</span>
          <span v-else-if="resultText">{{ resultText }}</span>
          <span v-else class="tp-placeholder">翻译结果将显示在这里</span>
        </div>
        <div class="tp-panel-footer">
          <button class="tp-tts" @click="speakResult" title="朗读译文" v-if="resultText">🔊</button>
          <button class="tp-copy" @click="copyResult" title="复制" v-if="resultText">
            {{ copied ? '✓ 已复制' : '复制' }}
          </button>
          <button class="tp-save" @click="saveWord" v-if="resultText && sourceText.trim().split(/\s+/).length <= 3" title="收藏到生词本">
            {{ savedWord ? '✓ 已收藏' : '⭐ 收藏' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useTTS } from '../composables/useTTS.js';

const { speak: ttsSpeak } = useTTS();
const sourceText = ref('');
const resultText = ref('');
const translating = ref(false);
const copied = ref(false);
const savedWord = ref(false);
const history = ref([]);

const sl = ref('auto');
const tl = ref('zh-CN');
const showSlMore = ref(false);
const showTlMore = ref(false);

let debounceTimer = null;
const srcRef = ref(null);

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

const quickSourceLangs = [
  { code: 'auto', name: '自动' },
  { code: 'en',   name: '英语' },
  { code: 'zh-CN', name: '中文' },
  { code: 'ja',   name: '日语' },
];
const quickTargetLangs = [
  { code: 'zh-CN', name: '中文' },
  { code: 'en',    name: '英语' },
  { code: 'ja',    name: '日语' },
];
const quickSourceCodes = new Set(quickSourceLangs.map(l => l.code));
const quickTargetCodes = new Set(quickTargetLangs.map(l => l.code));
const sourceLangsExtra = sourceLangs.filter(l => !quickSourceCodes.has(l.code));
const targetLangsExtra = targetLangs.filter(l => !quickTargetCodes.has(l.code));

onMounted(async () => {
  const settings = await window.vocaAPI.loadSettings();
  sl.value = settings.sourceLang || 'auto';
  tl.value = settings.targetLang || 'zh-CN';
  document.addEventListener('click', () => { showSlMore.value = false; showTlMore.value = false; });
});

// Called from parent when ↗ is clicked in overlay
function setText(text) {
  sourceText.value = text;
  savedWord.value = false;
  copied.value = false;
  triggerTranslate();
  srcRef.value?.focus();
}

defineExpose({ setText });

function loadHistory(h) {
  sourceText.value = h.fullSrc;
  resultText.value = h.fullRes;
  savedWord.value = false;
  copied.value = false;
}

function setSl(code) { sl.value = code; triggerTranslate(); }
function setTl(code) { tl.value = code; triggerTranslate(); }

function swap() {
  if (sl.value === 'auto') return;
  [sl.value, tl.value] = [tl.value, sl.value];
  triggerTranslate();
}

function onInput() {
  savedWord.value = false;
  if (!sourceText.value.trim()) { resultText.value = ''; return; }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(triggerTranslate, 600);
}

async function triggerTranslate() {
  const txt = sourceText.value.trim();
  if (!txt) { resultText.value = ''; return; }
  translating.value = true;
  resultText.value = '';
  const res = await window.vocaAPI.translate(txt, sl.value, tl.value);
  const text = res.success ? res.text : ('翻译失败：' + res.error);
  resultText.value = text;
  translating.value = false;
  if (res.success && txt) {
    const entry = { src: txt.length > 30 ? txt.slice(0, 30) + '…' : txt, res: text.length > 30 ? text.slice(0, 30) + '…' : text, fullSrc: txt, fullRes: text };
    history.value = [entry, ...history.value.filter(h => h.fullSrc !== txt)].slice(0, 10);
  }
}

function clear() {
  sourceText.value = '';
  resultText.value = '';
  savedWord.value = false;
  copied.value = false;
  srcRef.value?.focus();
}

function speakSrc() {
  ttsSpeak(sourceText.value, sl.value === 'auto' ? 'en-US' : sl.value);
}

function speakResult() {
  ttsSpeak(resultText.value, tl.value);
}

async function copyResult() {
  if (!resultText.value) return;
  await navigator.clipboard.writeText(resultText.value);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

async function saveWord() {
  const word = sourceText.value.trim().toLowerCase();
  if (!word || !resultText.value) return;
  const words = await window.vocaAPI.loadWords();
  if (!words[word]) {
    words[word] = { word: sourceText.value.trim(), translation: resultText.value, timestamp: Date.now(), reviewCount: 0 };
    await window.vocaAPI.saveWords(words);
    window.vocaAPI.notifyWordsUpdated();
  }
  savedWord.value = true;
}
</script>

<style scoped>
.tp {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  background: #f5f5f7;
}

/* History */
.tp-history {
  background: #fff; border-bottom: 1px solid #e8e8e8;
  padding: 8px 16px; flex-shrink: 0;
}
.tp-history-title {
  font-size: 10px; font-weight: 700; color: #bbb; text-transform: uppercase;
  letter-spacing: .4px; margin-bottom: 4px;
}
.tp-history-list {
  display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: none;
}
.tp-history-list::-webkit-scrollbar { display: none; }
.tp-history-item {
  display: flex; align-items: center; gap: 4px;
  background: #f5f5f7; border-radius: 8px; padding: 4px 10px;
  font-size: 12px; cursor: pointer; flex-shrink: 0; max-width: 220px;
  transition: background 0.12s;
}
.tp-history-item:hover { background: rgba(99,102,241,0.08); }
.tp-history-src { color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80px; }
.tp-history-sep { color: #bbb; flex-shrink: 0; }
.tp-history-res { color: #6366f1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 80px; }

/* Header */
.tp-header {
  display: flex; align-items: center; gap: 0;
  background: #fff; border-bottom: 1px solid #e8e8e8;
  padding: 0 16px; height: 48px; flex-shrink: 0;
}
.tp-lang-bar {
  flex: 1; display: flex; align-items: center; gap: 2px; overflow: hidden;
}
.tp-lang-btn {
  padding: 5px 14px; border: none; background: transparent;
  font-size: 13px; font-weight: 500; color: #666; cursor: pointer;
  border-radius: 6px; font-family: inherit; white-space: nowrap;
  transition: background 0.12s, color 0.12s;
}
.tp-lang-btn:hover { background: #f0f0f5; color: #333; }
.tp-lang-btn.active { color: #6366f1; font-weight: 700; background: rgba(99,102,241,0.08); }
.tp-lang-more { padding: 5px 8px; color: #aaa; }

.tp-lang-more-wrap { position: relative; }
.tp-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 200;
  background: #fff; border: 1px solid #e8e8e8; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); min-width: 130px;
  max-height: 240px; overflow-y: auto;
}
.tp-dropdown-right { left: auto; right: 0; }
.tp-opt {
  padding: 8px 16px; font-size: 13px; color: #444; cursor: pointer;
  transition: background 0.1s;
}
.tp-opt:hover { background: #f5f5f7; }
.tp-opt.active { color: #6366f1; font-weight: 600; background: rgba(99,102,241,0.06); }

.tp-swap {
  flex-shrink: 0; margin: 0 8px;
  background: #f0f0f5; border: none; border-radius: 8px;
  padding: 6px 10px; font-size: 15px; cursor: pointer; color: #666;
  transition: background 0.15s;
}
.tp-swap:hover { background: #e8e8f0; color: #6366f1; }

/* Body */
.tp-body {
  flex: 1; display: flex; overflow: hidden;
}
.tp-panel {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}
.tp-divider { width: 1px; background: #e8e8e8; flex-shrink: 0; }

.tp-textarea {
  flex: 1; padding: 20px 24px; border: none; outline: none; resize: none;
  font-size: 16px; color: #1a1a1a; line-height: 1.65; font-family: inherit;
  background: #fff;
}
.tp-textarea::placeholder { color: #bbb; }

.tp-result {
  flex: 1; padding: 20px 24px; font-size: 16px; line-height: 1.65;
  color: #1a1a1a; overflow-y: auto; background: #fafafa; white-space: pre-wrap;
  word-break: break-word;
}
.tp-result.loading { color: #aaa; font-style: italic; }
.tp-loading-text { color: #aaa; font-style: italic; }
.tp-placeholder { color: #ccc; }

.tp-panel-footer {
  display: flex; align-items: center; gap: 8px; justify-content: flex-end;
  padding: 8px 16px; border-top: 1px solid #f0f0f0; flex-shrink: 0;
  background: inherit; min-height: 40px;
}
.tp-char-count { font-size: 12px; color: #bbb; margin-right: auto; }
.tp-char-count.warn { color: #e74c3c; }

.tp-clear, .tp-tts, .tp-copy, .tp-save {
  background: none; border: none; cursor: pointer; font-size: 12px;
  color: #aaa; padding: 3px 8px; border-radius: 6px;
  font-family: inherit; transition: background 0.12s, color 0.12s;
}
.tp-clear:hover, .tp-tts:hover { background: #f0f0f5; color: #555; }
.tp-copy { font-weight: 600; }
.tp-copy:hover { background: #f0f0f5; color: #6366f1; }
.tp-save { color: #e6a817; font-weight: 600; }
.tp-save:hover { background: rgba(230,168,23,0.08); }
</style>
