<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="build/icon.png">
    <img src="build/icon.png" alt="Mimic Flow" width="120" height="120" style="border-radius: 24px;">
  </picture>
</p>

<h1 align="center">Mimic Flow</h1>

<p align="center">
  <b>可视化流程编排 × AI 驱动 × 双引擎桌面自动化</b>
</p>

<p align="center">
  <a href="https://github.com/jibuzixin/mimic-flow/releases">
    <img src="https://img.shields.io/github/v/release/jibuzixin/mimic-flow?style=flat&color=8b5cf6&label=版本" alt="Release">
  </a>
  <a href="https://github.com/jibuzixin/mimic-flow/releases">
    <img src="https://img.shields.io/badge/平台-macOS%20%7C%20Windows%20%7C%20Linux-06b6d4?style=flat" alt="Platform">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/协议-MIT-f472b6?style=flat" alt="License">
  </a>
  <a href="https://github.com/jibuzixin/mimic-flow/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/jibuzixin/mimic-flow/release.yml?style=flat&color=22c55e" alt="Build">
  </a>
</p>

<p align="center">
  <a href="#-下载安装">📥 下载</a> ·
  <a href="#-核心功能">✨ 功能</a> ·
  <a href="#-midscene-对比">⚡ Midscene 对比</a> ·
  <a href="#-快速开始">🚀 快速开始</a> ·
  <a href="#-技术栈">🛠️ 技术栈</a>
</p>

<br>

## 📥 下载安装

从 [GitHub Releases](https://github.com/jibuzixin/mimic-flow/releases) 下载最新版本，开箱即用：

| 平台 | 下载 |
|------|------|
| **macOS** (Apple Silicon / Intel) | [下载 .dmg](https://github.com/jibuzixin/mimic-flow/releases) |
| **Windows** | [下载 .exe](https://github.com/jibuzixin/mimic-flow/releases) |
| **Linux** | [下载 .AppImage](https://github.com/jibuzixin/mimic-flow/releases) |

> 💡 首次使用系统操作节点时，macOS 需要授予「辅助功能」权限。
> Mac 如果显示软件已损坏，需要在终端执行 `sudo xattr -rd com.apple.quarantine /Applications/Mimic Flow.app`

---

## ✨ 核心功能

### 🧩 可视化流程编排

拖拽节点、连接线条、一键运行——像搭积木一样构建自动化流程。

- **20+ 节点类型**：开始/结束、条件判断、循环、变量操作、日志、AI 操作、鼠标点击、键盘输入、图像等待等
- **实时参数配置**：选中节点即配即用，所见即所得
- **执行状态追踪**：节点逐一亮起，运行过程一目了然

### 🤖 双引擎混合架构

| | AI 智能引擎 (Midscene) | 本地执行引擎 (System) |
|---|---|---|
| **定位方式** | 多模态 AI 视觉理解 | 模板图像匹配 + 坐标 |
| **适用场景** | 页面变化快、元素不明确 | 固定稳定、重复操作 |
| **速度** | 秒级（需联网） | 毫秒级（纯本地） |
| **成本** | 消耗 token | 零成本 |

**同一个工作流里两个引擎混搭**——不稳定的部分交给 AI，稳定的部分本地跑，又快又省。

### 🔀 完整的流程控制

**Midscene 做不到的，Mimic Flow 补上了：**

- **条件分支 (IF/ELSE)**：根据变量或表达式结果走不同路径
- **循环控制**：`For` 计数循环、`While` 条件循环、`ForEach` 遍历循环
- **变量系统**：数值/字符串/数组/对象操作，节点间数据传递，`{{var}}` 插值
- **错误处理**：节点失败自动重试，支持 `stop` / `continue` 策略

### ⏰ 定时任务调度

内置调度器，让工作流按计划自动运行：

- **一次性**：指定时间执行一次
- **间隔重复**：每 N 分钟/小时执行
- **Cron 表达式**：5 段或 6 段标准 cron，精确到秒
- **任务队列**：串行执行，避免键鼠冲突
- **通知提醒**：任务触发/完成/失败实时通知

### 📊 执行监控与记录

- **悬浮进度窗**：最小化时悬浮球显示实时进度
- **详细日志**：每步执行都有日志，支持搜索和筛选
- **执行记录**：自动保存，按状态/时间筛选回溯
- **Midscene 报告**：集成 AI 操作报告，可视化追踪

### 💻 本地优先

- 所有工作流和记录保存在本地，数据安全可控
- 工作流文件可导入导出，方便分享
- 无需服务器，下载即用

---

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（同时启动 Vite + Electron）
npm run dev

# 构建安装包
npm run dist
```

构建产物输出到 `release/` 目录。

### 发布到 GitHub Releases

```bash
# 打 tag 并推送，自动触发 CI 构建
git tag v0.2.0
git push origin v0.2.0
```

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18 + TypeScript + Vite |
| **桌面框架** | Electron 32 |
| **流程编辑器** | @xyflow/react (React Flow) |
| **样式** | Tailwind CSS + shadcn/ui |
| **状态管理** | Zustand |
| **AI 引擎** | Midscene.js |
| **本地引擎** | robotjs + opencv-wasm + sharp |
| **数据存储** | sql.js (SQLite) + 本地 JSON |

---

## 📁 项目结构

```
├── src/                     # 前端渲染进程
│   ├── components/          # React 组件
│   │   ├── editor/          # 流程编辑器
│   │   └── ui/              # 基础 UI 组件
│   ├── pages/               # 页面
│   ├── stores/              # Zustand 状态管理
│   └── hooks/               # 自定义 Hooks
├── electron/                # Electron 主进程
│   ├── runtime-v2/          # 工作流运行时（调度层）
│   ├── engines/             # 执行引擎（Midscene + System）
│   ├── execution/           # 执行记录服务
│   └── main.ts              # 主进程入口
├── types/                   # 共享类型定义
└── landing/                 # 产品介绍页
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 开源协议

[MIT License](LICENSE)

---

<p align="center">
  Made with ❤️ by Mimic Flow Team
</p>