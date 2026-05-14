<template>
  <div class="settings-page">
    <div class="page-header">
      <h1>设置</h1>
    </div>

    <!-- 内部标签栏 -->
    <div class="s-tabs">
      <button class="s-tab" :class="{ active: stab === 'general' }" @click="stab = 'general'">基本设置</button>
      <button class="s-tab" :class="{ active: stab === 'presets' }" @click="stab = 'presets'">预设词表</button>
      <button class="s-tab" :class="{ active: stab === 'maintenance' }" @click="openMaintenance">维护</button>
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

      <!-- 同步与备份 -->
      <section class="s-section">
        <h2 class="s-title">同步与备份</h2>
        <div class="s-card">
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">浏览器插件同步</span>
              <span class="s-desc">
                {{ syncStatus.running ? `本地同步服务运行中：127.0.0.1:${syncStatus.port}` : `同步服务未启动${syncStatus.error ? '：' + syncStatus.error : ''}` }}
              </span>
              <span class="s-desc" v-if="syncStatus.lastSyncAt">
                最近同步：{{ formatBackupTime(syncStatus.lastSyncAt) }}，{{ syncStatus.lastSyncSummary }}
              </span>
            </div>
            <button class="s-btn-preview" @click="refreshSyncStatus">刷新</button>
          </div>
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">词书冲突处理</span>
              <span class="s-desc">网页端与桌面端存在同名词条时如何处理</span>
            </div>
            <select class="s-select s-select-wide" v-model="settings.syncConflictStrategy">
              <option value="merge">合并：保留桌面端，补充空翻译</option>
              <option value="overwrite">网页端覆盖桌面端</option>
              <option value="skip">跳过已有词条</option>
            </select>
          </div>
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">数据备份</span>
              <span class="s-desc">每次保存前自动保留最近 20 份数据快照</span>
            </div>
            <button class="s-btn-preview" @click="loadBackups">查看备份</button>
          </div>
          <div class="backup-list" v-if="showBackups">
            <div class="backup-empty" v-if="!backups.length">暂无可恢复的备份</div>
            <div class="backup-item" v-for="b in backups" :key="b.path">
              <div>
                <div class="backup-name">{{ formatBackupTime(b.time) }}</div>
                <div class="backup-meta">{{ Math.max(1, Math.round(b.size / 1024)) }} KB</div>
              </div>
              <button class="s-btn-restore" @click="restoreBackup(b)">恢复</button>
            </div>
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
        <span class="save-hint" v-if="notice">{{ notice }}</span>
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

    <!-- 维护 -->
    <template v-if="stab === 'maintenance'">
      <section class="s-section">
        <h2 class="s-title">版本更新</h2>
        <div class="s-card">
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">检查 GitHub Release</span>
              <span class="s-desc">{{ updateText }}</span>
            </div>
            <button class="s-btn-preview" @click="checkUpdates" :disabled="checkingUpdate">
              {{ checkingUpdate ? '检查中…' : '检查更新' }}
            </button>
            <button class="s-btn-restore" v-if="updateInfo?.url" @click="openUpdatePage">打开</button>
          </div>
        </div>
      </section>

      <section class="s-section">
        <h2 class="s-title">数据体检</h2>
        <div class="s-card">
          <div class="health-grid" v-if="health">
            <div class="health-item"><b>{{ health.bookCount }}</b><span>词书</span></div>
            <div class="health-item"><b>{{ health.totalWords }}</b><span>单词</span></div>
            <div class="health-item"><b>{{ health.emptyTranslations }}</b><span>空翻译</span></div>
            <div class="health-item"><b>{{ health.duplicateAcrossBooks }}</b><span>跨词书重复</span></div>
            <div class="health-item"><b>{{ health.flashOrphans }}</b><span>闪卡孤儿项</span></div>
            <div class="health-item"><b>{{ health.backupCount }}</b><span>备份</span></div>
          </div>
          <div class="s-row">
            <div class="s-row-body">
              <span class="s-label">自动修复</span>
              <span class="s-desc">清理无效单词、修复缺失 key、移除闪卡池孤儿项</span>
            </div>
            <button class="s-btn-preview" @click="refreshHealth">重新体检</button>
            <button class="s-btn-restore" @click="repairHealth">修复</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { TIER1, TIER2, TIER3 } from '../shared/wordFrequency.js';
import { WORD_BOOKS } from '../shared/wordBooks.js';

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
const notice = ref('');
const importingId = ref(null);
const loginItem = ref(false);
const syncStatus = ref({ running: false, port: 27149, error: '' });
const backups = ref([]);
const showBackups = ref(false);
const health = ref(null);
const updateInfo = ref(null);
const checkingUpdate = ref(false);

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
  { id: 'tier1', name: 'A1 入门词汇', words: [...TIER1].sort() },
  { id: 'a2', name: 'A2 初级词汇', words: [...WORD_BOOKS.a2].sort() },
  { id: 'tier2', name: 'B1 中级词汇', words: [...TIER2].sort() },
  { id: 'b2', name: 'B2 中高级词汇', words: [...WORD_BOOKS.b2].sort() },
  { id: 'tier3', name: 'C1 高级词汇', words: [...TIER3].sort() },
  { id: 'c2', name: 'C2 精通词汇', words: [...WORD_BOOKS.c2].sort() },
  { id: 'cet4', name: 'CET4 四级词汇', words: [...WORD_BOOKS.cet4].sort() },
  { id: 'cet6', name: 'CET6 六级词汇', words: [...WORD_BOOKS.cet6].sort() },
  { id: 'ielts', name: 'IELTS 学术词汇', words: [...WORD_BOOKS.ielts].sort() },
  { id: 'toefl', name: 'TOEFL 核心词汇', words: [...WORD_BOOKS.toefl].sort() },
  { id: 'gre', name: 'GRE 高频词汇', words: [...WORD_BOOKS.gre].sort() },
  { id: 'sat', name: 'SAT 常考词汇', words: [...WORD_BOOKS.sat].sort() },
];

onMounted(async () => {
  settings.value = await window.vocaAPI.loadSettings();
  if (!settings.value.ttsVoice) settings.value.ttsVoice = '';
  loginItem.value = await window.vocaAPI.getLoginItem();
  await refreshSyncStatus();
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
});

const updateText = computed(() => {
  if (!updateInfo.value) return '尚未检查更新';
  if (!updateInfo.value.success) return `检查失败：${updateInfo.value.error}`;
  if (updateInfo.value.hasUpdate) return `发现新版本 ${updateInfo.value.latestVersion}，当前版本 ${updateInfo.value.currentVersion}`;
  return `已是最新版本：${updateInfo.value.currentVersion}`;
});

function showNotice(text) {
  notice.value = text;
  setTimeout(() => { notice.value = ''; }, 2200);
}

async function refreshSyncStatus() {
  syncStatus.value = await window.vocaAPI.getSyncStatus();
}

async function openMaintenance() {
  stab.value = 'maintenance';
  await Promise.all([refreshSyncStatus(), refreshHealth()]);
}

async function refreshHealth() {
  health.value = await window.vocaAPI.inspectData();
}

async function repairHealth() {
  const res = await window.vocaAPI.repairData();
  if (res?.success) {
    health.value = res.summary;
    showNotice(`✓ 已修复：移除 ${res.removedFlashOrphans} 个闪卡孤儿项`);
  } else {
    showNotice('修复失败');
  }
}

async function checkUpdates() {
  checkingUpdate.value = true;
  updateInfo.value = await window.vocaAPI.checkForUpdates();
  checkingUpdate.value = false;
}

function openUpdatePage() {
  window.vocaAPI.openExternal(updateInfo.value.url);
}

async function loadBackups() {
  showBackups.value = !showBackups.value;
  if (showBackups.value) backups.value = await window.vocaAPI.listBackups();
}

function formatBackupTime(time) {
  return new Date(time).toLocaleString();
}

async function restoreBackup(backup) {
  if (!confirm(`确认恢复到 ${formatBackupTime(backup.time)} 的备份？\n当前数据会先自动备份一份。`)) return;
  const res = await window.vocaAPI.restoreBackup(backup.path);
  if (res?.success) {
    backups.value = await window.vocaAPI.listBackups();
    showNotice('✓ 已恢复备份，回到生词本即可查看');
  } else {
    showNotice('恢复失败');
  }
}

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
  showNotice(`✓ 已导入「${preset.name}」`);
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

.backup-list {
  border-top: 1px solid #f0f0f0;
  background: #fafaff;
  max-height: 220px;
  overflow-y: auto;
}
.backup-empty {
  padding: 14px 16px;
  font-size: 13px;
  color: #999;
}
.backup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
}
.backup-item:last-child { border-bottom: none; }
.backup-name { font-size: 13px; font-weight: 600; color: #333; }
.backup-meta { font-size: 11px; color: #999; margin-top: 2px; }
.s-btn-restore {
  padding: 5px 12px;
  background: #fff;
  color: #6366f1;
  border: 1.5px solid rgba(99,102,241,0.3);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.s-btn-restore:hover { background: rgba(99,102,241,0.08); }

.health-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: #f0f0f0;
}
.health-item {
  background: #fff;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.health-item b {
  font-size: 22px;
  color: #1a1a1a;
  line-height: 1;
}
.health-item span {
  font-size: 12px;
  color: #999;
}

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
