const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSelectionTranslationController } = require('../src/main/selection-translation');

const keys = {
  Ctrl: 1, CtrlRight: 2, C: 3, Alt: 4, Tab: 5, ArrowLeft: 6,
  Shift: 7, ShiftRight: 8, ArrowRight: 9, ArrowUp: 10, ArrowDown: 11,
  Home: 12, End: 13, PageUp: 14, PageDown: 15, A: 16, Escape: 17,
};

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function fixture(options = {}) {
  const hook = new EventEmitter();
  const calls = {
    starts: 0, stops: 0, reads: 0, clipboardReads: 0, icons: [], overlays: [],
    hides: 0, cancellations: 0, readPoints: [], focusPoints: [], diagnostics: [],
  };
  hook.start = () => { calls.starts++; };
  hook.stop = () => { calls.stops++; };
  let clock = 1000, nextTimerId = 1, ownWindowFocused = false;
  const timers = new Map();
  const controller = createSelectionTranslationController({
    hook,
    keys,
    readSelection: point => {
      calls.reads++;
      calls.readPoints.push(point);
      return options.readSelection ? options.readSelection(point) : Promise.resolve('selected word');
    },
    cancelReadSelection: () => { calls.cancellations++; },
    readClipboard: () => { calls.clipboardReads++; return options.clipboard ?? 'copied word'; },
    showIcon: text => calls.icons.push(text),
    hideIcon: () => { calls.hides++; },
    showOverlay: text => calls.overlays.push(text),
    isOwnWindowFocused: point => { calls.focusPoints.push(point); return ownWindowFocused; },
    reportDiagnostic: diagnostic => {
      calls.diagnostics.push(diagnostic);
      if (options.reportDiagnostic) options.reportDiagnostic(diagnostic);
    },
    schedule: (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, time: clock + delay });
      return id;
    },
    cancelSchedule: id => timers.delete(id),
    now: () => clock,
    enabled: options.enabled ?? true,
  });

  function advance(milliseconds) {
    const until = clock + milliseconds;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.time <= until)
        .sort((a, b) => a[1].time - b[1].time)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      clock = timer.time;
      timer.callback();
    }
    clock = until;
  }
  const keydown = (keycode, modifiers = {}) => hook.emit('keydown', { keycode, ...modifiers });
  const keyup = keycode => hook.emit('keyup', { keycode });
  const drag = () => {
    hook.emit('mousedown', { button: 1, x: 100, y: 100 });
    hook.emit('mouseup', { button: 1, x: 150, y: 100 });
  };
  controller.start();
  return { hook, calls, controller, advance, keydown, keyup, drag, setOwnWindowFocused: value => { ownWindowFocused = value; } };
}

test('drag reads the current selection without reading or copying the clipboard', async () => {
  const f = fixture({ readSelection: async () => '  selection text  ' });
  f.drag();
  f.advance(1000);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
  assert.deepEqual(f.calls.icons, ['selection text']);
  assert.equal(f.calls.clipboardReads, 0);
  assert.deepEqual(f.calls.overlays, []);
});

test('unpaired mouseup and selections inside Voca are ignored', async () => {
  const f = fixture();
  f.hook.emit('mouseup', { button: 1, x: 150, y: 100 });
  f.setOwnWindowFocused(true);
  f.drag();
  f.advance(1000);
  await flushPromises();
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.clipboardReads, 0);
  assert.deepEqual(f.calls.icons, []);
});

test('a two-pixel drag waits for a real selection and retains the gesture origin', async () => {
  const f = fixture({ readSelection: async () => 'short selection' });
  f.hook.emit('mousedown', { button: 1, x: 100, y: 100 });
  f.hook.emit('mouseup', { button: 1, x: 102, y: 100 });
  f.advance(99);
  assert.equal(f.calls.reads, 0);
  f.advance(1);
  await flushPromises();
  assert.deepEqual(f.calls.readPoints, [{ x: 102, y: 100, originX: 100, originY: 100 }]);
  assert.deepEqual(f.calls.icons, ['short selection']);
  assert.equal(f.calls.clipboardReads, 0);
});

test('a second nearby click captures double-click selection after it settles without reading the first click', async () => {
  const f = fixture();
  const click = () => {
    f.hook.emit('mousedown', { button: 1, x: 100, y: 100 });
    f.hook.emit('mouseup', { button: 1, x: 100, y: 100 });
  };
  click();
  f.advance(50);
  assert.equal(f.calls.reads, 0);
  click();
  f.advance(99);
  assert.equal(f.calls.reads, 0);
  f.advance(1);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
  assert.deepEqual(f.calls.icons, ['selected word']);
});

test('ordinary clicks and sub-two-pixel jitter cancel and hide without reading selection or clipboard', async () => {
  const request = deferred();
  const f = fixture({ readSelection: () => request.promise });
  f.drag();
  f.advance(100);
  assert.equal(f.calls.reads, 1);
  const hides = f.calls.hides;
  f.hook.emit('mousedown', { button: 1, x: 150, y: 100 });
  f.hook.emit('mouseup', { button: 1, x: 151, y: 100 });
  assert.ok(f.calls.hides > hides);
  request.resolve('old selection');
  await flushPromises();
  f.advance(1000);
  f.hook.emit('mousedown', { button: 1, x: 151, y: 100 });
  f.hook.emit('mouseup', { button: 1, x: 151, y: 100 });
  f.advance(1000);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
  assert.deepEqual(f.calls.icons, []);
  assert.equal(f.calls.clipboardReads, 0);
});

test('native double/triple click counts trigger selection even without fallback click history', async t => {
  for (const clicks of [2, 3]) {
    await t.test(`${clicks} clicks`, async () => {
      const f = fixture();
      f.hook.emit('mousedown', { button: 1, x: 100, y: 100, clicks });
      f.hook.emit('mouseup', { button: 1, x: 100, y: 100, clicks });
      f.advance(100);
      await flushPromises();
      assert.equal(f.calls.reads, 1);
      assert.deepEqual(f.calls.icons, ['selected word']);
      assert.equal(f.calls.clipboardReads, 0);
    });
  }
});

test('double-click fallback respects time, distance, and intervening input', async t => {
  for (const [name, between, point] of [
    ['too late', f => f.advance(501), { x: 100, y: 100 }],
    ['too far', f => f.advance(50), { x: 106, y: 100 }],
    ['wheel in between', f => f.hook.emit('wheel', { rotation: 1 }), { x: 100, y: 100 }],
    ['keyboard in between', f => f.keydown(keys.Escape), { x: 100, y: 100 }],
  ]) {
    await t.test(name, async () => {
      const f = fixture();
      f.hook.emit('mousedown', { button: 1, x: 100, y: 100 });
      f.hook.emit('mouseup', { button: 1, x: 100, y: 100 });
      between(f);
      f.hook.emit('mousedown', { button: 1, ...point });
      f.hook.emit('mouseup', { button: 1, ...point });
      f.advance(1000);
      await flushPromises();
      assert.equal(f.calls.reads, 0);
      assert.deepEqual(f.calls.icons, []);
    });
  }
});

test('Shift+click can extend selection without pointer movement', async t => {
  for (const source of ['hook modifier', 'tracked Shift key']) {
    await t.test(source, async () => {
      const f = fixture();
      if (source === 'tracked Shift key') f.keydown(keys.Shift);
      const modifier = source === 'hook modifier' ? { shiftKey: true } : {};
      f.hook.emit('mousedown', { button: 1, x: 100, y: 100, ...modifier });
      f.hook.emit('mouseup', { button: 1, x: 100, y: 100, ...modifier });
      f.advance(100);
      await flushPromises();
      assert.equal(f.calls.reads, 1);
      assert.deepEqual(f.calls.icons, ['selected word']);
      assert.equal(f.calls.clipboardReads, 0);
    });
  }
});

test('keyboard selection reads the focused control without inventing pointer coordinates', async t => {
  for (const keycode of [keys.ArrowLeft, keys.ArrowRight, keys.ArrowUp, keys.ArrowDown, keys.Home, keys.End, keys.PageUp, keys.PageDown]) {
    await t.test(`Shift + ${keycode}`, async () => {
      const f = fixture();
      f.keydown(keys.ShiftRight);
      f.keydown(keycode);
      f.keyup(keycode);
      f.keyup(keys.ShiftRight);
      f.advance(100);
      await flushPromises();
      assert.deepEqual(f.calls.readPoints, [undefined]);
      assert.ok(f.calls.focusPoints.every(point => point === undefined));
      assert.deepEqual(f.calls.icons, ['selected word']);
      assert.equal(f.calls.clipboardReads, 0);
    });
  }
  await t.test('Ctrl+A after modifier release', async () => {
    const f = fixture();
    f.keydown(keys.Ctrl);
    f.keydown(keys.A);
    f.keyup(keys.A);
    f.keyup(keys.Ctrl);
    f.advance(100);
    await flushPromises();
    assert.deepEqual(f.calls.readPoints, [undefined]);
    assert.deepEqual(f.calls.icons, ['selected word']);
    assert.equal(f.calls.clipboardReads, 0);
  });
});

test('repeated keyboard selection waits for the final movement and plain navigation cancels it', async () => {
  const f = fixture();
  f.keydown(keys.Shift);
  f.keydown(keys.ArrowRight);
  f.advance(60);
  f.keydown(keys.ArrowRight);
  f.advance(99);
  assert.equal(f.calls.reads, 0);
  f.advance(1);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
  assert.deepEqual(f.calls.icons, ['selected word']);
  f.keydown(keys.ArrowRight);
  f.keyup(keys.Shift);
  f.keydown(keys.ArrowRight);
  f.advance(100);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
});

test('disabled keyboard selection and keyboard selection within Voca do not read', async () => {
  const f = fixture({ enabled: false });
  f.keydown(keys.Shift);
  f.keydown(keys.Home);
  f.advance(100);
  f.controller.setEnabled(true);
  f.setOwnWindowFocused(true);
  f.keydown(keys.Ctrl);
  f.keydown(keys.A);
  f.advance(100);
  await flushPromises();
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.clipboardReads, 0);
  assert.deepEqual(f.calls.icons, []);
});

test('a delayed empty selection is retried once without touching the clipboard', async () => {
  let attempts = 0;
  const f = fixture({ readSelection: async () => ++attempts === 1 ? '' : 'settled selection' });
  f.drag();
  f.advance(100);
  await flushPromises();
  assert.equal(f.calls.reads, 1);
  f.advance(149);
  assert.equal(f.calls.reads, 1);
  f.advance(1);
  await flushPromises();
  assert.equal(f.calls.reads, 2);
  assert.deepEqual(f.calls.icons, ['settled selection']);
  assert.equal(f.calls.clipboardReads, 0);
  assert.deepEqual(f.calls.diagnostics.map(({ status }) => status), ['scheduled', 'reading', 'empty', 'scheduled', 'reading', 'selected']);
  assert.ok(!JSON.stringify(f.calls.diagnostics).includes('settled selection'));
});

test('empty selections stop after one retry and a failing diagnostic sink does not interrupt selection', async () => {
  const f = fixture({ readSelection: async () => '', reportDiagnostic: () => { throw new Error('log unavailable'); } });
  f.drag();
  f.advance(100);
  await flushPromises();
  f.advance(150);
  await flushPromises();
  f.advance(1000);
  await flushPromises();
  assert.equal(f.calls.reads, 2);
  assert.deepEqual(f.calls.icons, []);
  assert.equal(f.calls.clipboardReads, 0);
});

test('navigation, disabling, stopping, and manual copying cancel a scheduled retry', async t => {
  for (const [name, cancel] of [
    ['navigation', f => f.keydown(keys.Escape)],
    ['disable', f => f.controller.setEnabled(false)],
    ['stop', f => f.controller.stop()],
    ['manual copy', f => { f.keydown(keys.Ctrl); f.keydown(keys.C); f.keyup(keys.C); }],
  ]) {
    await t.test(name, async () => {
      const f = fixture({ readSelection: async () => '' });
      f.drag();
      f.advance(100);
      await flushPromises();
      assert.equal(f.calls.reads, 1);
      cancel(f);
      f.advance(1000);
      await flushPromises();
      assert.equal(f.calls.reads, 1);
      assert.deepEqual(f.calls.icons, name === 'manual copy' ? ['copied word'] : []);
    });
  }
});

test('focus moving to Voca before or during a selection read prevents its icon', async () => {
  const request = deferred();
  const f = fixture({ readSelection: () => request.promise });
  f.drag();
  f.setOwnWindowFocused(true);
  f.advance(100);
  assert.equal(f.calls.reads, 0);
  f.setOwnWindowFocused(false);
  f.drag();
  f.advance(100);
  assert.equal(f.calls.reads, 1);
  f.setOwnWindowFocused(true);
  request.resolve('obsolete selection');
  await flushPromises();
  assert.deepEqual(f.calls.icons, []);
});

test('scrolling and non-left clicks cancel delayed, in-flight, and retry selection reads', async t => {
  for (const [name, interrupt] of [
    ['wheel', f => f.hook.emit('wheel', { rotation: 1, x: 150, y: 100 })],
    ['right click', f => f.hook.emit('mousedown', { button: 2, x: 150, y: 100 })],
    ['middle click', f => f.hook.emit('mousedown', { button: 3, x: 150, y: 100 })],
  ]) {
    await t.test(name, async () => {
      const request = deferred();
      const f = fixture({ readSelection: () => request.promise });
      f.drag();
      interrupt(f);
      f.advance(100);
      assert.equal(f.calls.reads, 0);
      f.drag();
      f.advance(100);
      assert.equal(f.calls.reads, 1);
      interrupt(f);
      request.resolve('selection before interruption');
      await flushPromises();
      assert.deepEqual(f.calls.icons, []);
      f.advance(1000);
      assert.equal(f.calls.reads, 1);

      const retry = fixture({ readSelection: async () => '' });
      retry.drag();
      retry.advance(100);
      await flushPromises();
      interrupt(retry);
      retry.advance(1000);
      await flushPromises();
      assert.equal(retry.calls.reads, 1);
      assert.deepEqual(retry.calls.icons, []);
      assert.equal(retry.calls.clipboardReads, 0);
    });
  }
});

test('scrolling hides an existing icon even over Voca and preserves a deliberate double-copy translation', async () => {
  const f = fixture();
  f.drag();
  f.advance(100);
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['selected word']);
  f.setOwnWindowFocused(true);
  const hides = f.calls.hides;
  f.hook.emit('wheel', { rotation: 1, x: 150, y: 100 });
  assert.ok(f.calls.hides > hides);

  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.hook.emit('wheel', { rotation: 1, x: 150, y: 100 });
  f.advance(100);
  assert.deepEqual(f.calls.overlays, ['copied word']);
});

test('left and non-left clicks within Voca preserve the pending icon click and do not read again', async () => {
  const f = fixture();
  f.drag();
  f.advance(100);
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['selected word']);
  f.setOwnWindowFocused(true);
  const hides = f.calls.hides;
  for (const button of [1, 2, 3]) {
    f.hook.emit('mousedown', { button, x: 150, y: 100 });
    f.hook.emit('mouseup', { button, x: 150, y: 100 });
    f.advance(1000);
    await flushPromises();
    assert.equal(f.calls.hides, hides);
    assert.equal(f.calls.reads, 1);
  }
});

test('disabled selection translation ignores mouse selections and single Ctrl+C', async () => {
  const f = fixture({ enabled: false });
  f.drag();
  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(1000);
  await flushPromises();
  assert.equal(f.calls.reads, 0);
  assert.equal(f.calls.clipboardReads, 0);
  assert.deepEqual(f.calls.icons, []);
  assert.deepEqual(f.calls.overlays, []);
});

test('disabling immediately hides the icon and rejects an in-flight selection result', async () => {
  const request = deferred();
  const f = fixture({ readSelection: () => request.promise });
  f.drag();
  f.advance(1000);
  assert.equal(f.calls.reads, 1);
  const beforeHides = f.calls.hides;
  f.controller.setEnabled(false);
  assert.ok(f.calls.hides > beforeHides);
  request.resolve('obsolete selection');
  await flushPromises();
  assert.deepEqual(f.calls.icons, []);
  f.controller.setEnabled(true);
  f.drag();
  f.advance(1000);
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['obsolete selection']);
  assert.equal(f.calls.clipboardReads, 0);
});

test('the newest drag wins when asynchronous selection reads finish out of order', async () => {
  const older = deferred(), newer = deferred();
  const requests = [older, newer];
  const f = fixture({ readSelection: () => requests.shift().promise });
  f.drag();
  f.advance(1000);
  f.drag();
  f.advance(1000);
  newer.resolve('new selection');
  await flushPromises();
  older.resolve('old selection');
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['new selection']);
});

test('navigation, app switching, and Ctrl presses invalidate an in-flight selection', async t => {
  for (const [name, keycode] of [['Alt for Alt+Tab', 4], ['Tab', 5], ['arrow navigation', 6], ['Ctrl', keys.Ctrl]]) {
    await t.test(name, async () => {
      const request = deferred();
      const f = fixture({ readSelection: () => request.promise });
      f.drag();
      f.advance(1000);
      assert.equal(f.calls.reads, 1);
      const beforeCancellations = f.calls.cancellations;
      f.keydown(keycode);
      request.resolve('selection from the previous focus');
      await flushPromises();
      assert.ok(f.calls.cancellations > beforeCancellations);
      assert.deepEqual(f.calls.icons, []);
      assert.equal(f.calls.clipboardReads, 0);
    });
  }
});

test('a new mouse gesture hides an old icon before its selection read finishes', async () => {
  const next = deferred();
  let count = 0;
  const f = fixture({ readSelection: () => ++count === 1 ? Promise.resolve('first') : next.promise });
  f.drag();
  f.advance(1000);
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['first']);
  const beforeHides = f.calls.hides;
  f.hook.emit('mousedown', { button: 1, x: 200, y: 100 });
  assert.ok(f.calls.hides > beforeHides);
  f.hook.emit('mouseup', { button: 1, x: 250, y: 100 });
  f.advance(1000);
  next.resolve('second');
  await flushPromises();
  assert.deepEqual(f.calls.icons, ['first', 'second']);
});

test('empty, unsupported, oversized, and failed selection reads never reuse clipboard text', async t => {
  for (const [name, readSelection] of [
    ['empty', async () => '  '],
    ['unsupported', async () => null],
    ['oversized', async () => 'x'.repeat(5001)],
    ['failed', async () => { throw new Error('UI Automation unavailable'); }],
  ]) {
    await t.test(name, async () => {
      const f = fixture({ readSelection });
      f.drag();
      f.advance(1000);
      await flushPromises();
      assert.deepEqual(f.calls.icons, []);
      assert.equal(f.calls.clipboardReads, 0);
      assert.ok(f.calls.hides > 0);
    });
  }
});

test('manual double Ctrl+C translates while automatic selection is disabled', () => {
  const f = fixture({ enabled: false, clipboard: '  deliberate copy  ' });
  f.keydown(keys.CtrlRight);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(100);
  assert.deepEqual(f.calls.overlays, ['deliberate copy']);
  assert.deepEqual(f.calls.icons, []);
  assert.equal(f.calls.reads, 0);
});

test('holding C does not count key auto-repeat as the second copy', () => {
  const f = fixture();
  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.advance(100);
  assert.deepEqual(f.calls.overlays, []);
  assert.deepEqual(f.calls.icons, ['copied word']);
});

test('double Ctrl+C cancels its delayed single-copy icon', () => {
  const f = fixture();
  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(1000);
  assert.deepEqual(f.calls.icons, []);
  assert.deepEqual(f.calls.overlays, ['copied word']);
});

test('disabling cancels a pending single-copy icon but preserves deliberate double-copy translation', () => {
  const f = fixture();
  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.controller.setEnabled(false);
  f.advance(100);
  assert.deepEqual(f.calls.icons, []);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.controller.setEnabled(false);
  f.advance(100);
  assert.deepEqual(f.calls.overlays, ['copied word']);
});

test('releasing one Ctrl key preserves the other held Ctrl key', () => {
  const f = fixture({ enabled: false });
  f.keydown(keys.Ctrl);
  f.keydown(keys.CtrlRight);
  f.keyup(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(50);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.advance(100);
  assert.deepEqual(f.calls.overlays, ['copied word']);
});

test('stopping removes listeners, cancels pending callbacks, and invalidates in-flight selection', async () => {
  const request = deferred();
  const f = fixture({ readSelection: () => request.promise });
  f.drag();
  f.advance(1000);
  f.keydown(keys.Ctrl);
  f.keydown(keys.C);
  f.keyup(keys.C);
  f.controller.stop();
  request.resolve('result after stop');
  f.advance(1000);
  await flushPromises();
  assert.deepEqual(f.calls.icons, []);
  assert.deepEqual(f.calls.overlays, []);
  for (const event of ['mousedown', 'mouseup', 'wheel', 'keydown', 'keyup']) assert.equal(f.hook.listenerCount(event), 0);
  assert.equal(f.calls.stops, 1);
});
