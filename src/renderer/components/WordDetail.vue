<template>
  <div class="wd">
    <!-- Back bar -->
    <div class="wd-back" @click="$emit('close')">
      <span class="wd-back-arrow">←</span>
      <span class="wd-back-label">返回单词本</span>
    </div>

    <div class="wd-body">
      <!-- Word hero -->
      <div class="wd-hero">
        <div class="wd-hero-left">
          <div class="wd-word">{{ word.word }}</div>
          <div class="wd-phonetic" v-if="detail?.phonetic">{{ detail.phonetic }}</div>
          <button class="wd-tts" @click="speak">🔊 朗读</button>
        </div>
        <div class="wd-hero-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
          <span class="wd-badge" :class="memClass">{{ memLabel }}</span>
          <button class="wd-save-btn" :class="{ saved: isSaved }" @click="isSaved ? emit('unsave', word) : emit('save', word)">
            {{ isSaved ? '✕ 取消收藏' : '⭐ 收藏' }}
          </button>
        </div>
      </div>

      <!-- Translation -->
      <div class="wd-section">
        <div class="wd-section-title">翻译</div>
        <div class="wd-trans-row">
          <div v-if="!editingTrans" class="wd-trans" @dblclick="startEditTrans">
            <span v-if="transLoading" class="wd-trans-loading">翻译中…</span>
            <span v-else>{{ word.translation || '暂无翻译，双击添加' }}</span>
          </div>
          <div v-else class="wd-trans-edit">
            <input
              class="wd-trans-input"
              v-model="transValue"
              @keydown.enter="commitTrans"
              @keydown.esc="editingTrans = false"
              @blur="commitTrans"
              ref="transInputRef"
            />
          </div>
        </div>
        <!-- 多义词 -->
        <div class="wd-meanings-zh" v-if="meanings.length">
          <div class="wd-meaning-zh" v-for="m in meanings" :key="m.pos">
            <span class="wd-pos-zh">{{ m.pos }}</span>
            <span class="wd-trans-chip" v-for="t in m.translations" :key="t" @click="setTrans(t)">{{ t }}</span>
          </div>
        </div>
      </div>

      <!-- Dictionary definitions -->
      <div class="wd-section" v-if="detail?.meanings?.length">
        <div class="wd-section-title">词典释义</div>
        <div class="wd-meanings">
          <div class="wd-meaning" v-for="(m, mi) in detail.meanings" :key="mi">
            <div class="wd-pos">{{ m.partOfSpeech }}</div>
            <ol class="wd-defs">
              <li v-for="(d, di) in m.definitions" :key="di">
                <span class="wd-def-text">{{ d.definition }}</span>
                <span class="wd-example" v-if="d.example">"{{ d.example }}"</span>
              </li>
            </ol>
            <div class="wd-tags" v-if="m.synonyms?.length">
              <span class="wd-tag-label">近义词</span>
              <span class="wd-tag syn" v-for="s in m.synonyms" :key="s" @click="emit('lookup', s)">{{ s }}</span>
            </div>
            <div class="wd-tags" v-if="m.antonyms?.length">
              <span class="wd-tag-label ant">反义词</span>
              <span class="wd-tag ant" v-for="s in m.antonyms" :key="s" @click="emit('lookup', s)">{{ s }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="wd-section" v-else-if="detailLoading">
        <div class="wd-loading">加载释义中…</div>
      </div>

      <!-- Move / copy to book -->
      <div class="wd-section" v-if="bookList.length > 1">
        <div class="wd-section-title">词本操作</div>
        <div class="wd-book-actions">
          <button class="wd-book-btn" @click="showMoveModal = true">移动到其他词本…</button>
          <button class="wd-book-btn wd-book-btn-copy" @click="showCopyModal = true">复制到其他词本…</button>
        </div>
      </div>

      <!-- Learning stats -->
      <div class="wd-section">
        <div class="wd-section-title">学习记录</div>
        <div class="wd-stats">
          <div class="wd-stat">
            <div class="wd-stat-v">{{ word.reviewCount || 0 }}</div>
            <div class="wd-stat-l">复习次数</div>
          </div>
          <div class="wd-stat">
            <div class="wd-stat-v">{{ word.interval || 1 }} 天</div>
            <div class="wd-stat-l">当前间隔</div>
          </div>
          <div class="wd-stat">
            <div class="wd-stat-v">{{ Math.round((word.easeFactor || 2.5) * 100) }}%</div>
            <div class="wd-stat-l">掌握系数</div>
          </div>
          <div class="wd-stat">
            <div class="wd-stat-v">{{ word.lastReview ? fmtDate(word.lastReview) : '未复习' }}</div>
            <div class="wd-stat-l">上次复习</div>
          </div>
          <div class="wd-stat">
            <div class="wd-stat-v">{{ word.nextReview ? fmtDate(word.nextReview) : '—' }}</div>
            <div class="wd-stat-l">下次复习</div>
          </div>
          <div class="wd-stat">
            <div class="wd-stat-v">{{ word.timestamp ? fmtDate(word.timestamp) : '—' }}</div>
            <div class="wd-stat-l">收藏日期</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Move modal -->
  <div class="wd-modal-overlay" v-if="showMoveModal" @click.self="showMoveModal = false">
    <div class="wd-modal">
      <div class="wd-modal-title">移动到</div>
      <div class="wd-modal-list">
        <div
          class="wd-modal-item"
          v-for="b in targetBooks" :key="b.id"
          @click="moveToBook(b.id)"
        >{{ b.name }}</div>
      </div>
      <button class="wd-modal-cancel" @click="showMoveModal = false">取消</button>
    </div>
  </div>

  <!-- Copy modal -->
  <div class="wd-modal-overlay" v-if="showCopyModal" @click.self="showCopyModal = false">
    <div class="wd-modal">
      <div class="wd-modal-title">复制到</div>
      <div class="wd-modal-list">
        <div
          class="wd-modal-item"
          v-for="b in targetBooks" :key="b.id"
          @click="copyToBook(b.id)"
        >{{ b.name }}</div>
      </div>
      <button class="wd-modal-cancel" @click="showCopyModal = false">取消</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useTTS } from '../composables/useTTS.js';

const props = defineProps({ word: Object, books: Object, currentBookId: String, isSaved: Boolean });
const emit = defineEmits(['close', 'update', 'move', 'copy', 'lookup', 'save', 'unsave']);
const { speak: ttsSpeak } = useTTS();

const detail = ref(null);
const detailLoading = ref(false);
const transLoading = ref(false);
const editingTrans = ref(false);
const meanings = ref([]);
const transValue = ref('');
const transInputRef = ref(null);
const showMoveModal = ref(false);
const showCopyModal = ref(false);

const bookList = computed(() => Object.entries(props.books || {}).map(([id, b]) => ({ id, name: b.name })));
const targetBooks = computed(() => bookList.value.filter(b => b.id !== props.currentBookId));

const memLabel = computed(() => {
  const rc = props.word.reviewCount || 0;
  const iv = props.word.interval || 1;
  if (rc === 0) return '🌱 新词';
  if (iv < 7) return '🌿 初记';
  if (iv < 21) return '🌳 熟悉';
  return '💎 掌握';
});
const memClass = computed(() => {
  const rc = props.word.reviewCount || 0;
  const iv = props.word.interval || 1;
  if (rc === 0) return 'badge-new';
  if (iv < 7) return 'badge-learning';
  if (iv < 21) return 'badge-familiar';
  return 'badge-mastered';
});

async function fetchDetail() {
  const w = props.word.word?.trim().toLowerCase();
  if (!w || /\s{2,}/.test(w) || /[\u4e00-\u9fa5]/.test(w)) return;
  detailLoading.value = true;
  const res = await window.vocaAPI.getWordDetail(w);
  detail.value = res.success ? res : null;
  detailLoading.value = false;
}

async function autoTranslate() {
  if (props.word.translation) return;
  const w = props.word.word?.trim();
  if (!w) return;
  transLoading.value = true;
  const settings = await window.vocaAPI.loadSettings();
  const res = await window.vocaAPI.translate(w, 'auto', settings.targetLang || 'zh-CN');
  transLoading.value = false;
  if (res.success && res.text) {
    emit('update', { ...props.word, translation: res.text });
  }
}

async function fetchMeanings() {
  meanings.value = [];
  const w = props.word.word?.trim();
  if (!w || /\s{2,}/.test(w) || /[\u4e00-\u9fa5]/.test(w)) return;
  const settings = await window.vocaAPI.loadSettings();
  const res = await window.vocaAPI.getWordMeanings(w, settings.targetLang || 'zh-CN');
  if (res.success) meanings.value = res.meanings;
}

function setTrans(t) {
  emit('update', { ...props.word, translation: t });
}

onMounted(() => { fetchDetail(); autoTranslate(); fetchMeanings(); });
watch(() => props.word.key, () => { fetchDetail(); autoTranslate(); fetchMeanings(); });

function speak() {
  ttsSpeak(props.word.word, 'en-US');
}

function startEditTrans() {
  transValue.value = props.word.translation || '';
  editingTrans.value = true;
  nextTick(() => transInputRef.value?.focus());
}

function commitTrans() {
  const val = transValue.value.trim();
  editingTrans.value = false;
  if (val !== props.word.translation) {
    emit('update', { ...props.word, translation: val });
  }
}

function moveToBook(targetId) {
  emit('move', { word: props.word, targetId });
  showMoveModal.value = false;
  emit('close');
}

function copyToBook(targetId) {
  emit('copy', { word: props.word, targetId });
  showCopyModal.value = false;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.round((now - d) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === -1) return '明天';
  if (diff < 0) return `${-diff}天后`;
  if (diff < 30) return `${diff}天前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<style scoped>
.wd {
  display: flex; flex-direction: column; height: 100%;
  background: #f5f5f7; overflow: hidden;
}

.wd-back {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 28px; background: #fff; border-bottom: 1px solid #f0f0f0;
  cursor: pointer; flex-shrink: 0;
  transition: background 0.12s;
}
.wd-back:hover { background: #f9f9f9; }
.wd-back-arrow { font-size: 16px; color: #6366f1; font-weight: 700; }
.wd-back-label { font-size: 13px; color: #888; }

.wd-body { flex: 1; overflow-y: auto; padding: 28px 32px; display: flex; flex-direction: column; gap: 24px; }

/* Hero */
.wd-hero {
  display: flex; align-items: flex-start; justify-content: space-between;
  background: #fff; border-radius: 16px; padding: 24px 28px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}
.wd-hero-left { display: flex; flex-direction: column; gap: 6px; }
.wd-word { font-size: 36px; font-weight: 800; color: #1a1a1a; }
.wd-phonetic { font-size: 15px; color: #888; font-style: italic; }
.wd-tts {
  background: none; border: 1.5px solid #e0e0e0; border-radius: 8px;
  padding: 5px 12px; font-size: 13px; cursor: pointer; color: #555;
  font-family: inherit; width: fit-content; transition: border-color 0.12s;
}
.wd-tts:hover { border-color: #6366f1; color: #6366f1; }
.wd-save-btn {
  background: rgba(255,208,102,0.12); border: 1.5px solid rgba(255,208,102,0.4);
  border-radius: 8px; padding: 5px 12px; font-size: 13px; cursor: pointer;
  color: #b8860b; font-family: inherit; transition: all 0.12s;
}
.wd-save-btn:hover { background: rgba(255,208,102,0.25); border-color: #ffd066; color: #996600; }
.wd-save-btn.saved { background: rgba(255,154,154,0.1); border-color: rgba(255,154,154,0.4); color: #c0392b; }
.wd-save-btn.saved:hover { background: rgba(255,154,154,0.2); border-color: #ff9a9a; }
.wd-badge {
  font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 12px;
  margin-top: 4px;
}
.badge-new      { background: #e8f5e9; color: #388e3c; }
.badge-learning { background: #f1f8e9; color: #558b2f; }
.badge-familiar { background: #e3f2fd; color: #1565c0; }
.badge-mastered { background: #fce4ec; color: #c62828; }

/* Sections */
.wd-section {
  background: #fff; border-radius: 16px; padding: 20px 24px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06);
}
.wd-section-title {
  font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase;
  letter-spacing: .5px; margin-bottom: 12px;
}

/* Translation */
.wd-trans {
  font-size: 18px; color: #333; cursor: text; padding: 4px 6px;
  border-radius: 6px; margin: -4px -6px; transition: background 0.1s;
  min-height: 28px;
}
.wd-trans:hover { background: #f5f5f7; }
.wd-trans-input {
  width: 100%; font-size: 18px; color: #333; border: 1.5px solid #6366f1;
  border-radius: 8px; padding: 5px 10px; outline: none; font-family: inherit;
  background: #fafaff;
}

/* Meanings */
.wd-meanings { display: flex; flex-direction: column; gap: 16px; }
.wd-meaning { display: flex; flex-direction: column; gap: 6px; }
.wd-pos {
  font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase;
  letter-spacing: .4px; background: rgba(99,102,241,0.08);
  padding: 2px 8px; border-radius: 5px; align-self: flex-start;
}
.wd-defs { padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.wd-defs li { color: #333; font-size: 14px; line-height: 1.5; }
.wd-def-text { display: block; }
.wd-example { display: block; font-size: 12px; color: #999; font-style: italic; margin-top: 2px; }
.wd-tags { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-top: 4px; }
.wd-tag-label { font-size: 11px; color: #aaa; flex-shrink: 0; }
.wd-tag-label.ant { color: #e57373; }
.wd-tag {
  font-size: 12px; padding: 2px 10px; border-radius: 10px;
  background: rgba(99,102,241,0.08); color: #6366f1; cursor: pointer;
  transition: background 0.12s;
}
.wd-tag:hover { background: rgba(99,102,241,0.16); }
.wd-tag.ant { background: rgba(229,115,115,0.1); color: #e57373; }
.wd-tag.ant:hover { background: rgba(229,115,115,0.2); }

/* Book actions */
.wd-book-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.wd-book-btn {
  background: #f0f0f5; border: none; border-radius: 8px;
  padding: 7px 14px; font-size: 13px; cursor: pointer; color: #555;
  font-family: inherit; transition: background 0.12s, color 0.12s;
}
.wd-book-btn:hover { background: #e8e8f0; color: #6366f1; }
.wd-book-btn-copy { background: rgba(99,102,241,0.08); color: #6366f1; }
.wd-book-btn-copy:hover { background: rgba(99,102,241,0.16); }

/* Modal */
.wd-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 500;
  display: flex; align-items: center; justify-content: center;
}
.wd-modal {
  background: #fff; border-radius: 16px; padding: 24px;
  min-width: 260px; max-width: 320px; width: 90%;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18);
}
.wd-modal-title {
  font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 14px;
}
.wd-modal-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.wd-modal-item {
  padding: 10px 14px; border-radius: 8px; font-size: 14px; color: #333;
  cursor: pointer; background: #f5f5f7; transition: background 0.1s;
}
.wd-modal-item:hover { background: rgba(99,102,241,0.1); color: #6366f1; }
.wd-modal-cancel {
  width: 100%; padding: 9px; background: none; border: 1.5px solid #e0e0e0;
  border-radius: 8px; font-size: 13px; cursor: pointer; color: #888;
  font-family: inherit;
}
.wd-modal-cancel:hover { background: #f5f5f7; }

/* Stats */
.wd-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
}
.wd-stat {
  background: #f8f8fa; border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 4px;
}
.wd-stat-v { font-size: 18px; font-weight: 700; color: #1a1a1a; }
.wd-stat-l { font-size: 11px; color: #aaa; }
.wd-loading { font-size: 13px; color: #bbb; text-align: center; padding: 8px 0; }
.wd-trans-loading { font-size: 16px; color: #bbb; font-style: italic; }
.wd-meanings-zh { margin-top: 12px; display: flex; flex-direction: column; gap: 7px; border-top: 1px solid #f0f0f0; padding-top: 12px; }
.wd-meaning-zh { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.wd-pos-zh { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: .4px; min-width: 36px; }
.wd-trans-chip {
  font-size: 13px; padding: 3px 10px; border-radius: 10px;
  background: rgba(99,102,241,0.07); color: #555; cursor: pointer;
  transition: all 0.12s; border: 1px solid transparent;
}
.wd-trans-chip:hover { background: rgba(99,102,241,0.15); color: #6366f1; border-color: rgba(99,102,241,0.2); }
</style>
