# mimic-flow

AI 驱动的桌面自动化工作流编排工具，让复杂的电脑操作变得简单直观。

## ✨ 功能特性

- **可视化流程编排**：类似 Scratch 的积木式编辑，拖拽节点即可构建工作流
- **Midscene 引擎**：基于 AI 视觉驱动的网页自动化能力
- **多引擎支持**：插件化引擎架构，支持 Midscene 和内置引擎
- **悬浮进度窗**：执行时可最小化到悬浮窗，实时查看进度
- **工作流管理**：本地文件存储，支持保存、另存为、版本管理
- **详细日志**：集成 Midscene HTML 报告，完整追踪执行过程

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Vite + Tailwind CSS
- **桌面端**：Electron 32
- **工作流引擎**：@xyflow/react (React Flow)
- **AI 自动化**：Midscene.js
- **状态管理**：Zustand
- **UI 组件**：shadcn/ui + Radix UI

## 📦 安装

```bash
# 安装依赖
npm install
# 或
yarn install
```

## 🚀 开发

```bash
# 启动开发模式（同时启动 Vite 和 Electron）
npm run dev
```

## 🏗️ 构建

```bash
# 构建当前平台安装包
npm run dist

# 仅构建 macOS
npm run dist:mac

# 仅构建 Windows
npm run dist:win

# 仅构建 Linux
npm run dist:linux
```

## 📁 项目结构

```
├── src/                  # 前端渲染进程代码
│   ├── components/       # React 组件
│   │   ├── editor/       # 流程编辑器相关组件
│   │   └── ui/           # 基础 UI 组件 (shadcn/ui)
│   ├── pages/            # 页面组件
│   ├── stores/           # Zustand 状态管理
│   ├── hooks/            # 自定义 Hooks
│   └── lib/              # 工具函数
├── electron/             # Electron 主进程代码
│   ├── runtime-v2/       # v2 工作流运行时（调度层）
│   ├── engines/          # 执行引擎（插件化）
│   ├── execution/        # 执行记录与日志
│   ├── ai/               # AI 模型适配层
│   ├── video/            # 视频解析模块
│   └── main.ts           # 主进程入口
├── types/                # 共享类型定义
├── docs/                 # 项目文档
├── examples/             # 示例工作流
└── tests/                # 测试用例
```

## 🤝 致谢

- **[Midscene.js](https://midscenejs.com)** - 提供 AI 视觉驱动的网页自动化能力，本项目的核心引擎之一

## 📄 开源协议

[MIT License](LICENSE)
