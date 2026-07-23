import { readFileSync } from 'fs';
import { basename } from 'path';
import type { AIProvider, ProviderChatOptions, ChatResponse, ModelProviderConfig, TokenUsage } from './types.js';

interface DoubaoChoice {
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
  index: number;
}

interface DoubaoResponse {
  choices: DoubaoChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface DoubaoTranscriptionResponse {
  text?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function normalizeUsage(raw?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): TokenUsage {
  return {
    promptTokens: raw?.prompt_tokens ?? 0,
    completionTokens: raw?.completion_tokens ?? 0,
    totalTokens: raw?.total_tokens ?? 0,
  };
}

export function createDoubaoProvider(config: ModelProviderConfig): AIProvider {
  return {
    name: 'doubao',
    async chat(options: ProviderChatOptions): Promise<ChatResponse> {
      if (!config.apiKey) {
        throw new Error('未配置 API Key');
      }

      // ASR 走语音转录接口，需要上传音频文件
      if (options.modelType === 'asr') {
        if (!options.audioPath) {
          throw new Error('ASR 请求缺少音频文件路径');
        }
        const endpoint = `${config.baseUrl}/audio/transcriptions`;
        const audioBuffer = readFileSync(options.audioPath);
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', blob, basename(options.audioPath));
        formData.append('model', options.model);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => 'unknown');
          throw new Error(`豆包 ASR 请求失败 (${response.status}): ${text}`);
        }

        const data = (await response.json()) as DoubaoTranscriptionResponse;
        return { content: data.text ?? '', usage: normalizeUsage(data.usage), raw: data };
      }

      const endpoint = `${config.baseUrl}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 2048,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'unknown');
        throw new Error(`豆包 API 请求失败 (${response.status}): ${text}`);
      }

      const data = (await response.json()) as DoubaoResponse;
      const content = data.choices?.[0]?.message?.content ?? '';
      const usage = normalizeUsage(data.usage);

      return { content, usage, raw: data };
    },
  };
}
