export interface VideoInfo {
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  format: string;
  hasAudio: boolean;
}

export interface FrameExtractionOptions {
  mode: 'simple' | 'smart' | 'native';
  /** 简单抽帧 FPS */
  fps?: number;
  /** 最大帧数限制 */
  maxFrames?: number;
  /** 智能抽帧场景阈值 0-1 */
  sceneThreshold?: number;
  /** 输出图片宽度，等比缩放 */
  outputWidth?: number;
  /** 压缩质量 1-31 */
  jpegQuality?: number;
}

export interface ExtractedFrames {
  mode: 'simple' | 'smart' | 'native';
  /** native 模式返回原视频路径 */
  videoPath?: string;
  /** 抽帧模式返回图片路径列表 */
  framePaths?: string[];
  /** 帧对应时间戳 */
  timestamps?: number[];
}

import type { FlowSchema } from '../../types/flow.js';

export interface VideoParseResult {
  success: boolean;
  error?: string;
  workflow?: {
    name: string;
    description: string;
    source: 'video';
    steps: unknown[];
  };
  /** 标准 FlowSchema，可直接用于画布编排 */
  flowSchema?: FlowSchema;
  rawResponse?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 是否跳过了大语言模型汇总 */
  summarySkipped?: boolean;
  /** 是否跳过了 ASR */
  asrSkipped?: boolean;
}
