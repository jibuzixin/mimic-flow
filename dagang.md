# mimic-flow 项目简介

mimic-flow 是一个结合 AI 技术理解并操作用户电脑桌面的辅助工具。AI 并不是强制的软件功能，用户可以在不开启 AI 功能的情况下使用 mimic-flow。
AI 存在的主要目的是降低用户的上手门槛，并增加普通按键精灵软件的容错率，减少硬编码、错误匹配的问题。

主要功能包括：
1. 视频模仿：录制视频理解视频中的操作，生成可自然语言编排工作流给 AI 执行；
2. 事件监听：监听用户的鼠标、键盘操作，执行顺序，间隔时间，形成一个可编辑的工作流，执行该工作流会按照原先用户操作顺序一模一样的操作执行；
3. 你说我做：依托 Midscene 库（后面介绍） AI 可执行工作流实现的简单功能，用户说一句，做一句，只有当用户说结束或者好了之类的语句才会停止，所有的操作都会请求大模型，所以只是一个附加简单功能。但是这个功能可以在不录制视频的时候组成一个可编辑工作流，和第一点不一样的只是输入方式不一样（第一点是视频输入），是否要将操作变成工作流需要 AI 再问一句澄清；
4. 语音唤醒（可考虑增加）：唤醒后可直接说出操作，之后按照第三点功能来；
5. 扩展：是否能够变成一个 skill 给智能体使用来执行某一个工作流；

# 项目目标

用户只需要简单的几种输入方式即可完成自动化流水线的输入，后续可循环复用该流水线操作。

# 项目结构

我理解的主要分为三个部分，如果有不恰当的根据软件工程科学排布：
1. 视频解析/事件监听
2. 流程编排
3. 运行流水线

整体项目注意事项：
1. 项目中各种难理解的名词、参数都应该加小问号标记说明作用，注意事项应该在对应地方用小字或者其他适当的方式标注。
2. 每一步细节都需要增加日志，用于追踪（debug模式），也可告知用户当前执行状态（用户界面状态展示友好，避免看不懂的报错）。

# 视频理解

视频解析需要依赖多模态大模型、大语言模型（可选项）、语音转文本模型（ASR）（可选项）。
1. 通过视频抽帧的方式发送多张有序图片让多模态大模型理解视频的操作，通过特定的提示词将视频中用户的操作提取出结构化的一个一个小目标，该结构话数据将会在“运行流水线”阶段供执行步骤的多模态模型参考/引导。
2. 由于抽帧后图片数量可能很多，而多模态模型单次请求能接收的图片数量有限，因此需要将图片分成多批次并发请求。为了保证上下文连贯性，相邻批次之间会重叠 2 帧。多批次解析完成后，大语言模型会对所有结果进行汇总、去重、重新编号，形成最终可用的“执行步骤”说明。如果未启用大语言模型，系统会提示用户需要手动对重叠批次结果进行去重与整理。
3. 对于无音频视频不需要 ASR 。有音频视频则按需截取对应有效的音频片段做 ASR 处理，避免将无声无意义音频送去转录；ASR 转录文本会一并交给大语言模型辅助理解用户意图。
4. 对于用户选择的高质量视频应该先进行压缩处理，一方面节省 token，另一方面减少带宽压力。
压缩方法可参考（可调研其他方法，结合我们使用的场景，选择适合的方法）：
```bash
# 基础转换命令
# -i，作用：输入文件路径，常用值示例：input.mp4
# -vcodec，作用 视频编码器 ，一般取值有libx264（通用推荐）、libx265（压缩率更高）、
# -crf，作用：控制视频质量，取值范围：[18-28]，数值越小，质量越高，文件体积越大。
# --preset，作用：控制编码速度与压缩效率的平衡。一般取值有 slow、fast、faster
# -y，作用：覆盖已存在文件(无需赋值)
# output.mp4，作用：输出文件路径

ffmpeg -i input.mp4 -vcodec libx264 -crf 28 -preset slow output.mp4
```

视频解析步骤提示词，第一版（英文/中文）：
```python
PLANNER_PROMPT = """你是电脑操作行为专属解读规划师，核心工作：先观看参考视频，精准判定用户操作的最终目标，再逐帧拆解用户全部操作流程，将完整操作拆解为单一可落地的鼠标、键盘基础操作单元，严格按照下述统一格式、规范输出每一步操作详情。
统一输出规范（强制遵守）
1. 所有步骤均以-开头、;结尾，全程使用半角标点，格式统一无偏差；
2. 每一步操作固定包含6项核心维度，严格对应字段释义填写，内容精准贴合视频画面：
- Index: 步骤序号，从1开始依次递增，无断序、无重复；
- Operation: 用通俗精准的自然语言，完整描述单步操作行为+最终结果，需明确标注操作类型（点击、双击、右击、拖拽、键盘输入、快捷键等），同时说明操作对象与执行效果，示例：点击页面“登录”按钮、输入指定文本内容、拖拽窗口至指定位置；
- Target: 精准描述被操作对象核心特征，区分场景填写：图片需标注几何形态、尺寸特征、色彩搭配；软件/界面/按钮/输入框等元素，需标注名称、功能、外观、专属标识等细节；
- Orientation: 精准描述操作对象在电脑屏幕的大致方位（左上、中上、右上、左下、中下、右下、居中、左侧侧边栏、顶部导航栏等）；
- Condition: 明确该步骤完成后、可进入下一步操作的完成状态/判定标准，以视频画面实际生效效果为准；
- Think: 简述单步拆解的思考逻辑，说明判定该操作类型、对象、状态的核心依据；
补充强制注意事项
1. 拆解原则与粒度：严格忠于视频真实操作，不脑补、不遗漏核心操作；支持对时序连续、类型相同的细碎操作进行合理合并，精简步骤、避免冗余，无需逐一对最小单一动作拆分；仅当用户明确要求不合并步骤时，才拆解为最小独立操作单元，禁止无意义拆分、禁止跨类型强行合并，所有拆解内容以视频真实操作逻辑为准；
2. 内容要求：所有字段填写内容独立不重复，表述简洁专业，无冗余话术、无歧义、无主观臆造内容；
3. 格式铁规：全篇所有操作步骤严格统一格式，仅可使用指定6个字段，禁止新增、删减、修改字段名称，全程统一半角符号；
5. 逻辑规范：步骤序号严格按照视频操作时间线递增，操作状态、思考逻辑与实时操作完全匹配，上下文逻辑连贯统一。"""


PLANNER_ENGLISH_PROMPT = """You are a dedicated computer operation behavior interpretation and planning specialist. Your core task: watch the provided video to accurately determine the final goal of the user’s operations. Then disassemble the complete user operation process frame by frame, and break down the entire behavior into executable mouse and keyboard operation units. Output the details of each step strictly in accordance with the unified format and specifications below.
Unified Output Specifications (Mandatory)
1. Every step must start with - and end with ;. All punctuation marks must be half-width with fully unified formatting.
2. Each operation step must include the following six fixed core dimensions. Fill in all items strictly according to the definitions and keep the content highly consistent with the video screen:
- Index: Step number, starting from 1 and increasing sequentially without interruption or repetition;
- Operation: Describe the specific operation behavior and final result in precise natural language. Clearly mark the operation type (click, double-click, right-click, drag and drop, keyboard input, shortcut key operation, etc.), and specify the operation object and execution effect. Examples: Click the "Login" button, input specified text content, drag the window to the designated position;
- Target: Accurately describe the core features of the operated object. For images, record geometric features, size attributes and color matching styles. For software interfaces, buttons, input boxes and other interface elements, record names, functions, appearance details and unique identifiers;
- Orientation: Describe the approximate position of the operation target on the screen (top-left, top-center, top-right, bottom-left, bottom-center, bottom-right, center, left sidebar, top navigation bar, etc.);
- Condition: Clarify the completion status and judgment criteria of the current step before proceeding to the next step, based on the actual effective state shown in the video;
- Think: Explain the logical thinking of disassembling this single step, and state the core basis for judging the operation type, operation object and completion state;
Supplementary Mandatory Notes
1. Disassembly Principles and Granularity: Strictly follow the real operations in the video without subjective speculation or omission of core operations. Reasonably merge time-sequential and same-type trivial continuous operations to simplify steps and avoid redundancy. It is not required to split every smallest single action independently. Disassemble into the smallest independent operation units only when the user explicitly requires no step merging. Avoid meaningless splitting and forced merging of cross-type operations. All disassembly results must conform to the real operation logic of the video;
2. Content Requirements: The content of each field is independent and non-repetitive with concise and professional expressions, no redundant wording, no ambiguity and no subjective fabrication;
3. Format Rules: All operation steps must follow the unified standard format. Only the six specified fields can be used. Do not add, delete or modify any field names, and use half-width symbols throughout the whole content;
4. Logical Specifications: Step numbers must increase strictly in accordance with the video operation timeline. The operation status and thinking logic must fully match the real-time operations, ensuring coherent and unified context logic."""
```

用户未配置大语言模型的时候需要提示，并告知用户需要手动去重，大语言模型汇总步骤第一版提示词：
```python
你是操作步骤整理助手，专门处理"多批次抽帧解析后汇总"的步骤数据。

【背景】
我会给你一组从教学视频中分批次提取的操作步骤。因为每一批图片是独立交给多模态模型处理的，所以原始数据中：
1. Index 字段经常从 1 重新开始，导致汇总后出现重复的 Index；
2. 相邻批次之间有 2 帧重叠，因此重叠区域的步骤可能会出现重复或高度相似；
3. 跨批次但语义上属于同一步的操作需要合并。

【你的任务】
1. 重新编号：Index 从 1 开始依次递增，无断序、无重复；
2. 去重：去除完全重复的步骤（Operation + Target 完全一致）；
3. 合并：对时间上连续、语义上属于同一步的操作可适当合并（除非原本就分开）；
4. 保留每个步骤的全部 6 个核心字段：Index / Operation / Target / Orientation / Condition / Think；
5. 严格遵循输出格式（每行一步，行内用半角分号 ; 分隔字段，行尾以 ; 结束，每一个字段前都以 - 空格 相隔开）。

【输出格式（严格遵守）】
- Index: 1; - Operation: ...; - Target: ...; - Orientation: ...; - Condition: ...; - Think: ...;
- Index: 2; - Operation: ...; - Target: ...; - Orientation: ...; - Condition: ...; - Think: ...;

【输入步骤】
{steps_text}

请直接输出整理后的步骤列表，不要加任何说明文字。
```

若同时配置了 ASR 模型，则使用带音频转录文本的汇总提示词，让大语言模型结合语音内容校正、补充步骤。

用户未配置 ASR 模型的时候也需要提示，并按照无音频视频解析即可；

## 视频来源

1. 用户选择本地文件上传；
2. 使用本软件自己的录制功能，默认 1080P、全屏录制。支持录制时使用 shift+v 暂时开启麦克风说话， shift+s 停止录制并保存， shift+a 暂停/继续录制；
3. 支持格式：视频类型：mp4，mkv，mov。

下面将会介绍视频解析抽帧的三种方式，可在设置中供用户选择。

## 简单抽帧

简单抽帧主要面对的是那些没有视频处理能力、不支持上传视频解析接口的模型服务，主要由两个参数控制：**fps**、 **max_frames**。
1. fps：控制抽帧频率，每隔 1/fps 秒抽取一帧。取值范围为 [0.2, 5]，默认值为 2.0。
    - 高速运动场景：建议设置较高的 fps 值，以捕捉更多细节
    - 静态或长视频：建议设置较低的 fps 值，以提高处理效率
2. max_frames：限制视频抽取帧的上限。当按 fps 计算的总帧数超过此限制时，系统将自动在 max_frames 内均匀抽帧。
除此之外，如果多模态模型有单次输入图片上限（用户的模型配置中设置）则需要多批次并发（并发数设置中设置）处理。相邻批次之间固定重叠 2 帧，用于保持上下文连贯；多批次结果会交给大语言模型汇总、去重、重新编号，最终按原视频顺序返回完整步骤。
简单抽帧的图片组成 messages 格式应该为，一个图片一个该图片的时间戳，最后紧跟提示词指令。

## 智能抽帧

智能抽帧则根据用户动作的关键信息和音频当中的关键信息抽取帧，这样能够保留关键信息也可节省图片数量，但现有算法对桌面变动较小的情况处理未知，需要做实验验证。如下我有一些参考资料供你查阅，你也可先调研其他参考资料自行实现该逻辑，目的就是对于视频无效信息舍去，只提取关键信息，在大多数情况下都要相似于或由于简单抽帧模式（否则简单抽帧图片太多了），也是设置中默认选项。

参考资料其一：
```txt
你正在寻找一种在 Electron 应用中高效抽帧，并能很好地服务于多模态模型理解用户行为（特别是桌面/移动设备操作录制）的方案。我会结合你的需求（保留关键信息、最小化token消耗、适合Electron环境），为你分析并提供实用的开源库和方案选择。 🎯 核心需求回顾 你的核心需求可以概括为： 内容理解目标：解析用户在电脑或移动设备上的操作行为（通常为屏幕录制），让模型理解流程、步骤和交互。 性能与效率优先： 视频时长 2-10分钟。 抽帧需最大化保留关键信息，同时极大减少发送给模型的图片数量（Token消耗）。 技术环境：基于 Electron，需要跨平台（Windows, macOS, Linux），且集成友好。 质量要求：无需处理高质量视频，重点是内容清晰度。 🧠 关键挑战与理解 多模态模型理解视频的核心瓶颈在于Token消耗。直接将全帧或大量帧送入模型不仅成本高昂，也会超出模型的上下文窗口。因此，智能的关键帧提取是解决方案的核心。 对于屏幕录制和操作演示，其特点通常是： 画面变化相对不连续：操作可能集中在某些时间点，大量时间可能是静态或缓慢移动的。 信息密度不均：点击、拖拽、菜单弹出等瞬间包含关键信息，而其他画面可能冗余。 时序逻辑重要：步骤的先后顺序是理解行为的关键。 因此，理想的抽帧方案应能： 精准捕获场景变化：只在画面发生显著变化时抽取帧。 有效去除冗余：避免抽取重复或高度相似的连续帧。 保留时序信息：确保关键帧的顺序能反映操作流程。 🛠️ 开源方案与库推荐 基于你的需求，我为你筛选和评估了以下几种方案，并重点推荐了适合Electron集成的库。 1. 智能场景检测与关键帧提取（强烈推荐） 这类方案通过分析画面变化（如像素差异、颜色直方图、边缘变化等）来动态检测场景切换点，并仅在这些时刻抽取关键帧。它比固定间隔抽帧能更有效地过滤冗余信息，极大减少帧数，尤其适合屏幕录制这类变化不连续的视频。 ⭐ 核心推荐：FFmpeg 场景检测 对于你的Electron应用，直接使用 FFmpeg 的场景检测功能是当前最实用、最高效的选择。它完美满足你跨平台、集成简单、性能优异、token消耗低的需求。 # 示例命令：使用FFmpeg场景检测提取关键帧 # -i input.mp4: 输入视频文件 # -filter:v "select='gt(scene,0.1)'": 视频过滤器，检测场景变化。0.1是阈值，可调整（0.01-0.5） # -vsync vfr: 输出帧率可变，仅输出被选中的关键帧 # -qscale:v 2: 输出图片质量（2是高质量，范围2-31，越小质量越高） # -f image2: 输出格式为图片序列 # ./%08d.jpg: 输出文件名格式，%08d表示8位数字递增，.jpg为格式 ffmpeg -i input.mp4 -filter:v "select='gt(scene,0.1)'" -vsync vfr -qscale:v 2 -f image2 ./%08d.jpg 🔧 在Electron中集成FFmpeg 在Electron中调用FFmpeg主要有两种方式： 使用 fluent-ffmpeg 库 (推荐) fluent-ffmpeg 是 Node.js 中一个非常流行且友好的 FFmpeg 命令行封装库。它提供了链式调用的API，让构建复杂的FFmpeg命令变得简单。 npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg const ffmpeg = require('fluent-ffmpeg'); const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; // 自动获取ffmpeg路径 ffmpeg.setFfmpegPath(ffmpegPath); // 设置ffmpeg路径 function extractKeyFrames(inputVideo, outputDir) { return new Promise((resolve, reject) => { ffmpeg(inputVideo) .on('end', () => { console.log('关键帧提取完成！'); resolve(); }) .on('error', (err) => { console.error('处理出错:', err); reject(err); }) .outputOptions([ '-filter:v', "select='gt(scene,0.1)'", // 场景检测，阈值0.1可调 '-vsync', 'vfr', // 可变帧率输出 '-qscale:v', '2', // 输出图片质量 '-f', 'image2' // 输出图片序列 ]) .output(`${outputDir}/keyframe_%04d.jpg`) // 输出文件名模式 .run(); }); } // 使用示例 extractKeyFrames('path/to/your/video.mp4', 'path/to/output/directory') .then(() => console.log('成功')) .catch(err => console.error('失败', err)); 使用 child_process 直接调用FFmpeg 如果你对命令行非常熟悉，也可以直接使用 Node.js 的 child_process.exec 或 child_process.spawn 来执行FFmpeg命令。这种方式更底层，但需要你自己处理命令拼接和错误处理。 🎛️ FFmpeg 场景检测参数调优建议 2. 基于运动分析的抽帧（备选） 这种方法通过计算光流（Optical Flow）来分析物体运动，选取运动量最小的帧作为关键帧，代表相对“静止”或“稳定”的瞬间。 优点：理论上能更好地代表视频中的“关键姿态”。 缺点：计算复杂度高，速度慢。对于你的2-10分钟视频，处理时间可能无法接受。在Electron中集成一个高效的C++/CUDA光流库工程复杂度极高。 结论：不太推荐用于你的实时/近实时处理场景，除非有极强的性能优化需求。 3. 固定间隔抽帧（不推荐） 这是最简单的方法，如每秒抽1帧 (-r 1)。 优点：实现最简单，处理速度最快。 致命缺点：信息丢失严重。对于操作演示，可能会错过关键的点击、拖拽或菜单弹出的瞬间；同时又会包含大量静态的冗余帧，token消耗巨大且低效。 结论：强烈不推荐作为你的主要方案。但可以作为一种最低限度的兜底方案，在场景检测完全失效时备用。 📊 方案对比与选择 为了让你更直观地做决定，以下是各方案的综合对比： 🚀 实施建议与集成步骤 基于以上分析，我为你规划了在Electron中实施FFmpeg场景检测方案的具体步骤，并考虑了多模态模型的需求。 flowchart LR A[用户上传/选择视频] --> B[Electron主进程<br>接收文件路径] B --> C[调用FFmpeg场景检测<br>提取关键帧] C --> D[将关键帧图片列表<br>发送给渲染进程] D --> E[渲染进程展示关键帧<br>供用户预览/选择] E --> F{用户确认/自动处理} F -- 是 --> G[将选中的关键帧图片<br>与可选的转录文本<br>打包发送给多模态模型] G --> H[模型返回分析结果<br>展示给用户] F -- 否/调整参数 --> C 第一步：环境准备与依赖安装 在Electron项目中安装依赖： npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg 确保FFmpeg可执行： @ffmpeg-installer/ffmpeg 会自动下载适合当前平台的FFmpeg可执行文件，并设置路径。通常无需手动安装系统级FFmpeg。 第二步：实现关键帧提取功能 在Electron的主进程（main.js 或 main/index.js）中实现抽帧逻辑。主进程更适合执行这类文件操作和命令行调用。 // main.js const { app, BrowserWindow, ipcMain } = require('electron'); const path = require('path'); const ffmpeg = require('fluent-ffmpeg'); const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; ffmpeg.setFfmpegPath(ffmpegPath); // 创建窗口等标准Electron代码... // ... // 监听渲染进程发来的抽帧请求 ipcMain.handle('extract-keyframes', async (event, videoPath, outputDir, sceneThreshold = 0.2) => { try { // 确保输出目录存在 const fs = require('fs'); if (!fs.existsSync(outputDir)){ fs.mkdirSync(outputDir, { recursive: true }); } await new Promise((resolve, reject) => { ffmpeg(videoPath) .on('end', () => { console.log('关键帧提取完成'); resolve(); }) .on('error', (err) => { console.error('抽帧出错:', err); reject(err); }) .outputOptions([ `-filter:v`, `select='gt(scene,${sceneThreshold})'`, // 使用传入的阈值 '-vsync', 'vfr', '-qscale:v', '3', // 质量设为3 '-f', 'image2' ]) .output(path.join(outputDir, 'keyframe_%04d.jpg')) // 输出文件名 .run(); }); // 提取完成后，扫描输出目录，获取关键帧文件列表 const fs = require('fs'); const files = fs.readdirSync(outputDir) .filter(file => file.endsWith('.jpg')) .sort(); // 确保文件名排序正确，对应时间顺序 return { success: true, frameFiles: files, outputDir }; } catch (error) { console.error('抽帧过程出错:', error); return { success: false, error: error.message }; } }); 第三步：在渲染进程中调用与展示 在你的渲染进程（如 React/Vue/Svelte 组件中）中，通过IPC调用主进程的功能，并展示结果。 // 渲染进程中的示例代码 (假设使用React) import { ipcRenderer } from 'electron'; async function handleExtractKeyframes(videoPath) { const outputDir = 'path/to/output/directory'; // 可以是用户选择的目录或应用临时目录 const sceneThreshold = 0.2; // 可以让用户调整或默认 const result = await ipcRenderer.invoke('extract-keyframes', videoPath, outputDir, sceneThreshold); if (result.success) { console.log('提取的关键帧:', result.frameFiles); // result.frameFiles 是文件名数组，如 ['keyframe_0001.jpg', 'keyframe_0002.jpg', ...] // 你可以在这里展示这些图片给用户预览，或者直接全部发送给模型 return result.frameFiles.map(file => `file://${path.join(result.outputDir, file)}`); } else { console.error('提取失败:', result.error); return []; } } 第四步：将关键帧发送给多模态模型 获取到关键帧的文件路径后，你需要将它们编码成Base64（或直接通过文件路径，取决于你的模型API支持），然后连同你的提示词（Prompt） 一起发送给多模态模型。 💡 Token优化小贴士： 图片质量与大小：如前所述，用 -qscale:v 3 控制质量，并考虑用 -vf "scale=1280:-1" 缩小图片尺寸。图片越小，Token消耗越少。 图片数量：FFmpeg场景检测的 scene 阈值直接控制数量。对于你的10分钟视频，目标是将关键帧控制在10-30张以内，这能将Token消耗控制在非常合理的水平。 组合发送：不要一张一张地发送。将所有关键帧打包成一个列表，一次性发送给模型，并要求它按顺序理解整个操作流程。 利用文本信息：如果你的录屏有系统内置字幕（如操作步骤提示）或你可以额外转录语音（虽然你说的是桌面操作，但有时也会有语音），将这些文本信息也一起发送给模型，能极大帮助理解，有时比视觉信息更高效。 第五步：模型理解与结果返回 你的多模态模型（如GPT-4V, Claude 3.5 Sonnet, Qwen-VL等）会分析这些关键帧，并返回对用户行为的理解和解析。 // 伪代码：发送给模型 const analysisPrompt = ` 请按顺序分析以下关键帧图片，它们来自一段用户在电脑上执行某项操作的屏幕录制。 请详细描述用户执行的每一个操作步骤，包括： 1. 点击了什么按钮或菜单项？ 2. 输入了什么内容（如果有）？ 3. 界面发生了什么变化？ 4. 整个操作的目的是什么？ 请以清晰、分步骤的格式返回分析结果。 `; const response = await callYourMultimodalModel({ prompt: analysisPrompt, images: keyFrameBase64Strings // 或图片文件路径数组 }); ⚙️ 高级优化与未来展望 动态调整阈值：你可以实现一个简单的UI滑块，让用户在抽帧后实时调整 scene 阈值，并立即重新抽帧预览效果，找到最佳的平衡点。 集成 Whisper 等语音识别：如果你的操作录制包含语音，可以先用Whisper等工具将语音转为文本，然后将关键帧图片 + 转录文本一起发送给模型。模型结合视觉和听觉信息，理解会更准确、更全面，有时甚至可以减少对视觉帧的依赖。 关注 LLaVA-OneVision-2.0 等新模型：这些前沿模型正在尝试不再依赖抽帧，而是直接处理视频的压缩流（Codec Stream），通过分析运动矢量和残差来理解视频，这可能从根本上解决Token消耗问题。虽然目前可能还不太成熟或难以直接集成，但值得持续关注其发展。 尝试 FOCUS 等前沿算法：如果你对算法有浓厚兴趣，并且愿意投入时间进行工程化适配，可以尝试将 FOCUS 这样的算法用Python或Node.js重写核心逻辑，集成到你的Electron应用中，追求极致的效率。 💎 总结与最终推荐 综合你的所有需求，最终方案强烈推荐： 在Electron应用中，通过 fluent-ffmpeg 调用FFmpeg的场景检测功能（select='gt(scene,0.2)'）来提取关键帧，并将这些关键帧图片（可适当压缩和缩放）一次性发送给多模态模型进行分析。 这个方案： ✅ 完美契合你的场景：针对屏幕录制操作，能有效捕获变化，去除冗余。 ✅ 集成极其简单：fluent-ffmpeg 让FFmpeg调用像写JS一样简单。 ✅ 性能卓越：FFmpeg的C++实现保证了极快的处理速度。 ✅ Token效率极高：通过调整阈值，可以轻松将10分钟视频的关键帧控制在20张以内，大幅降低成本。 ✅ 跨平台完美：@ffmpeg-installer/ffmpeg 处理了所有平台差异。 核心代码再次提醒： // 在主进程中 const ffmpeg = require('fluent-ffmpeg'); const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; ffmpeg.setFfmpegPath(ffmpegPath); // ... 在IPC处理函数中 ... ffmpeg(videoPath) .outputOptions([ `-filter:v`, `select='gt(scene,0.2)'`, // 0.2是推荐起始阈值，可调整 '-vsync', 'vfr', '-qscale:v', '3', // 控制输出图片质量 '-f', 'image2' ]) .output(path.join(outputDir, 'keyframe_%04d.jpg')) .run(); 希望这份详尽的方案能帮助你顺利实现需求！如果你在集成过程中遇到任何问题，或者想了解更细节的调优，随时可以再问我。
```

## 模型理解

模型理解是模型厂商 API 支持上传视频，这样就不需要我们抽帧、ASR了，可以直接发送提示词解析视频中的操作步骤。由于不同厂商的 API 请求格式有所不同，为了兼容更多厂商的模型请求，我们应该抽象出来我们必要的统一接口，后续如果需要添加新的模型可以适配该接口即可。统一接口尽可能简单好设置并且通用，避免给用户一大堆参数。
以下我给出豆包、千问模型视频理解模型的说明文档链接，你需要访问该地址查阅：

豆包：https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1895586?lang=zh
千问：https://bailian.console.aliyun.com/cn-beijing?spm=5176.12818093_47.overview_recent.1.5a5e2cc9M3JwYy&tab=doc#/doc/?type=model&url=2845871

千问上传 base64 或者 url 方案参考方案：
推荐综合考虑 SDK 类型、文件大小以及网络稳定性来选择最合适的上传方式。

| 文件类型 | 文件规格 | DashScope SDK（Python、Java） | OpenAI 兼容 / DashScope HTTP |
| :--- | :--- | :--- | :--- |
| **图像** | 大于 7MB 小于 10MB | 传入本地路径 | 仅支持公网 URL，建议使用阿里云对象存储服务 |
| | 小于 7MB | 传入本地路径 | Base64 编码 |
| **视频** | 大于 100 MB | 仅支持公网 URL，建议使用阿里云对象存储服务 | 仅支持公网 URL，建议使用阿里云对象存储服务 |
| | 大于 7MB 小于 100 MB | 传入本地路径 | 仅支持公网 URL，建议使用阿里云对象存储服务 |
| | 小于 7MB | 传入本地路径 | Base64 编码 |

> **注意事项**：
> - Base64 编码会增大数据体积，原始文件大小应小于 7 MB。
> - 使用 Base64 或本地路径可避免服务端下载超时，提升稳定性。

# 事件监听

事件监听是一个完全不需要 AI 的可编排工作流，主要负责处理非常机械性、变化幅度小的重复性劳动。和市面上的按键精灵一样，会完整监听用户的所有操作，并完美模仿，不过我们增加一个可编排，调整顺序，间隔时间等等。我们还可以增加一个参考图选项，可以匹配当前屏幕是否存在当前参考图，然后精准定位，适合可能会变化的按钮。例如 python 代码的这一段：
```python
location=pyautogui.locateCenterOnScreen(img,confidence=0.9)
    if location is not None:
        pyautogui.click(location.x,location.y,clicks=clickTimes,interval=0.2,duration=0.2,button=lOrR)
```

# 你说我做

用户可以开启“你说我做”功能，用户每说一句，等待 AI 执行完毕后，可询问用户是否完成（也就是用户确认结果的过程），当用户回答完成/yes/是的之类的肯定语句的时候这一步操作即可保留下来，反之亦然。该过程对应的视频解析后的一个步骤，只不过当前这个步骤是用户说出的并且确认正确的，所以不需要复杂的修改和合并操作，可以直接使用。

最后只要识别到用户说出结束/停止之类的结束语意，或者手动点击按钮结束操作的，如果是语音需要通过语音二次确认是否保存为工作流，如果是手动按钮结束，则弹窗二次确认。

# 工作流执行

除了“事件监听”是通过普通程序执行不需要大模型外，其余两个都需要大模型解析并执行，执行引擎我引用的是 Midscene 库来操作，非常方便使用。
模型配置：https://midscenejs.com/zh/model-common-config.html
全部配置项：https://midscenejs.com/zh/model-config.html
PC 官方文档：https://midscenejs.com/zh/computer-introduction
PC 版开始使用示例：https://midscenejs.com/zh/computer-getting-started.html
API 参考文档：https://midscenejs.com/zh/computer-api-reference.html
YAML 配置流程文档：https://midscenejs.com/zh/yaml-script-runner.html， https://midscenejs.com/zh/automate-with-scripts-in-yaml.html
缓存 AI 规划和定位：https://midscenejs.com/zh/caching.html
阅读上面的参考文档来学习实现功能。

# 模型使用统计与费用估算

为帮助用户直观了解 AI 调用成本，系统应支持：

1. **模型价格配置**：在设置中为每个 Provider 配置三类模型及其价格（输入、输出 Token 单价，元 / 1K tokens，货币 CNY/USD）：
   - **多模态大模型（必选）**：用于视频解析、参考图定位等视觉理解任务；
   - **大语言模型（可选）**：用于长视频分段汇总、文本推理、对话；
   - **ASR 语音模型（可选）**：用于有音频视频中的语音转录。
   只有启用并填写了模型 ID 的子模型才会被调用。
2. **Usage 自动采集**：每次请求大模型后，从原始响应的 `usage` 字段读取 `prompt_tokens`、`completion_tokens`、`total_tokens`。
3. **费用估算**：按 `inputPricePer1K × promptTokens / 1000 + outputPricePer1K × completionTokens / 1000` 计算单次请求花费，并累加总花费。
4. **统计展示**：在仪表盘集中显示：
   - 总请求次数、已统计请求次数
   - 总输入 / 输出 / 总 Tokens
   - 估算总花费
   - 最近请求列表（模型、功能、时间、Tokens、花费）
   - 单次请求花费趋势折线图
5. **注意事项**：
   - 若模型返回不含 usage，则该次请求仅计入总次数，不计入 Tokens 与花费。
   - 价格为估算值，最终以模型厂商账单为准。
   - 支持一键重置统计数据。

# 流程编排

具体如何设计请根据实现逻辑和业务逻辑实现。
值得注意的是发送给执行器的提示词是没有视频解析步骤的 Condition、Think 字段的，Think 字段是给用户看模型分析的，应该为不可编辑字段，可以只显示在窗口下方展示即可。

# 日志系统

分为 debug 日志，适合程序员或者模型分析具体问题，信息更多更全。
用户日志，可以查看每一个步骤信息，模型使用情况，token消耗量等相关统计数据（兼容 Midscene 输出等日志，会有一个 html 报告，可以看执行过程）。
合理设计系统的日志系统。

# UI 风格

极简 SaaS 网页仪表盘 UI，浅色纯白背景，软玻璃拟态 + 轻度轻拟物，统一大圆角，浅淡柔和投影，低饱和马卡龙柔和配色，淡紫 + 浅蓝点缀，大面积留白，纤细无衬线字体，模块化卡片布局，微弱柔光内发光，细线性图标，简约平滑折线图表，Figma 高保真界面，清爽通透极简质感，无厚重边框

标签：
1. 界面风格：dashboard、fintech web UI、Figma 高保真原型
2. 质感：soft glassmorphism（软玻璃拟态）、mild neumorphism（轻度新拟态）、subtle glow（微弱柔光）、low soft shadow（淡柔和阴影）、无厚重描边
3. 色彩：light mode 浅色模式、white background 纯白底、pale lavender 淡紫主色、light sky blue 浅蓝点缀、low saturation pastel 低饱和马卡龙、渐变深色银行卡
4. 版式：modular card layout 模块化卡片布局、large rounded corners 大圆角、ample white space 充足留白、left sidebar 左侧侧边导航
5. 组件元素：line chart 双折线图表、grid quick action 快捷功能网格、progress bar 进度条
6. 氛围：minimalist 极简、clean 清爽、airy 透气、business corporate 商务企业风、no clutter 干净无冗余
