import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';
import MainPage from './pages/MainPage.vue';
import OverlayPage from './pages/OverlayPage.vue';
import IconPage from './pages/IconPage.vue';
import ScreenshotPage from './pages/ScreenshotPage.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/',           component: MainPage },
    { path: '/overlay',    component: OverlayPage },
    { path: '/icon',       component: IconPage },
    { path: '/screenshot', component: ScreenshotPage },
  ],
});

createApp(App).use(router).mount('#app');
