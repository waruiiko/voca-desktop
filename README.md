# 📖 Voca

轻量桌面单词学习工具，支持全局划词翻译、OCR 截图识别、闪卡复习与生词本管理。

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-1.0.3-purple)

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

## 更新日志

### v1.0.3
- 修复悬浮翻译窗口与"译"图标窗口的 CSS 样式泄漏导致主窗口白屏的问题
- 修复 iconWindow 已销毁时触发 hide() 报错的问题

### v1.0.2
- 修复应用图标未正确显示的问题
- 新增开机自动启动开关（设置 → 系统）

### v1.0.1
- 新增数据自动备份（每次保存时自动生成 .bak 文件）
- 新增悬浮窗最近查词记录（最多显示 5 条）
- 新增 Anki 导出格式（TSV，可直接导入 Anki）
- 新增每日学习目标设置与进度显示
- 支持短语/长句收藏（字数限制从 500 提升至 5000）
- 新增全局搜索（跨所有生词本）
- 修复托盘退出无法真正退出程序的问题
- 侧边栏新增 OCR 快捷键说明

### v1.0.0
- 首个正式版本发布

## License

MIT
