<template>
  <div class="app">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <div class="sidebar-logo">📖 Voca</div>

      <!-- 主导航 -->
      <nav class="sidebar-nav">
        <button class="nav-item" :class="{ active: tab === 'translate' }" @click="tab = 'translate'">
          <span class="nav-icon">🌐</span> 翻译
        </button>
        <button class="nav-item" :class="{ active: tab === 'review' }" @click="tab = 'review'">
          <span class="nav-icon">🗂</span> 闪卡复习
          <span class="due-badge" v-if="flashPool.length > 0">{{ flashPool.length }}</span>
        </button>
        <button class="nav-item" :class="{ active: tab === 'stats' }" @click="tab = 'stats'">
          <span class="nav-icon">📊</span> 统计
        </button>
        <button class="nav-item" :class="{ active: tab === 'search' }" @click="tab = 'search'; globalSearch = ''; globalResults = []">
          <span class="nav-icon">🔍</span> 全局搜索
        </button>
        <button class="nav-item" :class="{ active: tab === 'settings' }" @click="tab = 'settings'">
          <span class="nav-icon">⚙️</span> 设置
        </button>
      </nav>

      <!-- 生词本列表 -->
      <div class="books-section">
        <div class="books-header">
          <span class="books-title">生词本</span>
          <button class="btn-new-book" @click="createBook" title="新建生词本">＋</button>
        </div>
        <div class="book-list">
          <div
            class="book-item"
            v-for="(book, id) in data.books"
            :key="id"
            :class="{ active: data.activeBookId === id && tab === 'words' }"
            @click="switchBook(id)"
          >
            <!-- 收藏目标开关 -->
            <button
              class="book-pin"
              :class="{ pinned: data.saveBookId === id }"
              @click.stop="setSaveBook(id)"
              :title="data.saveBookId === id ? '当前收藏目标' : '设为收藏目标'"
            >{{ data.saveBookId === id ? '📌' : '○' }}</button>
            <span class="book-name">{{ book.name }}</span>
            <span class="book-count">{{ Object.keys(book.words || {}).length }}</span>
            <button
              class="book-del"
              v-if="Object.keys(data.books).length > 1"
              @click.stop="deleteBook(id)"
              title="删除生词本"
            >✕</button>
          </div>
        </div>
      </div>

      <div class="sidebar-shortcut">
        <div class="shortcut-label">全局划词翻译</div>
        <div class="shortcut-key">Ctrl+C+C</div>
        <div class="shortcut-hint">选中文字后按住 Ctrl 快速双击 C</div>
        <div class="shortcut-label" style="margin-top:10px">OCR 截图翻译</div>
        <div class="shortcut-key">Ctrl+Shift+O</div>
        <div class="shortcut-hint">框选屏幕任意区域识别文字</div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main">
      <!-- 单词本 -->
      <div v-if="tab === 'words' && !detailWord" class="words-page">
        <div class="page-header">
          <h1>{{ currentBook?.name || '单词本' }}</h1>
          <span class="word-count">{{ wordList.length }} 个单词</span>
          <input class="search-input" v-model="search" placeholder="搜索单词…" />
          <button class="btn-import" @click="importWords" title="导入">↑ 导入</button>
          <button class="btn-export" @click="exportBook" title="导出">↓ 导出</button>
        </div>

        <div class="pool-bar" v-if="wordList.length">
          <span class="pool-bar-info">
            已加入闪卡池：<b>{{ poolCountForBook }}</b> / {{ wordList.length }} 词
          </span>
          <button class="pool-bar-btn" @click="addAllToPool" v-if="poolCountForBook < wordList.length">全部加入</button>
          <button class="pool-bar-btn pool-bar-btn-remove" @click="removeAllFromPool" v-if="poolCountForBook > 0">全部移除</button>
        </div>

        <div class="word-list" v-if="filteredWords.length">
          <div class="word-card" v-for="w in filteredWords" :key="w.key" @click="openDetail(w)">
            <div class="word-card-left">
              <div class="word-text">{{ w.word }}</div>
              <div class="word-trans">{{ w.translation }}</div>
            </div>
            <div class="word-card-right">
              <span class="word-badge" :class="memClass(w)">{{ memLabel(w) }}</span>
              <button
                class="word-pool"
                :class="{ 'in-pool': isInPool(w) }"
                @click.stop="togglePool(w)"
                :title="isInPool(w) ? '从闪卡池移除' : '加入闪卡池'"
              >⚡</button>
              <button class="word-del" @click.stop="deleteWord(w.key)" title="删除">✕</button>
            </div>
          </div>
        </div>
        <div class="empty" v-else>
          <div class="empty-icon">📭</div>
          <p>还没有收藏单词<br/>选中文字后双击 Ctrl+C 划词翻译，再点 ⭐ 收藏</p>
        </div>
      </div>

      <!-- 单词详情 -->
      <div v-if="tab === 'words' && detailWord" class="words-page" style="padding:0; height:100%;">
        <WordDetail
          :word="detailWord"
          :books="data.books"
          :currentBookId="data.activeBookId"
          @close="detailWord = null"
          @update="onDetailUpdate"
          @move="onWordMove"
          @copy="onWordCopy"
        />
      </div>

      <!-- 闪卡复习 -->
      <div v-if="tab === 'review'" class="review-page">
        <FlashCard :words="flashPool" @update="onPoolCardUpdate" />
      </div>

      <!-- 翻译工作台 -->
      <div v-if="tab === 'translate'" class="translate-page">
        <TranslatePage ref="translateRef" />
      </div>

      <!-- 统计 -->
      <div v-if="tab === 'stats'" class="stats-wrap">
        <StatsPage :data="data" :settings="settings" />
      </div>

      <!-- 全局搜索 -->
      <div v-if="tab === 'search'" class="search-page">
        <div class="page-header">
          <h1>全局搜索</h1>
          <input
            class="search-input search-input-global"
            v-model="globalSearch"
            placeholder="搜索所有生词本…"
            @input="doGlobalSearch"
            autofocus
          />
        </div>
        <div class="search-hint" v-if="!globalSearch.trim()">在所有生词本中搜索单词或翻译</div>
        <div class="search-empty" v-else-if="globalResults.length === 0">没有找到匹配的单词</div>
        <div class="word-list" v-else>
          <div class="word-card" v-for="r in globalResults" :key="r.bookId + ':' + r.key" @click="openGlobalResult(r)">
            <div class="word-card-left">
              <div class="word-text">{{ r.word }}</div>
              <div class="word-trans">{{ r.translation }}</div>
            </div>
            <div class="word-card-right">
              <span class="gs-book-tag">{{ r.bookName }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 设置 -->
      <div v-if="tab === 'settings'" class="settings-wrap">
        <SettingsPage @preset-imported="onPresetImported" />
      </div>
    </main>
  </div>

  <!-- 新建生词本 Modal -->
  <div class="modal-overlay" v-if="showNewBookModal" @click.self="cancelNewBook">
    <div class="modal">
      <h3>新建生词本</h3>
      <input
        class="modal-input"
        v-model="newBookName"
        placeholder="输入生词本名称…"
        @keydown.enter="confirmNewBook"
        @keydown.esc="cancelNewBook"
        ref="newBookInputRef"
        maxlength="30"
      />
      <div class="modal-actions">
        <button class="modal-btn-cancel" @click="cancelNewBook">取消</button>
        <button class="modal-btn-confirm" @click="confirmNewBook" :disabled="!newBookName.trim()">创建</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import FlashCard from '../components/FlashCard.vue';
import SettingsPage from './SettingsPage.vue';
import TranslatePage from './TranslatePage.vue';
import WordDetail from '../components/WordDetail.vue';
import StatsPage from './StatsPage.vue';

const tab = ref('words');
const translateRef = ref(null);
const detailWord = ref(null);
const search = ref('');
const data = ref({ activeBookId: 'default', saveBookId: 'default', flashPool: [], books: { default: { name: '默认生词本', words: {} } } });
const settings = ref({ dailyGoal: 10 });
const globalSearch = ref('');
const globalResults = ref([]);

const editingKey = ref(null);
const editValue = ref('');
const editInputRef = ref(null);

// Strip Vue Proxy before sending through IPC
function toPlain(obj) { return JSON.parse(JSON.stringify(obj)); }

// new book modal
const showNewBookModal = ref(false);
const newBookName = ref('');
const newBookInputRef = ref(null);

const currentBook = computed(() => data.value.books[data.value.activeBookId]);

const wordList = computed(() =>
  Object.entries(currentBook.value?.words || {}).map(([key, val]) => ({ key, ...val }))
);

const filteredWords = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return wordList.value;
  return wordList.value.filter(w =>
    w.word.toLowerCase().includes(q) || w.translation?.toLowerCase().includes(q)
  );
});

const flashPool = computed(() => data.value.flashPool || []);
const poolSet = computed(() => new Set(flashPool.value.map(p => p.bookId + ':' + p.key)));

const dueCount = computed(() => {
  const now = Date.now();
  return flashPool.value.filter(w => !w.mastered && (!w.nextReview || w.nextReview <= now)).length;
});

async function reloadData() {
  data.value = await window.vocaAPI.loadData();
}

async function reloadSettings() {
  settings.value = await window.vocaAPI.loadSettings();
}

function doGlobalSearch() {
  const q = globalSearch.value.trim().toLowerCase();
  if (!q) { globalResults.value = []; return; }
  const results = [];
  for (const [bookId, book] of Object.entries(data.value.books || {})) {
    for (const [key, w] of Object.entries(book.words || {})) {
      if (w.word?.toLowerCase().includes(q) || w.translation?.toLowerCase().includes(q)) {
        results.push({ key, bookId, bookName: book.name, ...w });
      }
    }
  }
  globalResults.value = results;
}

function openGlobalResult(r) {
  data.value.activeBookId = r.bookId;
  tab.value = 'words';
  detailWord.value = r;
}

watch(tab, (newTab) => {
  if (newTab === 'stats') reloadSettings();
});

onMounted(async () => {
  await reloadData();
  settings.value = await window.vocaAPI.loadSettings();
  window.vocaAPI.onWordsUpdated(reloadData);
  window.addEventListener('focus', reloadData);
  window.vocaAPI.onOpenTranslate((text) => {
    tab.value = 'translate';
    nextTick(() => translateRef.value?.setText(text));
  });
});

// ── 生词本管理 ────────────────────────────────────────────────────
function switchBook(id) {
  data.value.activeBookId = id;
  tab.value = 'words';
  search.value = '';
  detailWord.value = null;
  window.vocaAPI.saveData(toPlain(data.value));
}

async function setSaveBook(id) {
  const updated = { ...data.value, saveBookId: id };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

function openDetail(w) {
  detailWord.value = w;
}

// ── 闪卡池管理 ────────────────────────────────────────────────────
function isInPool(w) {
  return poolSet.value.has(data.value.activeBookId + ':' + w.key);
}

const poolCountForBook = computed(() =>
  (data.value.flashPool || []).filter(p => p.bookId === data.value.activeBookId).length
);

function makePoolEntry(w) {
  return { ...w, bookId: data.value.activeBookId };
}

async function togglePool(w) {
  const pid = data.value.activeBookId + ':' + w.key;
  let pool = [...(data.value.flashPool || [])];
  if (poolSet.value.has(pid)) {
    pool = pool.filter(p => !(p.bookId === data.value.activeBookId && p.key === w.key));
  } else {
    pool.push(makePoolEntry(w));
  }
  const updated = { ...data.value, flashPool: pool };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

async function addAllToPool(e) {
  e.stopPropagation();
  const bookId = data.value.activeBookId;
  const existingKeys = new Set(
    (data.value.flashPool || []).filter(p => p.bookId === bookId).map(p => p.key)
  );
  const toAdd = wordList.value.filter(w => !existingKeys.has(w.key)).map(w => ({ ...w, bookId }));
  const pool = [...(data.value.flashPool || []), ...toAdd];
  const updated = { ...data.value, flashPool: pool };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

async function removeAllFromPool(e) {
  e.stopPropagation();
  const bookId = data.value.activeBookId;
  const pool = (data.value.flashPool || []).filter(p => p.bookId !== bookId);
  const updated = { ...data.value, flashPool: pool };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

// When a flashcard review updates a word, sync it back into the pool and the source book
async function onPoolCardUpdate(updatedWord) {
  const bookId = updatedWord.bookId;
  const key = updatedWord.key;

  // Update pool entry
  const pool = (data.value.flashPool || []).map(p =>
    (p.bookId === bookId && p.key === key) ? { ...p, ...updatedWord } : p
  );

  // Update the word in the source book too
  const book = data.value.books[bookId];
  let books = data.value.books;
  if (book?.words[key]) {
    const words = { ...book.words, [key]: { ...book.words[key], ...updatedWord } };
    books = { ...books, [bookId]: { ...book, words } };
  }

  const updated = { ...data.value, flashPool: pool, books };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

function onWordMove({ word, targetId }) {
  const srcId = data.value.activeBookId;
  if (!data.value.books[targetId] || !data.value.books[srcId]) return;
  const key = word.key;
  const plain = { ...word };
  delete plain.key;
  data.value.books[targetId].words[key] = plain;
  delete data.value.books[srcId].words[key];
  const pe = data.value.flashPool.find(p => p.key === key && p.bookId === srcId);
  if (pe) pe.bookId = targetId;
  window.vocaAPI.saveData(toPlain(data.value));
  detailWord.value = null;
}

function onWordCopy({ word, targetId }) {
  if (!data.value.books[targetId]) return;
  const key = word.key;
  const plain = { ...word };
  delete plain.key;
  data.value.books[targetId].words[key] = { ...plain };
  window.vocaAPI.saveData(toPlain(data.value));
}

async function onDetailUpdate(updatedWord) {
  // Also update the in-memory data so the list reflects the change
  await onCardUpdate(updatedWord);
  // Keep detailWord in sync
  detailWord.value = { ...detailWord.value, ...updatedWord };
}

function createBook() {
  newBookName.value = '';
  showNewBookModal.value = true;
  setTimeout(() => newBookInputRef.value?.focus(), 50);
}

function cancelNewBook() {
  showNewBookModal.value = false;
  newBookName.value = '';
}

async function confirmNewBook() {
  const name = newBookName.value.trim();
  if (!name) return;
  showNewBookModal.value = false;
  newBookName.value = '';
  const id = `book_${Date.now()}`;
  const updated = {
    ...data.value,
    activeBookId: id,
    saveBookId: data.value.saveBookId || id,
    books: {
      ...data.value.books,
      [id]: { name, words: {} },
    },
  };
  data.value = updated;
  tab.value = 'words';
  await window.vocaAPI.saveData(toPlain(updated));
}

async function deleteBook(id) {
  if (!confirm(`确认删除「${data.value.books[id]?.name}」？\n生词本内的单词将一并删除。`)) return;
  const books = { ...data.value.books };
  delete books[id];
  const firstId = Object.keys(books)[0];
  let activeBookId = data.value.activeBookId === id ? firstId : data.value.activeBookId;
  let saveBookId = data.value.saveBookId === id ? firstId : (data.value.saveBookId || firstId);
  const updated = { activeBookId, saveBookId, books };
  data.value = updated;
  detailWord.value = null;
  await window.vocaAPI.saveData(toPlain(updated));
}

// ── 单词操作 ─────────────────────────────────────────────────────
async function deleteWord(key) {
  if (editingKey.value === key) cancelEdit();
  const book = currentBook.value;
  if (!book) return;
  const bookId = data.value.activeBookId;
  const words = Object.fromEntries(Object.entries(book.words).filter(([k]) => k !== key));
  // Remove from flash pool too
  const flashPool = (data.value.flashPool || []).filter(p => !(p.bookId === bookId && p.key === key));
  const updated = {
    ...data.value,
    flashPool,
    books: { ...data.value.books, [bookId]: { ...book, words } },
  };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

async function onCardUpdate(updatedWord) {
  const book = currentBook.value;
  if (!book) return;
  const words = { ...book.words, [updatedWord.key]: { ...book.words[updatedWord.key], ...updatedWord } };
  const updated = {
    ...data.value,
    books: { ...data.value.books, [data.value.activeBookId]: { ...book, words } },
  };
  data.value = updated;
  await window.vocaAPI.saveData(toPlain(updated));
}

// ── 导入/导出 ─────────────────────────────────────────────────────
async function exportBook() {
  const res = await window.vocaAPI.exportBook(data.value.activeBookId);
  if (res?.success === false) return;
}

async function importWords() {
  const res = await window.vocaAPI.importWords(data.value.activeBookId);
  if (res?.success) {
    await reloadData();
    alert(`已导入 ${res.count} 个单词`);
  }
}

async function onPresetImported(bookId) {
  await reloadData();
  data.value.activeBookId = bookId;
  tab.value = 'words';
  // Auto-translate words with no translation
  autoTranslateBook(bookId);
}

async function autoTranslateBook(bookId) {
  const book = data.value.books[bookId];
  if (!book) return;
  const words = Object.entries(book.words || {}).filter(([, w]) => !w.translation);
  if (!words.length) return;
  for (const [key, w] of words) {
    try {
      const res = await window.vocaAPI.translate(w.word, 'auto', 'zh-CN');
      if (res.success && res.text) {
        data.value.books[bookId].words[key].translation = res.text;
      }
    } catch {}
  }
  await window.vocaAPI.saveData(toPlain(data.value));
}

// ── 内联编辑 ──────────────────────────────────────────────────────
function startEdit(w) {
  editingKey.value = w.key;
  editValue.value = w.translation || '';
  nextTick(() => {
    if (editInputRef.value) {
      const el = Array.isArray(editInputRef.value) ? editInputRef.value[0] : editInputRef.value;
      el?.focus(); el?.select();
    }
  });
}

async function commitEdit(key) {
  if (editingKey.value !== key) return;
  const val = editValue.value.trim();
  const book = currentBook.value;
  if (val && book?.words[key]) {
    const words = { ...book.words, [key]: { ...book.words[key], translation: val } };
    const updated = {
      ...data.value,
      books: { ...data.value.books, [data.value.activeBookId]: { ...book, words } },
    };
    data.value = updated;
    await window.vocaAPI.saveData(toPlain(updated));
  }
  editingKey.value = null;
}

function cancelEdit() { editingKey.value = null; }

// ── 记忆标签 ─────────────────────────────────────────────────────
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
  if (rc === 0) return 'mem-new';
  if (iv < 7) return 'mem-learning';
  if (iv < 21) return 'mem-familiar';
  return 'mem-mastered';
}
</script>

<style>
.app { display: flex; height: 100vh; overflow: hidden; }

/* 侧边栏 */
.sidebar {
  width: 210px; flex-shrink: 0;
  background: #1e1e2e;
  display: flex; flex-direction: column;
  padding: 20px 12px;
  gap: 4px;
  overflow-y: auto;
}
.sidebar-logo {
  font-size: 18px; font-weight: 700; color: #fff;
  padding: 0 8px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
  margin-bottom: 4px; flex-shrink: 0;
}
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; border-radius: 8px; border: none;
  background: transparent; color: rgba(255,255,255,0.55);
  font-size: 14px; cursor: pointer; text-align: left;
  transition: background 0.15s, color 0.15s; font-family: inherit;
}
.nav-item:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); }
.nav-item.active { background: rgba(99,102,241,0.25); color: #fff; font-weight: 600; }
.nav-icon { font-size: 15px; }
.due-badge {
  margin-left: auto; background: #6366f1; color: #fff;
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 10px; min-width: 18px; text-align: center;
}

/* 生词本区域 */
.books-section {
  margin-top: 12px; flex: 1; display: flex; flex-direction: column; min-height: 0;
}
.books-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 4px;
}
.books-title { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: .5px; }
.btn-new-book {
  background: rgba(99,102,241,0.2); border: none; color: #a78bfa;
  width: 20px; height: 20px; border-radius: 5px; cursor: pointer;
  font-size: 14px; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; line-height: 1;
}
.btn-new-book:hover { background: rgba(99,102,241,0.35); }

.book-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
.book-item {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 10px; border-radius: 7px; cursor: pointer;
  transition: background 0.12s;
}
.book-item:hover { background: rgba(255,255,255,0.06); }
.book-item.active { background: rgba(99,102,241,0.2); }
.book-name {
  flex: 1; font-size: 13px; color: rgba(255,255,255,0.7); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.book-item.active .book-name { color: #fff; font-weight: 600; }
.book-count {
  font-size: 10px; color: rgba(255,255,255,0.28); flex-shrink: 0;
  background: rgba(255,255,255,0.07); padding: 1px 5px; border-radius: 8px;
}
.book-pin {
  background: none; border: none; cursor: pointer; font-size: 12px;
  padding: 1px 3px; border-radius: 3px; flex-shrink: 0; opacity: 0;
  color: rgba(255,255,255,0.3); line-height: 1; transition: opacity 0.12s;
}
.book-pin.pinned { opacity: 1; }
.book-item:hover .book-pin { opacity: 1; }
.book-pin:hover { color: #ffd066; }
.book-del {
  background: none; border: none; color: rgba(255,255,255,0.2);
  cursor: pointer; font-size: 11px; padding: 2px 4px; border-radius: 3px;
  transition: color 0.12s; flex-shrink: 0; opacity: 0;
}
.book-item:hover .book-del { opacity: 1; }
.book-del:hover { color: #ff9a9a !important; }

.sidebar-shortcut {
  margin-top: auto; flex-shrink: 0;
  background: rgba(255,255,255,0.05);
  border-radius: 10px; padding: 12px;
}
.shortcut-label { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 4px; }
.shortcut-key {
  font-size: 13px; font-weight: 700; color: #a78bfa;
  background: rgba(167,139,250,0.15); border-radius: 6px;
  padding: 4px 8px; display: inline-block; margin-bottom: 6px; font-family: monospace;
}
.shortcut-hint { font-size: 10px; color: rgba(255,255,255,0.3); line-height: 1.4; }

/* 主区域 */
.main { flex: 1; overflow-y: auto; background: #f5f5f7; }

/* 单词本 */
.words-page { padding: 28px 32px; }
.page-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 24px; flex-wrap: wrap;
}
.page-header h1 { font-size: 22px; font-weight: 700; }
.word-count { font-size: 13px; color: #999; }
.search-input {
  margin-left: auto; padding: 7px 14px;
  border: 1.5px solid #e0e0e0; border-radius: 20px;
  font-size: 13px; outline: none; width: 180px;
  transition: border-color 0.15s; font-family: inherit;
}
.search-input:focus { border-color: #6366f1; }
.btn-import, .btn-export {
  padding: 7px 12px; border: 1.5px solid #e0e0e0; border-radius: 8px;
  background: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
  color: #555; font-family: inherit; transition: border-color 0.15s, color 0.15s;
}
.btn-import:hover { border-color: #6366f1; color: #6366f1; }
.btn-export:hover { border-color: #6366f1; color: #6366f1; }

/* Pool bar */
.pool-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; background: rgba(99,102,241,0.07);
  border-radius: 10px; margin-bottom: 12px;
  border: 1px solid rgba(99,102,241,0.15);
}
.pool-bar-info { font-size: 13px; color: #555; flex: 1; }
.pool-bar-info b { color: #6366f1; }
.pool-bar-btn {
  padding: 4px 12px; background: #6366f1; color: #fff;
  border: none; border-radius: 7px; font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.pool-bar-btn:hover { background: #4f52d3; }
.pool-bar-btn-remove { background: #f5f5f7; color: #e74c3c; border: 1.5px solid #e0e0e0; }
.pool-bar-btn-remove:hover { background: #fff0f0; border-color: #e74c3c; }

.word-list { display: flex; flex-direction: column; gap: 8px; }
.word-card {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; border-radius: 12px; padding: 12px 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06); transition: box-shadow 0.15s;
  cursor: pointer;
}
.word-card:hover { box-shadow: 0 3px 12px rgba(0,0,0,0.1); }
.word-card-left { flex: 1; min-width: 0; }
.word-text { font-size: 16px; font-weight: 700; color: #1a1a1a; }
.word-trans {
  font-size: 13px; color: #666; margin-top: 2px;
  cursor: text; border-radius: 4px; padding: 1px 3px; margin-left: -3px;
  transition: background 0.1s;
}
.word-trans:hover { background: #f0f0f5; }
.word-trans-edit { margin-top: 2px; }
.edit-input {
  font-size: 13px; color: #333; border: 1.5px solid #6366f1;
  border-radius: 6px; padding: 2px 8px; outline: none;
  font-family: inherit; width: 100%; background: #fafaff;
}
.word-card-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.word-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; }
.mem-new      { background: #e8f5e9; color: #388e3c; }
.mem-learning { background: #f1f8e9; color: #558b2f; }
.mem-familiar { background: #e3f2fd; color: #1565c0; }
.mem-mastered { background: #fce4ec; color: #c62828; }
.word-pool {
  background: none; border: none; font-size: 15px;
  cursor: pointer; padding: 3px 5px; border-radius: 6px;
  opacity: 0.25; transition: opacity 0.15s, background 0.15s;
  line-height: 1;
}
.word-pool:hover { opacity: 0.7; background: #f0f0f5; }
.word-pool.in-pool { opacity: 1; }
.word-del {
  background: none; border: none; color: #ccc;
  cursor: pointer; font-size: 14px; padding: 4px;
  border-radius: 4px; transition: color 0.15s;
}
.word-del:hover { color: #e74c3c; }

.empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 60vh; gap: 12px; color: #aaa;
  text-align: center; line-height: 1.7;
}
.empty-icon { font-size: 48px; }

/* 复习页 */
.review-page { height: 100vh; display: flex; flex-direction: column; }

/* 翻译页 */
.translate-page { height: 100%; display: flex; flex-direction: column; overflow: hidden; }

/* 设置页包装 */
.settings-wrap { height: 100%; overflow-y: auto; }
.stats-wrap { height: 100%; overflow-y: auto; }

/* 全局搜索 */
.search-page { padding: 28px 32px; height: 100%; box-sizing: border-box; overflow-y: auto; }
.search-input-global { width: 280px; margin-left: 16px; }
.search-hint { font-size: 14px; color: #bbb; margin-top: 40px; text-align: center; }
.search-empty { font-size: 14px; color: #bbb; margin-top: 40px; text-align: center; }
.gs-book-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: rgba(99,102,241,0.1); color: #6366f1; font-weight: 600; white-space: nowrap;
}

/* Modal */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: #fff; border-radius: 16px; padding: 28px 28px 22px;
  width: 340px; box-shadow: 0 16px 48px rgba(0,0,0,0.18);
  display: flex; flex-direction: column; gap: 16px;
}
.modal h3 { font-size: 16px; font-weight: 700; color: #1a1a1a; margin: 0; }
.modal-input {
  padding: 10px 14px; border: 1.5px solid #e0e0e0; border-radius: 10px;
  font-size: 14px; outline: none; font-family: inherit; transition: border-color 0.15s;
}
.modal-input:focus { border-color: #6366f1; }
.modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.modal-btn-cancel {
  padding: 8px 18px; background: #f5f5f5; border: none;
  border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit;
  color: #555; transition: background 0.15s;
}
.modal-btn-cancel:hover { background: #eee; }
.modal-btn-confirm {
  padding: 8px 18px; background: #6366f1; color: #fff; border: none;
  border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: background 0.15s;
}
.modal-btn-confirm:hover { background: #4f52d3; }
.modal-btn-confirm:disabled { background: #aaa; cursor: not-allowed; }
</style>
