# 📖 Voca

轻量桌面单词学习工具，支持全局划词翻译、OCR 截图识别、闪卡复习与生词本管理。

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-1.0.0-purple)

## 下载

前往 [Releases](https://github.com/waruiiko/voca-desktop/releases/latest) 下载最新版安装包。

> 系统要求：Windows 10 / 11 (x64)

## 功能

- **全局划词翻译** — 选中文字后按住 Ctrl 快速双击 C，悬浮翻译窗口即时弹出
- **OCR 截图翻译** — Ctrl+Shift+O 框选屏幕任意区域，自动识别文字并翻译
- **一键收藏** — 在悬浮窗点击 ⭐，单词连同翻译存入生词本
- **闪卡复习** — 基于 SM-2 算法智能安排复习间隔，有到期提醒
- **多生词本** — 按主题分类管理，支持导入/导出，内置 IELTS / TOEFL / GRE 预设词表
- **学习统计** — 打卡连续天数、掌握程度分布、每日目标进度
- **全局搜索** — 跨所有生词本搜索单词或翻译
- **Anki 导出** — 导出为 TSV 格式，可直接导入 Anki
- **多翻译引擎** — 支持 Google 翻译、DeepL、MyMemory

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 打包
npm run dist
```

**技术栈：** Electron · Vue 3 · Vite

## License

MIT
