# Mimic Flow

> AI 驱动的桌面自动化工作流编排工具，让复杂的电脑操作变得像搭积木一样简单。

<p align="center">
  <a href="#-下载安装">
    <img src="https://img.shields.io/badge/平台-macOS_%7C_Windows_%7C_Linux-blue?style=for-the-badge" alt="Platform">
  </a>
  <a href="https://github.com/jibuzixin/mimic-flow/releases">
    <img src="https://img.shields.io/github/v/release/jibuzixin/mimic-flow?style=for-the-badge&color=green" alt="Release">
  </a>
  <a href="https://github.com/jibuzixin/mimic-flow/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-orange?style=for-the-badge" alt="License">
  </a>
</p>

## ⬇️ 下载安装

直接从 GitHub Releases 下载最新版本，开箱即用：

| 平台 | 下载 |
|------|------|
| **macOS (Apple Silicon)** | [下载 .dmg](https://github.com/jibuzixin/mimic-flow/releases) |
| **macOS (Intel)** | [下载 .dmg](https://github.com/jibuzixin/mimic-flow/releases) |
| **Windows** | [下载 .exe](https://github.com/jibuzixin/mimic-flow/releases) |
| **Linux** | [下载 .AppImage](https://github.com/jibuzixin/mimic-flow/releases) |

👉 [前往 Releases 页面 →](https://github.com/jibuzixin/mimic-flow/releases)

## ✨ 产品简介

Mimic Flow 是一款可视化的桌面自动化工作流编排工具，你可以通过拖拽节点的方式，像搭积木一样构建自动化流程，无需编写代码即可实现网页操作、数据处理、条件判断、循环等复杂功能。

无论是重复的网页数据录入、批量信息查询，还是日常办公中的繁琐操作，都可以用 Mimic Flow 来自动化完成，解放你的双手和时间。

## 🎯 核心功能

### 🧩 可视化流程编排
- **拖拽式编辑**：从左侧节点库拖拽节点到画布，连线即可构建工作流
- **丰富的节点类型**：条件判断、循环、变量操作、日志输出、AI 对话等 20+ 种节点
- **实时参数配置**：选中节点后在右侧属性面板配置参数，所见即所得

### 🤖 AI 驱动的网页自动化
- **Midscene 引擎**：基于 AI 视觉驱动的网页自动化，像人一样"看"网页并操作
- **自然语言描述**：用中文描述要做什么，AI 自动理解并执行
- **智能元素定位**：不需要写 CSS 选择器或 XPath，AI 自动识别页面元素

### 🔀 强大的流程控制
- **条件分支**：IF / ELSE 条件判断，根据不同情况走不同流程
- **循环执行**：支持循环计数器、条件循环等多种循环模式
- **变量管理**：定义和使用变量，在节点间传递数据
- **错误处理**：节点失败时自动重试或跳过，保证流程稳定运行

### 📊 执行与监控
- **悬浮进度窗**：执行时最小化到悬浮球，实时查看执行进度和当前步骤
- **详细日志**：每一步执行都有详细日志，方便排查问题
- **执行记录**：自动保存每次执行记录，随时回溯查看
- **Midscene 报告**：集成 Midscene HTML 报告，可视化追踪网页操作过程

### 💻 本地优先
- **本地文件存储**：所有工作流保存在本地，数据安全可控
- **支持导入导出**：工作流文件可分享给他人使用
- **开箱即用**：无需配置服务器，下载安装即可使用

## 🚀 快速开始

### 安装依赖

```bash
npm install
# 或者
yarn install
```

### 启动开发模式

```bash
npm run dev
```

启动后会同时打开 Vite 开发服务器和 Electron 桌面应用。

### 构建安装包

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

构建产物会输出到 `release/` 目录。

### 发布到 GitHub Releases

项目已配置 GitHub Actions 自动构建和发布流程。推送一个 `v` 开头的 tag 即可自动触发三大平台的构建并发布到 Releases：

```bash
# 1. 打 tag
git tag v0.1.0

# 2. 推送 tag
git push origin v0.1.0
```

然后 GitHub Actions 会自动：
- 在 macOS 上构建 `.dmg`（x64 + arm64）
- 在 Windows 上构建 `.exe` 安装包
- 在 Linux 上构建 `.AppImage`
- 自动发布到 GitHub Releases 页面

## 📖 使用指南

### 创建第一个工作流

1. 打开应用后，点击左侧「新建工作流」
2. 输入工作流名称，选择保存位置
3. 进入编辑器页面，从左侧节点库拖拽节点到画布
4. 用鼠标连接节点，形成流程链路
5. 选中每个节点，在右侧配置参数
6. 点击右上角「运行」按钮，查看执行效果

### 常用节点说明

| 节点类型 | 功能 | 使用场景 |
|---------|------|---------|
| **开始/结束** | 标记流程的起止 | 每个工作流必须有一个开始节点 |
| **条件判断** | IF/ELSE 分支 | 根据条件走不同流程 |
| **循环** | 循环执行子流程 | 重复执行某段操作 |
| **变量** | 设置/读取变量 | 在节点间传递数据 |
| **日志** | 输出日志信息 | 调试和记录执行过程 |
| **等待** | 暂停一段时间 | 等待页面加载或操作间隔 |
| **AI 对话** | 调用大语言模型 | 文本生成、翻译、总结等 |
| **Midscene 网页操作** | AI 驱动的网页自动化 | 网页点击、输入、数据提取等 |

### Midscene 引擎使用

Midscene 是一个基于 AI 视觉的网页自动化引擎，你只需要用自然语言描述操作，它就能自动在网页上执行。

**配置步骤：**

1. 在「设置」页面配置 AI 模型（推荐使用字节豆包）
2. 添加「Midscene 网页操作」节点
3. 在节点中输入操作指令（中文自然语言）
4. 运行时会自动打开浏览器并执行操作

**示例指令：**
- 「打开百度，搜索 Mimic Flow，点击第一个搜索结果」
- 「在搜索框中输入 '今天天气'，然后按回车」
- 「找到页面上的登录按钮并点击」

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 18 + TypeScript + Vite | 现代化前端开发体验 |
| 桌面端 | Electron 32 | 跨平台桌面应用框架 |
| 流程编辑器 | @xyflow/react (React Flow) | 强大的节点编辑器 |
| 样式 | Tailwind CSS + shadcn/ui | 美观的 UI 组件 |
| 状态管理 | Zustand | 轻量且强大的状态管理 |
| AI 自动化 | Midscene.js | AI 驱动的网页自动化引擎 |
| 视频解析 | FFmpeg | 视频帧提取（可选功能） |

## 📁 项目结构

```
├── src/                  # 前端渲染进程代码
│   ├── components/       # React 组件
│   │   ├── editor/       # 流程编辑器相关组件
│   │   └── ui/           # 基础 UI 组件 (shadcn/ui)
│   ├── pages/            # 页面组件（工作台、编辑器、设置等）
│   ├── stores/           # Zustand 状态管理
│   ├── hooks/            # 自定义 Hooks
│   └── lib/              # 工具函数
├── electron/             # Electron 主进程代码
│   ├── runtime-v2/       # v2 工作流运行时（调度层）
│   ├── engines/          # 执行引擎（插件化架构）
│   ├── execution/        # 执行记录与日志服务
│   ├── ai/               # AI 模型适配层（豆包等）
│   ├── midscene/         # Midscene 适配器
│   ├── video/            # 视频解析模块
│   └── main.ts           # 主进程入口
├── types/                # 前后端共享类型定义
├── docs/                 # 项目文档与设计方案
├── examples/             # 示例工作流
├── tests/                # 测试用例
└── README.md
```

## 🧪 示例

项目 `examples/` 目录下有几个示例工作流，可以直接导入使用：

- `01-简单线性流程.flow.json` - 基础的线性执行流程
- `02-条件分支判断.flow.json` - IF/ELSE 条件判断演示
- `03-循环计数器.flow.json` - 循环节点使用示例
- `04-变量操作演示.flow.json` - 变量定义和使用

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📝 致谢

- [midscene](https://midscenejs.com/zh/) 作为 AI 执行引擎的支持；
- [UI-TARS](https://github.com/bytedance/ui-tars) 代码学习；

## 📄 开源协议

[MIT License](LICENSE)

---

<p align="center">
  Made with ❤️ by Mimic Flow Team
</p>
