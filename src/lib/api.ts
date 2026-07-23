type IpcChannel = Window['mimic']['invoke'] extends (channel: infer C, ...args: unknown[]) => unknown ? C : never;

const mockHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'store:get': (...args: unknown[]) => {
    const key = args[0] as string;
    const defaults: Record<string, unknown> = {
      'ui.sidebarCollapsed': false,
      modelProvider: {
        name: 'doubao',
        label: '豆包',
        apiKey: '',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        multimodalModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
        textModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
        asrModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
      },
      midsceneModel: {
        modelName: '',
        apiKey: '',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        defaultDeepThink: false,
        cacheable: true,
        timeout: 60000,
      },
      videoSavePath: '',
    };
    return defaults[key];
  },
  'store:set': () => true,
  'dialog:select-video': () => null,
  'dialog:select-folder': () => null,
  'dialog:select-flow-file': () => null,
  'dialog:save-flow-file': () => null,
  'recorder:start': () => ({ success: false, error: '浏览器环境不支持录制' }),
  'recorder:stop': () => ({ success: false, error: '浏览器环境不支持录制' }),
  'recorder:pause': () => ({ success: false, error: '浏览器环境不支持录制' }),
  'recorder:save-blob': () => ({ success: false, error: '浏览器环境不支持保存录制' }),
  'flow:validate': () => ({ success: true, data: { valid: true, errors: [] } }),
  'flow:run': () => ({ success: true, data: { runInstanceId: 'mock-run-id' } }),
  'flow:stop': () => ({ success: true, data: { stopped: true } }),
  'file:save-flow': () => ({ success: true }),
  'file:open-flow': () => ({ success: false, error: { code: 'MOCK', message: '浏览器环境不支持打开文件' } }),
  'config:get': () => ({
    success: true,
    data: {
      defaultMidsceneModel: {
        modelName: '',
        apiKey: '',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        defaultDeepThink: false,
        cacheable: true,
        timeout: 60000,
      },
      videoParseModel: {
        name: 'doubao',
        label: '豆包',
        apiKey: '',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        multimodalModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
        textModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
        asrModel: { model: '', enabled: true, pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' } },
      },
      globalRuntimeOption: { defaultTimeout: 300000, defaultRetry: 0 },
    },
  }),
  'config:set': () => ({ success: true }),
  'ai:parse-video': () => ({
    success: true,
    workflow: {
      name: '浏览器示例工作流',
      description: '浏览器环境中无法真实解析视频，仅做 UI 展示。',
      source: 'video',
      steps: [
        { Index: '1', Operation: '点击“开始”按钮', Target: '蓝色开始按钮', Orientation: '居中', Condition: '页面进入下一步', Think: '示例' },
      ],
    },
    rawResponse: '浏览器 mock 结果',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  }),
  'ai:chat-step': () => ({ success: false, error: '浏览器环境不支持 AI 对话' }),
  'logs:list-files': () => ({ success: true, data: [] }),
  'logs:read-file': () => ({ success: true, data: { entries: [], total: 0 } }),
  'logs:memory': () => ({ success: true, data: [] }),
  'usage:get': () => ({
    totalRequests: 0,
    usageKnownRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    primaryCurrency: 'CNY',
    recentRecords: [],
  }),
  'usage:reset': () => true,
};

export function invoke<T = unknown>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  if (typeof window !== 'undefined' && window.mimic) {
    return window.mimic.invoke(channel, ...args) as Promise<T>;
  }
  const handler = mockHandlers[channel as string];
  const result = handler ? handler(...args) : undefined;
  return Promise.resolve(result as T);
}

export function onIpc(channel: string, callback: (...args: unknown[]) => void) {
  if (typeof window !== 'undefined' && window.mimic) {
    return window.mimic.on(channel, callback);
  }
  return () => {};
}

export function onceIpc(channel: string, callback: (...args: unknown[]) => void) {
  if (typeof window !== 'undefined' && window.mimic) {
    window.mimic.once(channel, callback);
  }
}
