// Run with Electron. Uses the actual built UI/preload and the real scheduler,
// but only synthetic data in a temporary directory; never opens user files.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { applyReview, previewReview, reviewOptions } = require('../src/main/review-scheduler');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'voca-review-ui-'));
app.setPath('userData', path.join(out, 'profile'));
app.disableHardwareAcceleration();
let data;
let win;
let failWrite = false;
let delayWrite = false;
let events = 0;
let optionWrites = 0;
let failOptions = false;
const errors = [];
const clone = x => JSON.parse(JSON.stringify(x));
const fresh = () => {
  const now = Date.now();
  const words = [
    { key: 'remember', word: 'remember', translation: '记住', reviewCount: 4, interval: 1, lastReview: now - 86400000, nextReview: now - 1000 },
    { key: 'clarity', word: 'clarity', translation: '清晰', timestamp: now },
    { key: 'future', word: 'future', translation: '未来', reviewCount: 5, interval: 7, lastReview: now - 86400000, nextReview: now + 86400000 },
  ].map(w => ({ bookId: 'default', ...w }));
  return { activeBookId: 'default', saveBookId: 'default', flashPool: words, books: { default: { name: '测试词书', words: Object.fromEntries(words.map(w => [w.key, w])) } }, stats: {}, reviewLogs: [], reviewOptions: { retention: .9, newPerDay: 1, relearnMinutes: 10 } };
};
const on = (name, fn) => ipcMain.handle(name, (_, ...args) => fn(...args));
on('load-data', () => clone(data));
on('save-data', value => { data = value; return true; });
on('get-app-version', () => '1.0.9');
on('load-settings', () => ({ dailyGoal: 10 }));
on('get-login-item', () => false);
on('get-sync-status', () => ({ running: false, port: 27149, error: '' }));
on('get-word-detail', () => ({ success: true, meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'SECRET_DEFINITION', example: 'SECRET_EXAMPLE' }], synonyms: ['SECRET_SYNONYM'] }] }));
on('preview-review', identity => previewReview(data.flashPool.find(w => w.key === identity.key), data.reviewOptions));
on('save-review-options', input => { if (failOptions) throw new Error('simulated settings failure'); optionWrites++; data.reviewOptions = reviewOptions(input); return clone(data); });
on('review-card', async request => {
  events++;
  if (delayWrite) await new Promise(resolve => setTimeout(resolve, 150));
  if (failWrite) throw new Error('simulated disk failure');
  const result = applyReview(data, request);
  data = result.data;
  fs.writeFileSync(path.join(out, 'fixture.json'), JSON.stringify(data));
  return clone(result);
});
async function js(code) { return win.webContents.executeJavaScript(code, true); }
async function waitFor(code) {
  const until = Date.now() + 5000;
  do { if (await js(code)) return; await new Promise(r => setTimeout(r, 25)); } while (Date.now() < until);
  throw new Error(`Timed out: ${code}`);
}
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); }
async function snapshot(name) {
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await new Promise(r => setTimeout(r, 300));
  fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}
async function openReview() {
  await js(`Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('闪卡复习')).click()`);
  await waitFor(`!!document.querySelector('.wc-word') || !!document.querySelector('.idle-actions')`);
}
app.whenReady().then(async () => {
  try {
    data = fresh();
    win = new BrowserWindow({ width: 1060, height: 740, show: false, webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
    await win.loadFile(path.join(__dirname, '../src/renderer/dist/index.html'));
    await waitFor(`document.querySelectorAll('.word-text').length === 3`);
    await js(`Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('设置')).click()`);
    await waitFor(`!!document.querySelector('.s-tabs')`);
    await js(`Array.from(document.querySelectorAll('.s-tab')).find(b => b.textContent === '闪卡复习').click()`);
    await waitFor(`!!document.querySelector('.review-settings')`);
    assert.equal(await js(`document.querySelector('[data-review-option="batchSize"]').value`), '20');
    await js(`const input=document.querySelector('[data-review-option="batchSize"]'); input.value='10'; input.dispatchEvent(new Event('change',{bubbles:true}));`);
    failOptions = true;
    await click('.btn-save-review');
    await waitFor(`document.querySelector('.save-error')?.textContent.includes('保存失败')`);
    assert.equal(data.reviewOptions.batchSize, undefined);
    failOptions = false;
    await click('.btn-save-review');
    await waitFor(`!!document.querySelector('.save-hint')`);
    assert.equal(data.reviewOptions.batchSize, 10);
    assert.equal(optionWrites, 1);
    await snapshot('review-settings');
    await openReview();
    await waitFor(`document.querySelector('.wc-word')?.textContent === 'remember'`);
    assert.equal(optionWrites, 1);
    assert.equal(await js(`document.querySelectorAll('.review-options, .setup-card, input, select').length`), 0);
    assert.equal(await js(`document.body.textContent.includes('SECRET_DEFINITION')`), false);
    assert.equal(await js(`!!document.querySelector('.wc-trans')`), false);
    await snapshot('question');
    await click('.fc-session .word-card');
    await waitFor(`document.body.textContent.includes('SECRET_DEFINITION') && !document.querySelector('.fc-btn-known').disabled`);
    await snapshot('answer');
    win.setContentSize(860, 520);
    await snapshot('answer-small');
    assert.equal(await js(`document.querySelector('.fc-btn-easy').getBoundingClientRect().bottom <= innerHeight`), true);
    win.setContentSize(1060, 740);
    failWrite = true;
    await click('.fc-btn-unknown');
    await waitFor(`document.querySelector('.fc-message')?.textContent.includes('保存失败')`);
    assert.equal(data.reviewLogs.length, 0);
    assert.equal(await js(`document.querySelector('.wc-word').textContent`), 'remember');
    failWrite = false; delayWrite = true;
    const previousEvents = events;
    await js(`document.querySelector('.fc-btn-unknown').click(); document.querySelector('.fc-btn-unknown').click();`);
    await waitFor(`document.querySelector('.wc-word')?.textContent === 'clarity'`);
    assert.equal(events, previousEvents + 1);
    assert.equal(data.reviewLogs.length, 1);
    assert.equal(data.stats.todayReviewed, 1);
    await click('.fc-session .word-card');
    await waitFor(`!document.querySelector('.fc-btn-known').disabled`);
    await click('.fc-btn-known');
    await waitFor(`document.body.textContent.includes('等待短时重学')`);
    assert.equal(data.reviewLogs.length, 2);
    await snapshot('waiting');
    // The waiting queue survives unmounting. Simulate the persisted due time
    // passing, then re-enter through the normal review entry point.
    const waiting = data.flashPool.find(w => w.key === 'remember');
    waiting.nextReview = Date.now() - 1000;
    waiting.fsrs.due = new Date(waiting.nextReview).toISOString();
    data.books.default.words.remember = clone(waiting);
    await click('.fc-done .btn-start');
    win.webContents.send('words-updated');
    await openReview();
    await waitFor(`document.querySelector('.wc-word')?.textContent === 'remember'`);
    await click('.exit-session');
    // With only future cards, entering review shows a quiet completion state.
    waiting.nextReview = Date.now() + 600000;
    waiting.fsrs.due = new Date(waiting.nextReview).toISOString();
    data.books.default.words.remember = clone(waiting);
    const scheduleBefore = JSON.stringify(data.flashPool);
    await openReview();
    await waitFor(`document.body.textContent.includes('当前没有待复习卡片')`);
    await snapshot('no-due');
    await click('.idle-actions .btn-start-all');
    await waitFor(`document.querySelector('.sh-title')?.textContent.includes('提前练习')`);
    await click('.fc-session .word-card');
    await click('.fc-btn-easy');
    await waitFor(`document.querySelector('.wc-word')?.textContent !== 'remember'`);
    assert.equal(JSON.stringify(data.flashPool), scheduleBefore);
    assert.equal(data.reviewLogs.at(-1).mode, 'practice');
    assert.equal(data.stats.todayReviewed, 2);
    await click('.exit-session');
    data.flashPool = [];
    await openReview();
    await waitFor(`document.body.textContent.includes('闪卡池为空')`);
    await click('.settings-link');
    await waitFor(`!!document.querySelector('.review-settings')`);
    assert.equal(await js(`document.querySelector('[data-review-option="batchSize"]').value`), '10');
    win.setContentSize(860, 520);
    await snapshot('settings-small');
    assert.equal(await js(`document.querySelector('.settings-page').scrollWidth > document.querySelector('.settings-page').clientWidth + 1`), false);
    // Persisted batch size controls each newly opened session.
    data = fresh();
    const many = Array.from({length: 25}, (_, i) => ({ ...data.flashPool[0], key: `card-${i}`, word: `card-${i}` }));
    data.flashPool = many;
    data.books.default.words = Object.fromEntries(many.map(w => [w.key, w]));
    data.reviewOptions.batchSize = 10;
    await openReview();
    await waitFor(`document.querySelector('.shp-counter')?.textContent.includes('剩余 10 张')`);
    assert.equal(optionWrites, 1);
    // Short phrases get the full card width. Long passages remain readable and
    // scroll inside the card while the rating controls stay on screen.
    async function passage(word, translation) {
      await click('.exit-session');
      data = fresh();
      const entry = { bookId: 'default', key: 'sentence', word, translation };
      data.flashPool = [entry];
      data.books.default.words = { sentence: clone(entry) };
      await openReview();
      await waitFor(`document.querySelector('.wc-word')?.textContent === ${JSON.stringify(word)}`);
      assert.equal(await js(`!!document.querySelector('.detail-panel')`), false);
      assert.equal(await js(`document.querySelector('.word-card').getBoundingClientRect().width / document.querySelector('.session-body').clientWidth > .85`), true);
      assert.equal(await js(`document.querySelector('.wc-word').scrollWidth <= document.querySelector('.wc-word').clientWidth + 1`), true);
    }
    win.setContentSize(1060, 740);
    await passage('she is walking with purpose', '她正目标明确地走着。');
    assert.equal(await js(`document.querySelector('.wc-word').offsetHeight <= parseFloat(getComputedStyle(document.querySelector('.wc-word')).lineHeight) * 1.1`), true);
    await snapshot('sentence-question');
    await click('.toggle-details');
    await waitFor(`!!document.querySelector('.detail-panel')`);
    assert.equal(await js(`document.querySelector('.toggle-details').getAttribute('aria-expanded')`), 'true');
    await click('.toggle-details');
    await click('.fc-session .word-card');
    await waitFor(`!!document.querySelector('.wc-trans')`);
    await snapshot('sentence-answer');
    win.setContentSize(860, 520);
    const longText = 'When we learn something new, we need enough room to read the entire sentence and understand its meaning.\n'.repeat(40).trim();
    const longTranslation = '学习新知识时，需要足够的空间阅读完整句子，并理解它的意思。\n'.repeat(30).trim();
    await passage(longText, longTranslation);
    assert.equal(await js(`document.querySelector('.word-card').scrollHeight > document.querySelector('.word-card').clientHeight`), true);
    assert.equal(await js(`document.querySelector('.wc-word').getBoundingClientRect().top >= document.querySelector('.word-card').getBoundingClientRect().top`), true);
    await snapshot('long-passage-small');
    await click('.fc-session .word-card');
    await waitFor(`!!document.querySelector('.wc-trans')`);
    await js(`document.querySelector('.word-card').scrollTop = document.querySelector('.word-card').scrollHeight`);
    assert.equal(await js(`document.querySelector('.wc-trans').getBoundingClientRect().bottom <= document.querySelector('.word-card').getBoundingClientRect().bottom + 1`), true);
    assert.equal(await js(`document.querySelector('.fc-btn-easy').getBoundingClientRect().bottom <= innerHeight`), true);
    await snapshot('long-passage-answer-small');
    await passage('没有空格的中文长句同样应该能够自动换行，完整显示在更宽的背诵区域里。'.repeat(8), '中文句子测试');
    await passage('a'.repeat(500), '超长连续文本也不会撑开页面。');
    assert.equal(await js(`document.querySelector('.fc').scrollWidth <= document.querySelector('.fc').clientWidth + 1`), true);
    assert.deepEqual(errors, []);
    const report = { passed: true, checks: ['settings relocation and save retry', 'automatic review entry without settings writes', 'hidden answers', 'four ratings', 'failure retry', 'double-click suppression', 'per-answer persistence', 'short-term waiting', 'resume', 'practice isolation', 'empty and no-due states', 'persisted batch size', 'small window', 'wide sentences and collapsible records', 'multiline long passages and translations', 'Chinese and unbroken text wrapping'], screenshots: out };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
