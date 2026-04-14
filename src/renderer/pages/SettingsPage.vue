<template>
  <div class="settings-page">
    <div class="page-header">
      <h1>设置</h1>
    </div>

    <!-- 内部标签栏 -->
    <div class="s-tabs">
      <button class="s-tab" :class="{ active: stab === 'general' }" @click="stab = 'general'">基本设置</button>
      <button class="s-tab" :class="{ active: stab === 'presets' }" @click="stab = 'presets'">预设词表</button>
    </div>

    <!-- 基本设置 -->
    <template v-if="stab === 'general'">
      <!-- 翻译 API -->
      <section class="s-section">
        <h2 class="s-title">翻译 API</h2>
        <div class="s-card">
          <label class="s-row" v-for="api in apis" :key="api.id">
            <input type="radio" v-model="settings.translateApi" :value="api.id" />
            <div class="s-row-body">
              <span class="s-label">{{ api.name }}</span>
              <span class="s-desc">{{ api.desc }}</span>
            </div>
          </label>
          <div class="s-row s-key-row" v-if="settings.translateApi === 'deepl'">
            <span class="s-label">DeepL API Key</span>
            <input
              class="s-input"
              v-model="settings.deeplKey"
              placeholder="在 deepl.com/pro 申请免费 Key"
              type="password"
            />
          </div>
        </div>
      </section>

      <!-- 默认语言 -->
      <section class="s-section">
        <h2 class="s-title">默认语言</h2>
        <div class="s-card">
          <div class="s-row">
            <span class="s-label">源语言</span>
            <select class="s-select" v-model="settings.sourceLang">
              <option v-for="l in sourceLangs" :key="l.code" :value="l.code">{{ l.name }}</option>
            </select>
          </div>
          <div class="s-row">
            <span class="s-label">目标语言</span>
            <select class="s-select" v-model="settings.targetLang">
              <option v-for="l in targetLangs" :key="l.code" :value="l.code">{{ l.name }}</option>
            </select>
          </div>
        </div>
      </section>

      <!-- 开机自启 -->
      <section class="s-section">
        <h2 class="s-title">系统</h2>
        <div class="s-card">
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">开机自动启动</span>
              <span class="s-desc">登录系统后自动在后台启动 Voca</span>
            </div>
            <label class="s-toggle">
              <input type="checkbox" v-model="loginItem" @change="toggleLoginItem" />
              <span class="s-toggle-track"></span>
            </label>
          </div>
        </div>
      </section>

      <!-- 学习目标 -->
      <section class="s-section">
        <h2 class="s-title">学习目标</h2>
        <div class="s-card">
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">每日复习目标</span>
              <span class="s-desc">每天完成闪卡复习的单词数</span>
            </div>
            <input
              class="s-input s-input-num"
              type="number"
              min="1" max="200"
              v-model.number="settings.dailyGoal"
            />
          </div>
        </div>
      </section>

      <!-- 朗读声音 -->
      <section class="s-section">
        <h2 class="s-title">朗读声音</h2>
        <div class="s-card">
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">英语朗读声音</span>
              <span class="s-desc">使用系统已安装的 TTS 语音</span>
            </div>
            <select class="s-select s-select-wide" v-model="settings.ttsVoice">
              <option value="">系统默认</option>
              <optgroup label="英语" v-if="enVoices.length">
                <option v-for="v in enVoices" :key="v.name" :value="v.name">{{ v.name }}</option>
              </optgroup>
              <optgroup label="其他" v-if="otherVoices.length">
                <option v-for="v in otherVoices" :key="v.name" :value="v.name">{{ v.name }}</option>
              </optgroup>
            </select>
          </div>
          <div class="s-row s-voice-preview">
            <span class="s-label">试听</span>
            <button class="s-btn-preview" @click="previewVoice">🔊 播放示例</button>
            <span class="s-desc" style="margin-left:8px">{{ settings.ttsVoice || '系统默认' }}</span>
          </div>
        </div>
      </section>

      <div class="s-actions">
        <button class="btn-save" @click="save">保存设置</button>
        <span class="save-hint" v-if="saved">✓ 已保存</span>
      </div>
    </template>

    <!-- 预设词表 -->
    <template v-if="stab === 'presets'">
      <p class="s-hint">导入后将在书架中创建新生词本，翻译需通过划词翻译逐词查询。</p>
      <div class="s-card">
        <div class="s-row" v-for="preset in presets" :key="preset.id">
          <div class="s-row-body">
            <span class="s-label">{{ preset.name }}</span>
            <span class="s-desc">{{ preset.words.length }} 个核心词</span>
          </div>
          <button
            class="s-btn-import"
            @click="importPreset(preset)"
            :disabled="importingId === preset.id"
          >{{ importingId === preset.id ? '导入中…' : '导入' }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const emit = defineEmits(['preset-imported']);

const stab = ref('general');

const settings = ref({
  translateApi: 'google',
  deeplKey: '',
  sourceLang: 'auto',
  targetLang: 'zh-CN',
  ttsVoice: '',
  dailyGoal: 10,
});
const saved = ref(false);
const importingId = ref(null);
const loginItem = ref(false);

// TTS voices
const allVoices = ref([]);

function loadVoices() {
  const vs = speechSynthesis.getVoices();
  if (vs.length) allVoices.value = vs;
}

const enVoices = computed(() =>
  allVoices.value.filter(v => v.lang.startsWith('en'))
);
const otherVoices = computed(() =>
  allVoices.value.filter(v => !v.lang.startsWith('en'))
);

function previewVoice() {
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance('The quick brown fox jumps over the lazy dog.');
  utt.lang = 'en-US';
  if (settings.value.ttsVoice) {
    const voice = allVoices.value.find(v => v.name === settings.value.ttsVoice);
    if (voice) utt.voice = voice;
  }
  speechSynthesis.speak(utt);
}

const apis = [
  { id: 'google',   name: 'Google 翻译', desc: '免费，无需 Key，国内可能需代理' },
  { id: 'deepl',    name: 'DeepL',       desc: '质量更高，免费版每月 50 万字符' },
  { id: 'mymemory', name: 'MyMemory',    desc: '完全免费，支持多语言' },
];

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

const presets = [
  {
    id: 'ielts',
    name: 'IELTS 学术词汇',
    words: [
      'abandon','abstract','access','accommodate','accompany','accumulate','accurate','achieve',
      'acknowledge','acquire','adapt','adequate','adjacent','advocate','aggregate','allocate',
      'alter','ambiguous','analyze','anticipate','apparent','approximate','arbitrary','aspect',
      'assess','assign','assist','assume','assure','attain','attribute','author','benefit',
      'capacity','category','cease','challenge','circumstance','cite','clarify','classic',
      'coefficient','coherent','coincide','collapse','colleague','commence','commission',
      'commit','communicate','community','compensate','compile','complement','component',
      'comprehensive','concentrate','concept','conclude','conduct','confer','consequent',
      'considerable','constitute','construct','consume','context','contradict','contribute',
      'controversy','convert','cooperate','criteria','crucial','culture','deduce','definite',
    ],
  },
  {
    id: 'toefl',
    name: 'TOEFL 核心词汇',
    words: [
      'abolish','absorb','accelerate','acclaim','accomplish','accumulate','accurate','achieve',
      'acknowledge','acquire','adequate','adjacent','advocate','affect','aggregate','alter',
      'ambiguous','analyze','assert','assess','assume','attribute','augment','beneficial',
      'capacity','category','coherent','collapse','compensate','compile','comprehensive',
      'concentrate','conclude','confer','considerable','constitute','contrast','controversy',
      'convert','crucial','deduce','demonstrate','depict','derive','designate','despite',
      'detect','determine','develop','diminish','displace','distinct','distribute','dominate',
      'eliminate','emerge','emphasize','enable','enhance','ensure','establish','evaluate',
      'evolve','exclude','expand','exploit','expose','extent','facilitate','feature','flexible',
    ],
  },
  {
    id: 'gre',
    name: 'GRE 高频词汇',
    words: [
      'abjure','abscond','acquiesce','acrimony','acumen','adumbrate','alacrity','amalgamate',
      'ameliorate','anachronism','anodyne','antipathy','apocryphal','apotheosis','approbation',
      'arcane','arduous','arrogate','ascetic','assuage','audacious','auspicious','aver',
      'banal','belabor','belie','bellicose','bombast','bucolic','burgeon','cacophony',
      'capricious','castigate','censure','chicanery','clemency','coalesce','compunction',
      'confound','convoluted','craven','cupidity','daunt','dearth','debacle','decry',
      'deferential','deleterious','desultory','diatribe','didactic','diffident','discern',
      'discomfit','disinterested','disparage','dissemble','dogmatic','ebullient','enervate',
      'ephemeral','equivocate','erudite','esoteric','exacerbate','exculpate','exiguous',
    ],
  },
];

onMounted(async () => {
  settings.value = await window.vocaAPI.loadSettings();
  if (!settings.value.ttsVoice) settings.value.ttsVoice = '';
  loginItem.value = await window.vocaAPI.getLoginItem();
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
});

async function toggleLoginItem() {
  await window.vocaAPI.setLoginItem(loginItem.value);
}

async function save() {
  await window.vocaAPI.saveSettings(settings.value);
  saved.value = true;
  setTimeout(() => { saved.value = false; }, 2000);
}

async function importPreset(preset) {
  importingId.value = preset.id;
  const data = await window.vocaAPI.loadData();
  const bookId = `preset_${preset.id}_${Date.now()}`;
  const words = {};
  for (const w of preset.words) {
    words[w.toLowerCase()] = { word: w, translation: '', timestamp: Date.now(), reviewCount: 0 };
  }
  data.books[bookId] = { name: preset.name, words };
  await window.vocaAPI.saveData(data);
  importingId.value = null;
  emit('preset-imported', bookId);
  alert(`已导入「${preset.name}」(${preset.words.length} 词) 到书架`);
}
</script>

<style scoped>
.settings-page { padding: 28px 32px; max-width: 680px; }
.page-header { margin-bottom: 20px; }
.page-header h1 { font-size: 22px; font-weight: 700; }

/* Tabs */
.s-tabs {
  display: flex; gap: 0; margin-bottom: 24px;
  border-bottom: 2px solid #f0f0f0;
}
.s-tab {
  padding: 8px 20px; border: none; background: transparent;
  font-size: 14px; font-weight: 600; color: #999; cursor: pointer;
  font-family: inherit; border-bottom: 2px solid transparent;
  margin-bottom: -2px; transition: color 0.15s, border-color 0.15s;
}
.s-tab:hover { color: #555; }
.s-tab.active { color: #6366f1; border-bottom-color: #6366f1; }

.s-section { margin-bottom: 28px; }
.s-title { font-size: 13px; font-weight: 700; color: #555; text-transform: uppercase;
  letter-spacing: .5px; margin-bottom: 10px; }
.s-hint { font-size: 12px; color: #999; margin-bottom: 8px; }

.s-card {
  background: #fff; border-radius: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06); overflow: hidden;
}
.s-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid #f0f0f0; cursor: default;
}
.s-row:last-child { border-bottom: none; }
.s-row-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.s-label { font-size: 14px; color: #1a1a1a; font-weight: 500; }
.s-desc  { font-size: 12px; color: #999; }

.s-select, .s-input {
  margin-left: auto; padding: 5px 10px;
  border: 1.5px solid #e0e0e0; border-radius: 8px;
  font-size: 13px; outline: none; background: #fafafa;
  font-family: inherit; transition: border-color .15s;
}
.s-select:focus, .s-input:focus { border-color: #6366f1; }
.s-select { width: 160px; }
.s-select-wide { width: 240px; }
.s-input  { width: 260px; }
.s-input-num { width: 80px; text-align: center; }
.s-key-row { background: #fafaff; }
.s-voice-preview { background: #fafaff; }
.s-btn-preview {
  padding: 4px 12px; background: #6366f1; color: #fff;
  border: none; border-radius: 7px; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background .15s;
}
.s-btn-preview:hover { background: #4f52d3; }

.s-btn-import {
  padding: 5px 14px; background: #6366f1; color: #fff;
  border: none; border-radius: 8px; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background .15s; flex-shrink: 0;
}
.s-btn-import:hover { background: #4f52d3; }
.s-btn-import:disabled { background: #aaa; cursor: not-allowed; }

.s-toggle { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; }
.s-toggle input { opacity: 0; width: 0; height: 0; }
.s-toggle-track {
  position: absolute; inset: 0; background: #ddd; border-radius: 12px;
  cursor: pointer; transition: background 0.2s;
}
.s-toggle input:checked + .s-toggle-track { background: #6366f1; }
.s-toggle-track::after {
  content: ''; position: absolute; width: 18px; height: 18px;
  background: #fff; border-radius: 50%; top: 3px; left: 3px;
  transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.s-toggle input:checked + .s-toggle-track::after { transform: translateX(18px); }

.s-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.btn-save {
  padding: 9px 24px; background: #6366f1; color: #fff;
  border: none; border-radius: 10px; font-size: 14px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background .15s;
}
.btn-save:hover { background: #4f52d3; }
.save-hint { font-size: 13px; color: #27ae60; }
</style>
