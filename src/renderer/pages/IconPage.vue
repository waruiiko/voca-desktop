<template>
  <div class="icon-btn" @click="translate" title="点击翻译">
    <span>译</span>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
onMounted(() => document.body.classList.add('is-icon'));
onUnmounted(() => document.body.classList.remove('is-icon'));
function translate() {
  window.vocaAPI.iconClicked();
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body.is-icon {
  width: 44px; height: 44px;
  max-width: 44px; max-height: 44px;
  overflow: hidden; background: #6366f1 !important;
}

.icon-btn {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none;
  transition: opacity 0.1s; overflow: hidden;
}
.icon-btn:hover  { opacity: 0.88; }
.icon-btn:active { opacity: 0.7; }
.icon-btn span {
  color: #fff;
  font-size: 17px; font-weight: 800;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1;
}
</style>
