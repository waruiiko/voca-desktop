// Keep automatic selection reads separate from deliberate clipboard shortcuts.
function createSelectionTranslationController({
  hook, keys, readSelection, readClipboard, showIcon, hideIcon, showOverlay,
  isOwnWindowFocused = () => false, cancelReadSelection = () => {},
  reportDiagnostic = () => {},
  schedule = setTimeout, cancelSchedule = clearTimeout, now = Date.now,
  enabled = true,
}) {
  let active = false;
  let generation = 0;
  let mouseStart = null;
  let previousClick = null;
  let automaticTimer = null;
  let manualTimer = null;
  let lastCopyTime = null;
  let cDown = false;
  const ctrlKeys = new Set();
  const shiftKeys = new Set();
  const selectionNavigationKeys = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down',
    'Home', 'End', 'PageUp', 'PageDown', 'NumpadArrowLeft', 'NumpadArrowRight',
    'NumpadArrowUp', 'NumpadArrowDown', 'NumpadHome', 'NumpadEnd', 'NumpadPageUp', 'NumpadPageDown',
  ].map(name => keys[name]).filter(key => key !== undefined));

  function diagnose(stage, status, trigger, attempt) {
    // Only fixed state labels are emitted; selected text is never diagnostic data.
    try { reportDiagnostic({ stage, status, trigger, attempt }); } catch {}
  }

  function validText(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length <= 5000 ? text : '';
  }

  function invalidateSelection() {
    generation += 1;
    mouseStart = null;
    cancelReadSelection();
    if (automaticTimer !== null) cancelSchedule(automaticTimer);
    automaticTimer = null;
  }

  function selectionIsCurrent(request, point) {
    return active && enabled && generation === request && !isOwnWindowFocused(point);
  }

  function scheduleSelectionRead(point, trigger, request = generation, attempt = 1) {
    if (!selectionIsCurrent(request, point)) return;
    diagnose('selection', 'scheduled', trigger, attempt);
    automaticTimer = schedule(async () => {
      automaticTimer = null;
      if (!selectionIsCurrent(request, point)) return;
      diagnose('selection', 'reading', trigger, attempt);
      try {
        const value = await readSelection(point);
        if (!selectionIsCurrent(request, point)) return;
        const text = validText(value);
        if (text) {
          diagnose('selection', 'selected', trigger, attempt);
          showIcon(text);
          return;
        }
        hideIcon();
        const oversized = typeof value === 'string' && value.trim().length > 5000;
        diagnose('selection', oversized ? 'oversized' : 'empty', trigger, attempt);
        // A few controls publish their selection after mouseup/keydown has returned.
        // Retry once, retaining the same generation so any new input cancels it.
        if (!oversized && attempt === 1) scheduleSelectionRead(point, trigger, request, 2);
      } catch {
        if (!selectionIsCurrent(request, point)) return;
        diagnose('selection', 'failed', trigger, attempt);
        hideIcon();
      }
    }, attempt === 1 ? 100 : 150);
  }

  function onMouseDown(event) {
    if (!active) return;
    invalidateSelection();
    // A click on the floating icon must reach its renderer before it is hidden.
    if (event.button !== 1) {
      previousClick = null;
      if (!isOwnWindowFocused(event)) hideIcon();
      return;
    }
    if (!enabled || isOwnWindowFocused(event)) {
      previousClick = null;
      return;
    }
    hideIcon();
    mouseStart = {
      x: event.x, y: event.y, clicks: event.clicks,
      shiftPressed: shiftKeys.size > 0 || event.shiftKey === true,
    };
  }

  function onMouseUp(event) {
    if (!active || !enabled || event.button !== 1 || !mouseStart) return;
    const start = mouseStart;
    mouseStart = null;
    if (isOwnWindowFocused(event)) {
      previousClick = null;
      return;
    }
    const moved = Math.hypot(event.x - start.x, event.y - start.y) >= 2;
    const time = now();
    const repeatedClick = event.clicks >= 2 || start.clicks >= 2 || (previousClick
      && time - previousClick.time >= 0 && time - previousClick.time <= 500
      && Math.hypot(event.x - previousClick.x, event.y - previousClick.y) <= 5);
    previousClick = moved ? null : { x: event.x, y: event.y, time };
    // A plain click cancels existing work without launching a costly UIA helper.
    // Tiny drags, repeated clicks and Shift+click can create a real selection.
    if (!moved && !repeatedClick && !start.shiftPressed && !event.shiftKey && !shiftKeys.size) return;
    scheduleSelectionRead({ x: event.x, y: event.y, originX: start.x, originY: start.y }, 'mouse');
  }

  function onWheel() {
    if (!active) return;
    // Scrolling can move the selection away from the captured gesture and icon.
    previousClick = null;
    invalidateSelection();
    hideIcon();
  }

  function onKeyDown(event) {
    if (!active) return;
    previousClick = null;
    if (event.keycode === keys.Ctrl || event.keycode === keys.CtrlRight) {
      invalidateSelection();
      ctrlKeys.add(event.keycode);
      return;
    }
    if (event.keycode === keys.Shift || event.keycode === keys.ShiftRight) {
      invalidateSelection();
      shiftKeys.add(event.keycode);
      hideIcon();
      lastCopyTime = null;
      return;
    }
    const controlPressed = ctrlKeys.size > 0 || event.ctrlKey === true;
    if (event.keycode !== keys.C || !controlPressed) {
      invalidateSelection();
      hideIcon();
      lastCopyTime = null;
      const shiftPressed = shiftKeys.size > 0 || event.shiftKey === true;
      if (!event.altKey && !event.metaKey && (
        (shiftPressed && selectionNavigationKeys.has(event.keycode))
        || (controlPressed && keys.A !== undefined && event.keycode === keys.A)
      )) {
        // No pointer is supplied: keyboard selection belongs to the focused control.
        scheduleSelectionRead(undefined, 'keyboard');
      }
      return;
    }
    if (cDown) return;
    cDown = true;
    // User copy takes precedence over an in-flight automatic selection read.
    invalidateSelection();
    const time = now();
    if (lastCopyTime !== null && time - lastCopyTime > 0 && time - lastCopyTime < 600) {
      lastCopyTime = null;
      hideIcon();
      if (manualTimer !== null) cancelSchedule(manualTimer);
      manualTimer = schedule(() => {
        manualTimer = null;
        if (!active) return;
        const text = validText(readClipboard());
        if (text) showOverlay(text);
      }, 100);
    } else {
      lastCopyTime = time;
      if (!enabled) return;
      const request = generation;
      automaticTimer = schedule(() => {
        automaticTimer = null;
        if (!active || !enabled || generation !== request) return;
        const text = validText(readClipboard());
        if (text) showIcon(text);
      }, 100);
    }
  }

  function onKeyUp(event) {
    ctrlKeys.delete(event.keycode);
    shiftKeys.delete(event.keycode);
    if (event.keycode === keys.C) cDown = false;
  }

  const listeners = { mousedown: onMouseDown, mouseup: onMouseUp, wheel: onWheel, keydown: onKeyDown, keyup: onKeyUp };
  return {
    start() {
      if (active) return;
      active = true;
      for (const [event, listener] of Object.entries(listeners)) hook.on(event, listener);
      try { hook.start(); } catch (error) { this.stop(); throw error; }
    },
    setEnabled(value) {
      enabled = value !== false;
      previousClick = null;
      invalidateSelection();
      if (!enabled) hideIcon();
    },
    stop() {
      if (!active) return;
      active = false;
      previousClick = null;
      invalidateSelection();
      if (manualTimer !== null) cancelSchedule(manualTimer);
      manualTimer = null;
      lastCopyTime = null;
      cDown = false;
      ctrlKeys.clear();
      shiftKeys.clear();
      for (const [event, listener] of Object.entries(listeners)) hook.removeListener(event, listener);
      hook.stop();
      hideIcon();
    },
  };
}

module.exports = { createSelectionTranslationController };
