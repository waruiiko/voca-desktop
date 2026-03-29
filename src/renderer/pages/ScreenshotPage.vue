<template>
  <div
    class="ss-root"
    @mousedown.prevent="onDown"
    @mousemove="onMove"
    @mouseup="onUp"
  >
    <canvas ref="canvasRef" class="ss-canvas"></canvas>
    <div class="ss-hint" v-if="!dragging && !processing">拖动选择文字区域，按 Esc 取消</div>
    <div class="ss-processing" v-if="processing">识别中…</div>
    <div v-if="dragging" class="ss-rect" :style="rectStyle"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const canvasRef = ref(null);
const dragging = ref(false);
const processing = ref(false);
const startX = ref(0);
const startY = ref(0);
const endX = ref(0);
const endY = ref(0);

const rectStyle = computed(() => {
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);
  const w = Math.abs(endX.value - startX.value);
  const h = Math.abs(endY.value - startY.value);
  return { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' };
});

onMounted(() => {
  const canvas = canvasRef.value;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});

function onEsc(e) {
  if (e.key === 'Escape') window.vocaAPI.cancelScreenshot();
}
onMounted(() => window.addEventListener('keydown', onEsc));
onUnmounted(() => window.removeEventListener('keydown', onEsc));

function onDown(e) {
  if (processing.value) return;
  dragging.value = true;
  startX.value = e.clientX;
  startY.value = e.clientY;
  endX.value = e.clientX;
  endY.value = e.clientY;
}

function onMove(e) {
  if (!dragging.value) return;
  endX.value = e.clientX;
  endY.value = e.clientY;
}

async function onUp(e) {
  if (!dragging.value) return;
  dragging.value = false;
  endX.value = e.clientX;
  endY.value = e.clientY;

  const w = Math.abs(endX.value - startX.value);
  const h = Math.abs(endY.value - startY.value);
  if (w < 10 || h < 10) { window.vocaAPI.cancelScreenshot(); return; }

  processing.value = true;
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);

  // 主进程会先关闭此窗口再截屏，避免遮罩出现在截图中
  await window.vocaAPI.captureRegionOcr(x, y, w, h);
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent; overflow: hidden; }
</style>

<style scoped>
.ss-root {
  position: fixed; inset: 0;
  cursor: crosshair;
  user-select: none;
}
.ss-canvas {
  position: absolute; inset: 0; display: block;
}
.ss-hint {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.65); color: #fff;
  padding: 10px 22px; border-radius: 10px;
  font-size: 15px; font-family: system-ui, sans-serif;
  pointer-events: none; white-space: nowrap;
}
.ss-processing {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(99,102,241,0.9); color: #fff;
  padding: 10px 22px; border-radius: 10px;
  font-size: 15px; font-family: system-ui, sans-serif;
  pointer-events: none;
}
.ss-rect {
  position: absolute;
  border: 2px solid #6366f1;
  background: rgba(99,102,241,0.08);
  pointer-events: none;
}
</style>
