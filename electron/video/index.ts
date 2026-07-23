import { join, dirname, basename, extname } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { aiChat } from '../ai/index.js';
import { getLogger } from '../logger.js';
import { getStore } from '../store.js';
import { compressVideo, extractFrames, extractAudio, fileToDataUrl, getVideoInfo } from './ffmpeg.js';
import type { VideoInfo, FrameExtractionOptions, ExtractedFrames, VideoParseResult } from './types.js';
import type { ChatMessage, ContentPart } from '../ai/types.js';
import type { ModelProfile, TokenUsage, VideoParseOptions } from '../../types/index.js';
import type { FlowSchema, FlowNode } from '../../types/flow.js';
import { v4 as uuidv4 } from 'uuid';

const OVERLAP_FRAMES = 2;

const PLANNER_PROMPT = `你是电脑操作行为专属解读规划师，核心工作：先观看参考视频（多张按时间顺序排列的关键帧），精准判定用户操作的最终目标，再逐帧拆解用户全部操作流程，将完整操作拆解为单一可落地的鼠标、键盘基础操作单元，严格按照下述统一格式、规范输出每一步操作详情。
统一输出规范（强制遵守）
1. 所有步骤均以-开头、;结尾，全程使用半角标点，格式统一无偏差；
2. 每一步操作固定包含6项核心维度，严格对应字段释义填写：
- Index: 步骤序号，从1开始依次递增；
- Operation: 用通俗精准的自然语言描述单步操作行为+最终结果；
- Target: 精准描述被操作对象核心特征；
- Orientation: 精准描述操作对象在屏幕的大致方位；
- Condition: 该步骤完成后可进入下一步的完成状态/判定标准；
- Think: 简述单步拆解的思考逻辑；
请只输出步骤列表，不要额外解释。`;

const BATCH_PLANNER_PROMPT = `你是电脑操作行为专属解读规划师。当前给你的图片是按时间顺序从一段视频中抽取的关键帧，属于整个视频的一部分。
请仅针对当前这批图片解析操作步骤，输出格式要求：
1. 所有步骤均以-开头、;结尾，全程使用半角标点；
2. 每一步固定包含6项核心维度：
- Index: 步骤序号，从1开始依次递增；
- Operation: 用通俗精准的自然语言描述单步操作行为+最终结果；
- Target: 精准描述被操作对象核心特征；
- Orientation: 精准描述操作对象在屏幕的大致方位；
- Condition: 该步骤完成后可进入下一步的完成状态/判定标准；
- Think: 简述单步拆解的思考逻辑；
请只输出步骤列表，不要额外解释。注意：当前批次的 Index 仅在该批次内连续，最终会通过大语言模型汇总并重新编号。`;

const SUMMARY_PROMPT = `你是操作步骤整理助手，专门处理"多批次抽帧解析后汇总"的步骤数据。

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

请直接输出整理后的步骤列表，不要加任何说明文字。`;

const SUMMARY_WITH_AUDIO_PROMPT = `你是操作步骤整理助手，专门处理"多批次抽帧解析 + 音频转录后汇总"的步骤数据。

【背景】
我会给你一组从教学视频中分批次提取的操作步骤，以及该视频的音频转录文本。因为每一批图片是独立交给多模态模型处理的，所以原始数据中：
1. Index 字段经常从 1 重新开始，导致汇总后出现重复的 Index；
2. 相邻批次之间有 2 帧重叠，因此重叠区域的步骤可能会出现重复或高度相似；
3. 跨批次但语义上属于同一步的操作需要合并。

【你的任务】
1. 结合音频转录文本理解用户真实意图，对步骤进行校正、补充；
2. 重新编号：Index 从 1 开始依次递增，无断序、无重复；
3. 去重：去除完全重复的步骤（Operation + Target 完全一致）；
4. 合并：对时间上连续、语义上属于同一步的操作可适当合并（除非原本就分开）；
5. 保留每个步骤的全部 6 个核心字段：Index / Operation / Target / Orientation / Condition / Think；
6. 严格遵循输出格式（每行一步，行内用半角分号 ; 分隔字段，行尾以 ; 结束，每一个字段前都以 - 空格 相隔开）。

【输出格式（严格遵守）】
- Index: 1; - Operation: ...; - Target: ...; - Orientation: ...; - Condition: ...; - Think: ...;
- Index: 2; - Operation: ...; - Target: ...; - Orientation: ...; - Condition: ...; - Think: ...;

【音频转录文本】
{audio_text}

【输入步骤】
{steps_text}

请直接输出整理后的步骤列表，不要加任何说明文字。`;

interface ParseVideoOptions {
  videoPath: string;
  compress?: boolean;
  frameOptions?: FrameExtractionOptions;
  customPrompt?: string;
  maxImagesPerRequest?: number;
  concurrency?: number;
}

function splitFramesWithOverlap<T>(frames: T[], batchSize: number, overlap: number): T[][] {
  if (frames.length <= batchSize) return [frames];
  const batches: T[][] = [];
  const step = Math.max(1, batchSize - overlap);
  for (let start = 0; start < frames.length; start += step) {
    const end = Math.min(start + batchSize, frames.length);
    batches.push(frames.slice(start, end));
    if (end === frames.length) break;
  }
  return batches;
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

function aggregateUsage(usages: TokenUsage[]): TokenUsage {
  return usages.reduce(
    (acc, u) => ({
      promptTokens: acc.promptTokens + u.promptTokens,
      completionTokens: acc.completionTokens + u.completionTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  );
}

async function buildBatchMessage(
  batchFrames: string[],
  batchIndex: number,
  totalBatches: number,
  customPrompt?: string
): Promise<ChatMessage[]> {
  const parts: ContentPart[] = [
    {
      type: 'text',
      text:
        customPrompt ||
        (totalBatches > 1
          ? `以下图片是按时间顺序从视频中抽取的关键帧，当前为第 ${batchIndex + 1}/${totalBatches} 批，请解析其中的操作步骤。`
          : '以下图片是按时间顺序从视频中抽取的关键帧，请解析其中的操作步骤。'),
    },
  ];

  for (const framePath of batchFrames) {
    const dataUrl = await fileToDataUrl(framePath, 'image/jpeg');
    parts.push({ type: 'image_url', image_url: { url: dataUrl } });
  }

  return [
    { role: 'system', content: totalBatches > 1 ? BATCH_PLANNER_PROMPT : PLANNER_PROMPT },
    { role: 'user', content: parts },
  ];
}

async function parseFramesInBatches(
  framePaths: string[],
  maxImagesPerRequest: number,
  concurrency: number,
  customPrompt?: string
): Promise<{ responses: string[]; usage: TokenUsage }> {
  const log = getLogger();
  const batches = splitFramesWithOverlap(framePaths, maxImagesPerRequest, OVERLAP_FRAMES);
  log.info('Video frames split into batches', { totalFrames: framePaths.length, batchCount: batches.length, maxImagesPerRequest });

  const tasks = batches.map((batch, index) => async () => {
    const messages = await buildBatchMessage(batch, index, batches.length, customPrompt);
    const response = await aiChat({
      modelType: 'multimodal',
      messages,
      feature: 'video-parse',
      maxTokens: 4096,
    });
    log.info('Batch parsed', { batchIndex: index + 1, totalBatches: batches.length, usage: response.usage });
    return response;
  });

  const results = await runWithConcurrency(tasks, concurrency);
  const responses = results.map((r) => r.content);
  const usage = aggregateUsage(results.map((r) => r.usage));

  return { responses, usage };
}

async function summarizeWithTextModel(
  stepsText: string,
  audioTranscript: string | null,
  enabled: boolean
): Promise<{ content: string; usage: TokenUsage; skipped: boolean }> {
  const log = getLogger();

  if (!enabled) {
    log.info('Text model summarization skipped (not enabled)');
    return { content: stepsText, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, skipped: true };
  }

  const prompt = audioTranscript
    ? SUMMARY_WITH_AUDIO_PROMPT.replace('{audio_text}', audioTranscript).replace('{steps_text}', stepsText)
    : SUMMARY_PROMPT.replace('{steps_text}', stepsText);

  log.info('Summarizing steps with text model', { hasAudioTranscript: !!audioTranscript });
  const response = await aiChat({
    modelType: 'text',
    messages: [
      { role: 'system', content: '你是操作步骤整理助手，请严格按照指定格式输出。' },
      { role: 'user', content: prompt },
    ],
    feature: 'video-summary',
    maxTokens: 4096,
  });

  return { content: response.content, usage: response.usage, skipped: false };
}

function getDefaultModel(tag: string): ModelProfile | undefined {
  const store = getStore();
  const models: ModelProfile[] = store.get('models') || [];
  const defaultIds: any = store.get('defaultModelIds') || {};

  let id: string | undefined;
  if (tag === 'midscene' || tag === 'multimodal') {
    id = defaultIds.executionEngines?.midscene?.defaultModelId || defaultIds.defaultMultimodal;
  } else if (tag === 'asr') {
    id = undefined;
  } else if (tag === 'text') {
    id = undefined;
  }

  if (id) {
    const model = models.find((m) => m.id === id && m.enabled);
    if (model) return model;
  }

  return models.find((m) => m.tags.includes(tag as any) && m.enabled);
}

async function transcribeAudioIfEnabled(videoPath: string, hasAudio: boolean): Promise<string | null> {
  const asrModel = getDefaultModel('asr');
  const asrEnabled = Boolean(asrModel?.modelId);

  if (!asrEnabled) {
    getLogger().info('ASR skipped (not enabled or not configured)');
    return null;
  }

  if (!hasAudio) {
    getLogger().info('ASR skipped (video has no audio)');
    return null;
  }

  const audioPath = join(
    dirname(videoPath),
    `${basename(videoPath, extname(videoPath))}_audio.mp3`
  );

  try {
    await extractAudio(videoPath, audioPath);
    getLogger().info('Audio extracted for ASR', { audioPath });

    const response = await aiChat({
      modelType: 'asr',
      messages: [{ role: 'user', content: '请转录这段音频' }],
      feature: 'asr',
      audioPath,
    });

    getLogger().info('ASR transcription completed', { length: response.content.length });
    return response.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getLogger().error('ASR transcription failed', { error: message });
    return null;
  }
}

export async function parseVideo(options: ParseVideoOptions): Promise<VideoParseResult> {
  const log = getLogger();
  log.info('Start video parse', { videoPath: options.videoPath, mode: options.frameOptions?.mode });

  try {
    if (!existsSync(options.videoPath)) {
      return { success: false, error: '视频文件不存在' };
    }

    const multimodalModel = getDefaultModel('multimodal');
    const maxImagesPerRequest = options.maxImagesPerRequest ?? multimodalModel?.maxImagesPerRequest ?? 10;
    const concurrency = options.concurrency ?? getStore().get('videoParseConcurrency') ?? 3;

    // 1. 获取视频信息
    const info = await getVideoInfo(options.videoPath);
    log.info('Video info', { duration: info.duration, resolution: `${info.width}x${info.height}`, hasAudio: info.hasAudio });

    // 2. 按需压缩
    let workingVideo = options.videoPath;
    if (options.compress) {
      const compressedPath = join(
        dirname(options.videoPath),
        `${basename(options.videoPath, extname(options.videoPath))}_compressed.mp4`
      );
      workingVideo = await compressVideo(options.videoPath, compressedPath);
      log.info('Video compressed', { compressedPath: workingVideo });
    }

    // 3. 抽帧
    const frameOptions: FrameExtractionOptions = options.frameOptions ?? { mode: 'smart' };
    const frames = await extractFrames(workingVideo, frameOptions);
    const frameCount = frames.framePaths?.length ?? 0;
    log.info('Frames extracted', { mode: frames.mode, count: frameCount });

    if (frames.mode !== 'native' && frameCount === 0) {
      return { success: false, error: '未抽取到任何帧' };
    }

    let rawResponse = '';
    let multimodalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 4. 调用多模态模型（单批次或多批次并发）
    if (frames.mode === 'native' && frames.videoPath) {
      const messages: ChatMessage[] = [
        { role: 'system', content: PLANNER_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: options.customPrompt || '请解析以下视频中的操作步骤。' },
            { type: 'image_url', image_url: { url: pathToFileURL(frames.videoPath).href } },
          ],
        },
      ];
      const response = await aiChat({
        modelType: 'multimodal',
        messages,
        feature: 'video-parse',
        maxTokens: 4096,
      });
      rawResponse = response.content;
      multimodalUsage = response.usage;
    } else if (frames.framePaths) {
      const { responses, usage } = await parseFramesInBatches(
        frames.framePaths,
        maxImagesPerRequest,
        concurrency,
        options.customPrompt
      );
      rawResponse = responses.join('\n\n');
      multimodalUsage = usage;
    }

    // 5. 可选 ASR
    const audioTranscript = await transcribeAudioIfEnabled(workingVideo, info.hasAudio);

    // 6. 可选 LLM 汇总
    const textModel = getDefaultModel('text');
    const textModelEnabled = Boolean(textModel?.modelId);
    const { content: summarizedText, usage: summaryUsage, skipped: summarySkipped } = await summarizeWithTextModel(
      rawResponse,
      audioTranscript,
      textModelEnabled
    );

    if (summarySkipped) {
      log.warn('Text model not enabled, returning raw parsed steps. User needs to manually deduplicate overlapping batches.');
    }

    // 7. 解析为工作流步骤
    const steps = parseStepsFromText(summarizedText);
    const flowSchema = buildFlowSchemaFromSteps(steps, options.videoPath, info);
    const totalUsage = aggregateUsage([multimodalUsage, summaryUsage]);

    return {
      success: true,
      workflow: {
        name: flowSchema.flowMeta.name,
        description: flowSchema.flowMeta.desc,
        source: 'video',
        steps,
      },
      flowSchema,
      rawResponse: summarizedText,
      usage: totalUsage,
      summarySkipped,
      asrSkipped: !audioTranscript,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Video parse failed', { error: message });
    return { success: false, error: message };
  }
}

function parseStepsFromText(text: string): Array<Record<string, string>> {
  const lines = text.split('\n');
  const steps: Array<Record<string, string>> = [];
  let current: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('- Index:')) {
      if (current.Index) {
        steps.push(current);
      }
      current = { Index: line.replace('- Index:', '').trim() };
    } else if (line.startsWith('- ') && current.Index) {
      const [key, ...rest] = line.slice(2).split(':');
      if (key && rest.length > 0) {
        current[key.trim()] = rest.join(':').trim();
      }
    }
  }

  if (current.Index) {
    steps.push(current);
  }

  return steps;
}

function buildFlowSchemaFromSteps(
  steps: Array<Record<string, string>>,
  videoPath: string,
  info: VideoInfo
): FlowSchema {
  const flowId = uuidv4();
  const midsceneModel = getDefaultModel('midscene');

  const nodes: FlowNode[] = steps.map((step, index) => {
    const operation = step.Operation?.toLowerCase?.() ?? '';
    const target = step.Target ?? '';
    const text = step.Condition ?? '';

    let nodeType: FlowNode['nodeType'] = 'aiTap';
    let nodeParams: Record<string, unknown> = { locate: target };

    if (operation.includes('打开') || operation.includes('访问') || operation.includes('navigate')) {
      nodeType = 'navigate';
      nodeParams = { url: target || 'https://example.com' };
    } else if (operation.includes('输入') || operation.includes('填写') || operation.includes('type')) {
      nodeType = 'aiInput';
      nodeParams = { locate: target, text };
    } else if (operation.includes('等待') || operation.includes('wait') || operation.includes('sleep')) {
      nodeType = 'sleep';
      nodeParams = { duration: 1000 };
    } else if (operation.includes('断言') || operation.includes('assert')) {
      nodeType = 'aiAssert';
      nodeParams = { assertion: step.Operation ?? '' };
    } else if (operation.includes('查询') || operation.includes('提取') || operation.includes('query')) {
      nodeType = 'aiQuery';
      nodeParams = { dataDemand: step.Operation ?? '' };
    } else {
      nodeType = 'aiTap';
      nodeParams = { locate: target || step.Operation || '目标元素' };
    }

    return {
      nodeId: `node-${index + 1}`,
      nodeType,
      nodeName: `${step.Index}. ${step.Operation || '未命名操作'}`,
      timeout: 30000,
      retryCount: 0,
      nodeParams,
      nextNodes: index < steps.length - 1 ? [{ nodeId: `node-${index + 2}` }] : [],
      comment: step.Think,
    };
  });

  return {
    flowId,
    flowMeta: {
      name: `视频解析流程 ${new Date().toLocaleString('zh-CN')}`,
      desc: `来自 ${basename(videoPath)}，时长 ${info.duration.toFixed(1)}s，分辨率 ${info.width}x${info.height}`,
      tags: [],
      triggerType: 'manual',
      globalTimeout: 300000,
      globalRetry: 0,
      failStrategy: 'terminate',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    deviceConfig: {
      type: 'web',
      url: 'https://example.com',
      viewport: { width: info.width || 1920, height: info.height || 1080 },
    },
    aiGlobalConfig: {
      modelId: midsceneModel?.id,
      modelName: midsceneModel?.modelId ?? '',
      apiKey: midsceneModel?.apiKey ?? '',
      baseUrl: midsceneModel?.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3',
      actionContext: '请根据任务描述在网页上完成对应操作。',
      defaultDeepThink: midsceneModel?.reasoningEnabled ?? false,
      cacheable: midsceneModel?.cacheable ?? true,
      timeout: midsceneModel?.timeout ?? 60000,
    },
    globalVars: [],
    nodeList: nodes,
  };
}

export { getVideoInfo, extractFrames, compressVideo };
export type { VideoInfo, FrameExtractionOptions, ExtractedFrames };
