import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  FolderOpen,
  Key,
  Server,
  Brain,
  Save,
  Coins,
  Eye,
  FileText,
  Mic,
  Volume2,
  Layers,
  Clock,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Cpu,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  RotateCcw,
  Database,
  Settings as SettingsIcon,
  Boxes,
  HardDrive,
  Zap,
  Palette,
  Info,
  Heart,
  Github as GithubIcon,
  Globe,
  Home as HomeIcon,
  MousePointerClick,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { invoke } from '../lib/api';
import { cn } from '../lib/utils';
import type { ModelProfile, ModelTag, EngineModelConfig, DefaultModelSelection } from '../../types';
import { MODEL_TAG_META } from '../../types';
import type { IpcResponse } from '../../types/flow';
import { v4 as uuidv4 } from 'uuid';
import { nodeConfigs, categoryLabels, type NodeCategory } from '../components/editor/nodeConfigs';
// 直接从 package.json 读版本号（tsconfig resolveJsonModule 已开启，Vite 原生支持 JSON import，不用 with type:json 以兼容更广泛的工具链版本）
import pkg from '../../package.json';
const APP_VERSION = (pkg as any)?.version || '0.2.2';

const TAG_ICONS: Record<ModelTag, React.ElementType> = {
  multimodal: Eye,
  text: FileText,
  asr: Mic,
  tts: Volume2,
};

const TAG_COLORS: Record<ModelTag, string> = {
  multimodal: 'bg-violet-100 text-violet-700 border-violet-200',
  text: 'bg-sky-100 text-sky-700 border-sky-200',
  asr: 'bg-amber-100 text-amber-700 border-amber-200',
  tts: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

interface ProviderPreset {
  value: string;
  label: string;
  baseUrl: string;
  modelFamilies: { value: string; label: string; defaultModelName?: string }[];
  defaultModelFamily: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    value: 'doubao',
    label: '火山引擎（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelFamilies: [
      { value: 'doubao-vision', label: 'Doubao Seed 1.6 Vision（推荐）', defaultModelName: 'doubao-seed-1.6-vision' },
      { value: 'vlm-ui-tars-doubao-1.5', label: 'UI-TARS Doubao 1.5', defaultModelName: 'doubao-1.5-ui-tars' },
    ],
    defaultModelFamily: 'doubao-vision',
  },
  {
    value: 'qwen',
    label: '阿里云（通义千问）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelFamilies: [
      { value: 'qwen3-vl', label: 'Qwen3-VL（推荐）', defaultModelName: 'qwen3-vl-plus' },
      { value: 'qwen2.5-vl', label: 'Qwen2.5-VL', defaultModelName: 'qwen-vl-max-latest' },
    ],
    defaultModelFamily: 'qwen3-vl',
  },
  {
    value: 'zhipu',
    label: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelFamilies: [
      { value: 'glm-v', label: 'GLM-V（推荐）', defaultModelName: 'glm-4.6v' },
      { value: 'auto-glm', label: 'AutoGLM（中文）', defaultModelName: 'autoglm-phone' },
      { value: 'auto-glm-multilingual', label: 'AutoGLM（多语言）', defaultModelName: 'autoglm-phone' },
    ],
    defaultModelFamily: 'glm-v',
  },
  {
    value: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    modelFamilies: [
      { value: 'gemini', label: 'Gemini 3 系列', defaultModelName: 'gemini-3.0-pro' },
    ],
    defaultModelFamily: 'gemini',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelFamilies: [
      { value: 'gpt-5', label: 'GPT-5 系列（Planning/Insight）' },
    ],
    defaultModelFamily: 'gpt-5',
  },
  {
    value: 'moonshot',
    label: '月之暗面（Kimi）',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelFamilies: [
      { value: 'kimi', label: 'Kimi 系列' },
    ],
    defaultModelFamily: 'kimi',
  },
  {
    value: 'xiaomi',
    label: '小米（MiMo）',
    baseUrl: 'https://api.xiaomi.com/v1',
    modelFamilies: [
      { value: 'xiaomi-mimo', label: 'MiMo 系列' },
    ],
    defaultModelFamily: 'xiaomi-mimo',
  },
  {
    value: 'anthropic',
    label: 'Anthropic（Claude）',
    baseUrl: 'https://api.anthropic.com/v1',
    modelFamilies: [
      { value: 'claude', label: 'Claude 系列' },
    ],
    defaultModelFamily: 'claude',
  },
  {
    value: 'custom',
    label: '自定义',
    baseUrl: '',
    modelFamilies: [],
    defaultModelFamily: '',
  },
];

const getProviderPreset = (provider: string) => {
  return PROVIDER_PRESETS.find((p) => p.value === provider);
};

function PricingEditor({
  pricing,
  onChange,
}: {
  pricing: ModelProfile['pricing'];
  onChange: (p: ModelProfile['pricing']) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl bg-gray-50 p-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">输入单价（元 / 1K tokens）</Label>
        <Input
          type="number"
          min={0}
          step={0.0001}
          value={pricing.inputPricePer1K}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ ...pricing, inputPricePer1K: Number(e.target.value) })
          }
          className="bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">输出单价（元 / 1K tokens）</Label>
        <Input
          type="number"
          min={0}
          step={0.0001}
          value={pricing.outputPricePer1K}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ ...pricing, outputPricePer1K: Number(e.target.value) })
          }
          className="bg-white"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">货币</Label>
        <div className="flex gap-4 pt-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={pricing.currency === 'CNY'}
              onChange={() => onChange({ ...pricing, currency: 'CNY' })}
              className="w-4 h-4"
            />
            <span className="text-sm">CNY</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={pricing.currency === 'USD'}
              onChange={() => onChange({ ...pricing, currency: 'USD' })}
              className="w-4 h-4"
            />
            <span className="text-sm">USD</span>
          </label>
        </div>
      </div>
    </div>
  );
}

function TagSelector({
  selected,
  onChange,
}: {
  selected: ModelTag[];
  onChange: (tags: ModelTag[]) => void;
}) {
  const toggle = (tag: ModelTag) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(MODEL_TAG_META) as ModelTag[]).map((tag) => {
        const meta = MODEL_TAG_META[tag];
        const Icon = TAG_ICONS[tag];
        const isActive = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all',
              isActive
                ? TAG_COLORS[tag]
                : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function ModelCard({
  model,
  onChange,
  onDelete,
}: {
  model: ModelProfile;
  onChange: (m: ModelProfile) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const primaryTag = model.tags[0] || 'multimodal';
  const primaryMeta = MODEL_TAG_META[primaryTag];
  const PrimaryIcon = TAG_ICONS[primaryTag];

  const providerPreset = getProviderPreset(model.provider);
  const modelFamilies = providerPreset?.modelFamilies || [];
  const isPresetFamily = modelFamilies.some((f) => f.value === model.modelFamily);

  const handleProviderChange = (provider: string) => {
    const preset = getProviderPreset(provider);
    if (preset) {
      const newModel: ModelProfile = { ...model, provider };
      newModel.baseUrl = preset.baseUrl;
      newModel.modelFamily = preset.defaultModelFamily;
      const defaultFamily = preset.modelFamilies.find((f) => f.value === preset.defaultModelFamily);
      if (defaultFamily?.defaultModelName && !model.modelId) {
        newModel.modelId = defaultFamily.defaultModelName;
      }
      onChange(newModel);
    } else {
      onChange({ ...model, provider });
    }
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-white overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', TAG_COLORS[primaryTag])}>
            <PrimaryIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              {model.name || '未命名模型'}
              {!model.enabled && (
                <Badge variant="outline" className="text-[10px] text-gray-400">
                  已禁用
                </Badge>
              )}
            </h4>
            <div className="flex items-center gap-1 mt-1">
              {model.tags.map((tag) => (
                <Badge key={tag} variant="outline" className={cn(TAG_COLORS[tag], 'text-[10px]')}>
                  {MODEL_TAG_META[tag].label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={model.enabled}
            onCheckedChange={(v) => onChange({ ...model, enabled: v })}
            onClick={(e) => e.stopPropagation()}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-4 pt-0 space-y-4 border-t border-border/40">
          <div className="pt-4 space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">模型标签（能力）</Label>
              <TagSelector
                selected={model.tags}
                onChange={(tags) => onChange({ ...model, tags })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs text-muted-foreground">显示名称</Label>
                <Input
                  value={model.name}
                  onChange={(e) => onChange({ ...model, name: e.target.value })}
                  placeholder="例如：豆包多模态"
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Provider</Label>
                <Select
                  value={model.provider}
                  onValueChange={handleProviderChange}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  模型系列
                  <span className="text-[10px] text-muted-foreground/70 font-normal">
                    Midscene 视觉定位
                  </span>
                </Label>
                {modelFamilies.length > 0 ? (
                  <Select
                    value={model.modelFamily || modelFamilies[0].value}
                    onValueChange={(v) => {
                      if (v === '__custom__') {
                        onChange({ ...model, modelFamily: '' });
                      } else {
                        const family = modelFamilies.find((f) => f.value === v);
                        const newModel: ModelProfile = { ...model, modelFamily: v };
                        if (family?.defaultModelName && !model.modelId) {
                          newModel.modelId = family.defaultModelName;
                        }
                        onChange(newModel);
                      }
                    }}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelFamilies.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          <div className="flex items-center gap-2">
                            <span>{f.label}</span>
                            <span className="text-xs text-muted-foreground">{f.value}</span>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__">
                        <span className="text-muted-foreground">自定义...</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={model.modelFamily || ''}
                    onChange={(e) => onChange({ ...model, modelFamily: e.target.value })}
                    placeholder="输入模型系列，如 doubao-vision"
                    className="bg-white"
                  />
                )}
                <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                  指定 Midscene 使用的视觉定位模型系列。不同模型系列对应不同的定位策略，
                  影响识别准确率和稳定性。
                  <a
                    href="https://midscenejs.com/zh/model-strategy.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-600 hover:text-sky-700 hover:underline ml-1"
                  >
                    查看 Midscene 模型说明 →
                  </a>
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Server className="w-3 h-3" /> Base URL
                </Label>
                <Input
                  value={model.baseUrl}
                  onChange={(e) => onChange({ ...model, baseUrl: e.target.value })}
                  placeholder="https://ark.cn-beijing.volces.com/api/v3"
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Key className="w-3 h-3" /> API Key
                </Label>
                <Input
                  type="password"
                  value={model.apiKey}
                  onChange={(e) => onChange({ ...model, apiKey: e.target.value })}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Cpu className="w-3 h-3" /> 模型 ID
                </Label>
                <Input
                  value={model.modelId}
                  onChange={(e) => onChange({ ...model, modelId: e.target.value })}
                  placeholder="doubao-vision-4k"
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">超时（毫秒）</Label>
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  value={model.timeout ?? 60000}
                  onChange={(e) => onChange({ ...model, timeout: Math.max(1000, Number(e.target.value)) })}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">重试次数</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  value={model.retryCount ?? 1}
                  onChange={(e) => onChange({ ...model, retryCount: Math.max(0, Math.min(10, Number(e.target.value))) })}
                  className="bg-white"
                />
              </div>
              {model.tags.includes('multimodal') && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">单次最大图片数</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={model.maxImagesPerRequest ?? 10}
                    onChange={(e) => onChange({ ...model, maxImagesPerRequest: Math.max(1, Number(e.target.value)) })}
                    className="bg-white"
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Deep Think / 推理</Label>
                  <p className="text-xs text-muted-foreground">
                    Midscene 深度思考模式，提升复杂场景的定位准确性
                  </p>
                </div>
                <Switch
                  checked={model.reasoningEnabled ?? false}
                  onCheckedChange={(v) => onChange({ ...model, reasoningEnabled: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">启用缓存规划</Label>
                  <p className="text-xs text-muted-foreground">
                    缓存 Midscene AI 规划结果，相同步骤重复执行时加速
                  </p>
                </div>
                <Switch
                  checked={model.cacheable ?? true}
                  onCheckedChange={(v) => onChange({ ...model, cacheable: v })}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelSelect({
  value,
  onChange,
  models,
  tagFilter,
  placeholder,
  allowClear,
  clearLabel,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  models: ModelProfile[];
  tagFilter?: ModelTag;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const filtered = tagFilter
    ? models.filter((m) => m.tags.includes(tagFilter) && m.enabled)
    : models.filter((m) => m.enabled);

  return (
    <Select
      value={value || ''}
      onValueChange={(v) => onChange(v || undefined)}
      disabled={filtered.length === 0}
    >
      <SelectTrigger className="bg-white">
        <SelectValue placeholder={filtered.length === 0 ? '暂无可用模型' : placeholder || '选择模型'} />
      </SelectTrigger>
      <SelectContent>
        {allowClear && value && (
          <SelectItem value="">
            <span className="text-muted-foreground">{clearLabel || '不使用'}</span>
          </SelectItem>
        )}
        {filtered.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="flex items-center gap-2">
              {m.name || '未命名'}
              <span className="text-xs text-muted-foreground">({m.provider})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SettingsPage({ onDevModeToggle, devMode }: { onDevModeToggle?: () => void; devMode?: boolean }) {
  const {
    models,
    defaultModelIds,
    logSavePath,
    workflowSavePath,
    uiSettings,
    setModels,
    setDefaultModelIds,
    setLogSavePath,
    setWorkflowSavePath,
    setUiSettings,
    resetSettings,
    clearAllData,
  } = useAppStore();

  const [localModels, setLocalModels] = useState<ModelProfile[]>([]);
  const [localDefaultIds, setLocalDefaultIds] = useState(defaultModelIds);
  const [localLogPath, setLocalLogPath] = useState(logSavePath);
  const [localWorkflowPath, setLocalWorkflowPath] = useState(workflowSavePath);
  const [localUiSettings, setLocalUiSettings] = useState(uiSettings);
  const [defaultPaths, setDefaultPaths] = useState<{ log: string; workflow: string; userData: string } | null>(null);
  const [titleClickCount, setTitleClickCount] = useState(0);
  const [expandedSortCategory, setExpandedSortCategory] = useState<NodeCategory | null>(null);

  useEffect(() => {
    const loadDefaults = async () => {
      if (window.mimic) {
        try {
          const paths = await window.mimic.invoke('app:get-default-paths');
          setDefaultPaths(paths as any);
        } catch (e) {
          console.error('Failed to get default paths:', e);
        }
      }
    };
    loadDefaults();
  }, []);
  const [localRuntimeOption, setLocalRuntimeOption] = useState({ defaultTimeout: 300000, defaultRetry: 0, systemNodePostDelay: 500 });
  const [systemDpiScale, setSystemDpiScale] = useState(1.0);
  const [dpiDetectInfo, setDpiDetectInfo] = useState<{
    detected: number;
    detectedPercent: number;
    overridden: boolean;
    userValue?: number;
    platform?: string;
    displayName?: string;
  } | null>(null);
  // 版本号直接从 package.json 常量读（见 APP_VERSION 顶部），不走 IPC，避免开发模式下读到 Electron 自身版本（如 32.x）
  const appVersion = APP_VERSION;
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState('simple');
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const main = document.querySelector('main');
    if (main) {
      scrollContainerRef.current = main as HTMLElement;
      const onScroll = () => {
        setShowScrollTop((main as HTMLElement).scrollTop > 300);
      };
      main.addEventListener('scroll', onScroll);
      return () => main.removeEventListener('scroll', onScroll);
    }
  }, []);

  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    setLocalModels(models.length ? models : []);
  }, [models]);

  useEffect(() => {
    setLocalDefaultIds(defaultModelIds);
  }, [defaultModelIds]);

  useEffect(() => {
    setLocalLogPath(logSavePath);
  }, [logSavePath]);

  useEffect(() => {
    setLocalWorkflowPath(workflowSavePath);
  }, [workflowSavePath]);

  useEffect(() => {
    setLocalUiSettings(uiSettings);
  }, [uiSettings]);

  useEffect(() => {
    Promise.all([
      invoke<IpcResponse<{ globalRuntimeOption: { defaultTimeout: number; defaultRetry: number } }>>('config:get'),
      invoke<number>('system:get-dpi-scale'),
      invoke<any>('system:detect-dpi-scale'),
    ]).then(([configRes, dpiRes, detectRes]) => {
      if (configRes.success && configRes.data?.globalRuntimeOption) {
        setLocalRuntimeOption({
          systemNodePostDelay: 500,
          ...configRes.data.globalRuntimeOption,
        });
      }
      if (dpiRes && typeof dpiRes === 'number') {
        setSystemDpiScale(dpiRes);
      } else if (typeof dpiRes === 'object' && dpiRes && (dpiRes as any).success !== undefined) {
        const data = (dpiRes as any).data ?? (dpiRes as any).value;
        if (typeof data === 'number') {
          setSystemDpiScale(data);
        }
      }
      if (detectRes && typeof detectRes === 'object' && 'detected' in detectRes) {
        setDpiDetectInfo(detectRes as any);
      }
      setInitialLoaded(true);
    }).catch(() => {
      setInitialLoaded(true);
    });
  }, []);

  const handleAddModel = () => {
    const newModel: ModelProfile = {
      id: uuidv4(),
      name: '',
      provider: 'doubao',
      tags: ['multimodal'],
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: '',
      modelId: '',
      modelFamily: 'doubao-vision',
      enabled: true,
      pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' },
      timeout: 60000,
      retryCount: 1,
      reasoningEnabled: false,
      cacheable: true,
      maxImagesPerRequest: 10,
    };
    setLocalModels((prev) => [...prev, newModel]);
  };

  const handleRefreshDpiDetect = async () => {
    try {
      const info = await invoke<any>('system:detect-dpi-scale');
      if (info && typeof info === 'object' && 'detected' in info) {
        setDpiDetectInfo(info as any);
      }
    } catch { /* ignore */ }
  };

  const handleUseRecommendedDpi = () => {
    if (dpiDetectInfo && typeof dpiDetectInfo.detected === 'number') {
      setSystemDpiScale(dpiDetectInfo.detected);
    }
  };

  const handleClearDpiOverride = async () => {
    try {
      // 删除 store 中用户手动保存的值，让系统回落到自动检测
      await invoke('store:delete', 'systemDpiScale');
      await handleRefreshDpiDetect();
      // 刷新当前显示为系统推荐值
      const current = await invoke<number>('system:get-dpi-scale');
      if (typeof current === 'number') {
        setSystemDpiScale(current);
      }
      setStatus({ type: 'success', message: '已清除自定义 DPI，将使用系统自动检测值' });
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ type: 'error', message: '清除失败：' + message });
      setTimeout(() => setStatus(null), 2000);
    }
  };

  const handleDeleteModel = (id: string) => {
    setLocalModels((prev) => prev.filter((m) => m.id !== id));
    setLocalDefaultIds((prev) => {
      const next: typeof prev = {
        ...prev,
        defaultMultimodal: prev.defaultMultimodal === id ? undefined : prev.defaultMultimodal,
        executionEngines: {
          midscene: {
            defaultModelId: prev.executionEngines.midscene.defaultModelId === id
              ? undefined
              : prev.executionEngines.midscene.defaultModelId,
            insightModelId: prev.executionEngines.midscene.insightModelId === id
              ? undefined
              : prev.executionEngines.midscene.insightModelId,
            planningModelId: prev.executionEngines.midscene.planningModelId === id
              ? undefined
              : prev.executionEngines.midscene.planningModelId,
          },
        },
      };
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const nextDefaultIds = { ...localDefaultIds };

      const multimodalModels = localModels.filter((m) => m.tags.includes('multimodal') && m.enabled);
      if (!nextDefaultIds.defaultMultimodal && multimodalModels.length > 0) {
        nextDefaultIds.defaultMultimodal = multimodalModels[0].id;
      }

      const midsceneDefault = nextDefaultIds.executionEngines.midscene;
      if (!midsceneDefault.defaultModelId && multimodalModels.length > 0) {
        midsceneDefault.defaultModelId = multimodalModels[0].id;
      }

      await setModels(localModels);
      await setDefaultModelIds(nextDefaultIds);
      if (localLogPath !== logSavePath) {
        await invoke('execution:setBaseDir', localLogPath);
        await setLogSavePath(localLogPath);
      }
      await setWorkflowSavePath(localWorkflowPath);
      await setUiSettings(localUiSettings);
      await invoke('config:set', { globalRuntimeOption: localRuntimeOption });
      await invoke('system:set-dpi-scale', systemDpiScale);
      setLocalDefaultIds(nextDefaultIds);
      setStatus({ type: 'success', message: '设置已保存' });
      setTimeout(() => {
        setStatus(null);
      }, 2000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ type: 'error', message: `保存失败：${message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectFolder = async (type: 'log' | 'workflow') => {
    const path = await invoke<string | null>('dialog:select-folder');
    if (path) {
      if (type === 'log') {
        setLocalLogPath(path);
      } else {
        setLocalWorkflowPath(path);
      }
    }
  };

  const handleOpenPath = async (type: 'log' | 'workflow') => {
    let path = '';
    if (type === 'log') {
      path = localLogPath || defaultPaths?.log || '';
    } else {
      path = localWorkflowPath || defaultPaths?.workflow || '';
    }
    if (path) {
      await invoke('shell:open-path', path);
    }
  };

  const getDisplayPath = (type: 'log' | 'workflow') => {
    const raw = (type === 'log' ? (localLogPath || defaultPaths?.log || '') : (localWorkflowPath || defaultPaths?.workflow || '')) || '';
    if (!raw) return '默认应用数据目录';
    // 规范化显示：把正反斜杠统一成 Windows 风格的「反斜杠」（更符合 Windows 用户习惯，macOS 也能正常识别），避免显示成 a/b\c\d 这种混合
    return raw.replace(/[\\/]+/g, '\\');
  };

  const handleReset = async () => {
    if (!confirm('确定要重置设置吗？模型库不会被重置。')) return;
    try {
      await resetSettings();
      setLocalDefaultIds({ executionEngines: { midscene: {} } });
      setLocalLogPath('');
      setLocalWorkflowPath('');
      setStatus({ type: 'success', message: '设置已重置' });
      setTimeout(() => {
        setStatus(null);
      }, 2000);
    } catch (e) {
      setStatus({ type: 'error', message: '重置失败' });
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllData();
      setLocalModels([]);
      setLocalDefaultIds({ executionEngines: { midscene: {} } });
      setLocalLogPath('');
      setLocalWorkflowPath('');
      setShowClearConfirm(false);
      setStatus({ type: 'success', message: '所有数据已清理' });
      setTimeout(() => {
        setStatus(null);
      }, 2000);
    } catch (e) {
      setStatus({ type: 'error', message: '清理失败' });
    }
  };

  const SaveBar = () => (
    <div className="sticky bottom-4 z-40 mt-6">
      <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-white/90 backdrop-blur-md p-4 shadow-lg">
        <div className="flex items-center gap-2 min-w-0">
          {status && (
            <>
              {status.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
              {status.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />}
              {status.type === 'info' && <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />}
              <span
                className={cn(
                  'text-sm truncate',
                  status.type === 'success' && 'text-emerald-700',
                  status.type === 'error' && 'text-rose-700',
                  status.type === 'info' && 'text-sky-700'
                )}
                title={status.message}
              >
                {status.message}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Save className="w-4 h-4 mr-2 animate-pulse" /> : <Save className="w-4 h-4 mr-2" />}
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );

  const handleTitleClick = () => {
    const next = titleClickCount + 1;
    if (next >= 5) {
      setTitleClickCount(0);
      if (onDevModeToggle) {
        onDevModeToggle();
      }
    } else {
      setTitleClickCount(next);
      setTimeout(() => {
        setTitleClickCount((c) => (c === next ? 0 : c));
      }, 2000);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <section className="space-y-2">
        <div>
          <h1
            className="text-3xl font-semibold tracking-tight cursor-text select-text"
            onClick={handleTitleClick}
          >
            设置
          </h1>
          <p className="text-muted-foreground">
            配置模型、引擎、存储路径等。
            {devMode && <span className="ml-2 text-xs text-violet-500">开发者模式</span>}
          </p>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="sticky top-0 z-10 -mx-2 px-2 pt-2 pb-3 bg-gradient-to-b from-slate-50/80 via-slate-50/90 to-transparent backdrop-blur-sm">
          <TabsList className="bg-white shadow-sm">
            <TabsTrigger value="simple" className="gap-2">
              <Zap className="w-4 h-4" /> 简单设置
            </TabsTrigger>
            <TabsTrigger value="models" className="gap-2">
              <Boxes className="w-4 h-4" /> 模型库
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <SettingsIcon className="w-4 h-4" /> 高级设置
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="w-4 h-4" /> 外观设置
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-2">
              <HardDrive className="w-4 h-4" /> 存储设置
            </TabsTrigger>
            <TabsTrigger value="about" className="gap-2">
              <Info className="w-4 h-4" /> 关于
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="simple" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                快速配置
              </CardTitle>
              <CardDescription>配置默认多模态模型，即可开始使用。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">默认多模态模型</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  用于视频解析、视觉定位等多模态任务
                </p>
                <ModelSelect
                  value={localDefaultIds.defaultMultimodal}
                  onChange={(id) =>
                    setLocalDefaultIds((prev) => ({
                      ...prev,
                      defaultMultimodal: id,
                      executionEngines: {
                        ...prev.executionEngines,
                        midscene: {
                          ...prev.executionEngines.midscene,
                          defaultModelId: id,
                        },
                      },
                    }))
                  }
                  models={localModels}
                  tagFilter="multimodal"
                  placeholder="选择多模态模型"
                />
              </div>

              {localModels.filter((m) => m.tags.includes('multimodal') && m.enabled).length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
                  <p className="text-sm text-muted-foreground mb-3">还没有配置多模态模型</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      handleAddModel();
                      setActiveTab('models');
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> 去模型库添加
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="models" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-500" />
                模型库
              </CardTitle>
              <CardDescription>管理所有模型配置，支持多标签能力。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  共 {localModels.length} 个模型，启用 {localModels.filter((m) => m.enabled).length} 个
                </p>
                <Button onClick={handleAddModel}>
                  <Plus className="w-4 h-4 mr-1" /> 添加模型
                </Button>
              </div>

              {localModels.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  暂无模型配置，点击上方按钮添加
                </div>
              ) : (
                <div className="space-y-3">
                  {localModels.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      onChange={(m) =>
                        setLocalModels((prev) => prev.map((x) => (x.id === m.id ? m : x)))
                      }
                      onDelete={() => handleDeleteModel(model.id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-sky-500" />
                执行引擎配置
              </CardTitle>
              <CardDescription>配置各执行引擎使用的模型角色。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/40 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Eye className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="text-sm font-medium">Midscene 引擎</h4>
                    <p className="text-xs text-muted-foreground">页面自动化执行引擎</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      默认模型 <span className="text-red-500">*</span>
                    </Label>
                    <ModelSelect
                      value={localDefaultIds.executionEngines.midscene.defaultModelId}
                      onChange={(id) =>
                        setLocalDefaultIds((prev) => ({
                          ...prev,
                          defaultMultimodal: id,
                          executionEngines: {
                            ...prev.executionEngines,
                            midscene: {
                              ...prev.executionEngines.midscene,
                              defaultModelId: id,
                            },
                          },
                        }))
                      }
                      models={localModels}
                      tagFilter="multimodal"
                      placeholder="选择默认模型"
                    />
                    <p className="text-xs text-muted-foreground">用于视觉定位和规划</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      视觉定位模型（可选）
                    </Label>
                    <ModelSelect
                      value={localDefaultIds.executionEngines.midscene.insightModelId}
                      onChange={(id) =>
                        setLocalDefaultIds((prev) => ({
                          ...prev,
                          executionEngines: {
                            ...prev.executionEngines,
                            midscene: {
                              ...prev.executionEngines.midscene,
                              insightModelId: id,
                            },
                          },
                        }))
                      }
                      models={localModels}
                      tagFilter="multimodal"
                      placeholder="使用默认模型"
                      allowClear
                      clearLabel="使用默认模型"
                    />
                    <p className="text-xs text-muted-foreground">不选则使用默认模型</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      规划模型（可选）
                    </Label>
                    <ModelSelect
                      value={localDefaultIds.executionEngines.midscene.planningModelId}
                      onChange={(id) =>
                        setLocalDefaultIds((prev) => ({
                          ...prev,
                          executionEngines: {
                            ...prev.executionEngines,
                            midscene: {
                              ...prev.executionEngines.midscene,
                              planningModelId: id,
                            },
                          },
                        }))
                      }
                      models={localModels}
                      tagFilter="text"
                      placeholder="使用默认模型"
                      allowClear
                      clearLabel="使用默认模型"
                    />
                    <p className="text-xs text-muted-foreground">不选则使用默认模型</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                全局运行参数
              </CardTitle>
              <CardDescription>新建流程时默认继承的运行策略。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>默认节点超时（毫秒）</Label>
                  <Input
                    type="number"
                    min={1000}
                    step={1000}
                    value={localRuntimeOption.defaultTimeout}
                    onChange={(e) =>
                      setLocalRuntimeOption((p) => ({
                        ...p,
                        defaultTimeout: Math.max(1000, Number(e.target.value)),
                      }))
                    }
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label>默认重试次数</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={localRuntimeOption.defaultRetry}
                    onChange={(e) =>
                      setLocalRuntimeOption((p) => ({
                        ...p,
                        defaultRetry: Math.max(0, Math.min(10, Number(e.target.value))),
                      }))
                    }
                    className="bg-white"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MousePointerClick className="w-5 h-5 text-violet-500" />
                系统操作引擎
              </CardTitle>
              <CardDescription>配置系统级自动化操作的参数。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>屏幕 DPI 缩放比例</Label>
                    {dpiDetectInfo && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] px-2 py-0.5',
                          dpiDetectInfo.overridden
                            ? 'bg-orange-50 text-orange-600 border-orange-200'
                            : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                        )}
                      >
                        {dpiDetectInfo.overridden ? '用户自定义' : '自动检测中'}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Input
                      type="number"
                      min={0.5}
                      max={4}
                      step={0.1}
                      value={systemDpiScale}
                      onChange={(e) => setSystemDpiScale(Number(e.target.value))}
                      className="bg-white"
                    />
                    <span className="text-xs text-muted-foreground">倍</span>
                  </div>
                  {dpiDetectInfo && (
                    <div
                      className={cn(
                        'rounded-lg p-3 text-xs space-y-2',
                        dpiDetectInfo.overridden
                          ? 'bg-orange-50 border border-orange-200'
                          : 'bg-sky-50 border border-sky-200'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Info
                            className={cn(
                              'w-3.5 h-3.5 shrink-0',
                              dpiDetectInfo.overridden ? 'text-orange-500' : 'text-sky-500'
                            )}
                          />
                          <span className={cn(
                            'truncate',
                            dpiDetectInfo.overridden ? 'text-orange-700' : 'text-sky-700'
                          )}>
                            检测到「{dpiDetectInfo.displayName}」系统缩放：
                            <span className="font-semibold">{dpiDetectInfo.detectedPercent}%</span>
                            （推荐值 {dpiDetectInfo.detected}x）
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {dpiDetectInfo.detected && Math.abs(systemDpiScale - dpiDetectInfo.detected) > 0.01 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-[11px] bg-white hover:bg-white"
                            onClick={handleUseRecommendedDpi}
                          >
                            使用推荐值 {dpiDetectInfo.detected}x
                          </Button>
                        )}
                        {dpiDetectInfo.overridden && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-[11px] bg-white hover:bg-white text-orange-600 border-orange-200 hover:text-orange-700"
                            onClick={handleClearDpiOverride}
                          >
                            清除自定义，跟随系统
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] hover:bg-transparent text-muted-foreground"
                          onClick={handleRefreshDpiDetect}
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          重新检测
                        </Button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    用于坐标计算和图片匹配。Windows 150% 缩放下建议填 1.5，Mac Retina 屏幕通常为 2.0。
                    不确定时请使用「推荐值」或清除自定义让系统自动跟随。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>节点结束后默认等待（毫秒）</Label>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={localRuntimeOption.systemNodePostDelay ?? 500}
                    onChange={(e) =>
                      setLocalRuntimeOption((p) => ({
                        ...p,
                        systemNodePostDelay: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="bg-white"
                  />
                  <p className="text-xs text-muted-foreground">
                    每个系统操作节点执行完成后的默认等待时间，避免操作过快。可在单个节点属性中覆盖。
                  </p>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-[11px] font-medium text-amber-700 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500" />
                  权限提示
                </div>
                <div className="text-[12px] leading-relaxed text-amber-600">
                  macOS 需要在「系统设置 → 隐私与安全性 → 辅助功能」中授权本应用控制电脑。
                  首次使用系统操作节点时如遇无响应，请检查权限设置。
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Palette className="w-5 h-5 text-violet-500" />
                画布外观
              </CardTitle>
              <CardDescription>自定义工作流画布的显示效果。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <Label className="text-sm font-medium">节点最大宽度倍数</Label>
                <p className="text-xs text-muted-foreground">
                  节点宽度会根据内容自适应，但不会超过基础宽度 × 倍数。普通节点基础宽度 220px，内容节点 280px。
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 1.5, 2, 2.5, 3].map((multiplier) => (
                    <button
                      key={multiplier}
                      type="button"
                      onClick={() => setLocalUiSettings((p) => ({ ...p, nodeWidthMultiplier: multiplier }))}
                      className={cn(
                        'rounded-xl border-2 py-3 text-sm font-medium transition-all',
                        localUiSettings.nodeWidthMultiplier === multiplier
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      )}
                    >
                      {multiplier}x
                    </button>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">
                  当前最大宽度：普通节点 {Math.round(220 * localUiSettings.nodeWidthMultiplier)}px，内容节点 {Math.round(280 * localUiSettings.nodeWidthMultiplier)}px
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-border/40">
                <Label className="text-sm font-medium">连线样式</Label>
                <p className="text-xs text-muted-foreground">
                  选择节点之间连线的显示样式。
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'bezier', label: '曲线', desc: '贝塞尔曲线' },
                    { value: 'smoothstep', label: '圆角折线', desc: '平滑转角' },
                    { value: 'straight', label: '直线', desc: '直接连接' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setLocalUiSettings((p) => ({
                          ...p,
                          edgeStyle: opt.value as 'bezier' | 'smoothstep' | 'straight',
                          edgeAvoidNodes: opt.value === 'straight' ? false : p.edgeAvoidNodes,
                        }))
                      }
                      className={cn(
                        'rounded-xl border-2 py-3 text-sm font-medium transition-all',
                        localUiSettings.edgeStyle === opt.value
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      )}
                    >
                      <div>{opt.label}</div>
                      <div className="text-[10px] font-normal text-muted-foreground mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/40">
                <div className="space-y-0.5">
                  <Label className={`text-sm font-medium ${localUiSettings.edgeStyle === 'straight' ? 'text-gray-400' : ''}`}>
                    连线自动避障
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {localUiSettings.edgeStyle === 'straight'
                      ? '直线模式下不支持自动避障，请切换到曲线或圆角折线样式后开启。'
                      : '连线自动绕开中间节点，避免重叠遮挡。节点较多时可能影响性能。'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={localUiSettings.edgeStyle === 'straight'}
                  onClick={() => setLocalUiSettings((p) => ({ ...p, edgeAvoidNodes: !p.edgeAvoidNodes }))}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    localUiSettings.edgeStyle === 'straight'
                      ? 'bg-gray-100 cursor-not-allowed opacity-50'
                      : 'cursor-pointer',
                    localUiSettings.edgeAvoidNodes ? 'bg-violet-500' : 'bg-gray-200'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform',
                      localUiSettings.edgeAvoidNodes ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>

              <div className="space-y-3 pt-4 border-t border-border/40">
                <Label className="text-sm font-medium">右键菜单模式</Label>
                <p className="text-xs text-muted-foreground">
                  画布右键时显示的节点菜单样式。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'simple', label: '简洁模式', desc: '最近使用 + 固定节点' },
                    { value: 'full', label: '全部节点', desc: '显示所有节点，可搜索' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setLocalUiSettings((p) => ({
                          ...p,
                          contextMenuMode: opt.value as 'simple' | 'full',
                        }))
                      }
                      className={cn(
                        'rounded-xl border-2 py-3 text-sm font-medium transition-all text-left px-3',
                        localUiSettings.contextMenuMode === opt.value
                          ? 'border-violet-400 bg-violet-50 text-violet-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      )}
                    >
                      <div>{opt.label}</div>
                      <div className="text-[10px] font-normal text-muted-foreground mt-0.5">{opt.desc}</div>
                    </button>
                  ))}
                </div>

                {/* 👇 子设置区：右键菜单=简洁/全部 各自的附属选项，视觉做成一块从属卡片 */}
                <div className="mt-2 rounded-xl border border-violet-200/60 bg-violet-50/30 p-3 pl-4 border-l-[3px] border-l-violet-500 space-y-4">
                  {localUiSettings.contextMenuMode === 'simple' ? (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-medium text-violet-900">显示所有固定节点</Label>
                          <p className="text-xs text-muted-foreground">
                            开启后固定节点全部显示，关闭后仅显示最近使用节点。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLocalUiSettings((p) => ({ ...p, showAllPinned: !p.showAllPinned }))}
                          className={cn(
                            'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2',
                            localUiSettings.showAllPinned ? 'bg-violet-500' : 'bg-gray-200'
                          )}
                        >
                          <span
                            className={cn(
                              'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform',
                              localUiSettings.showAllPinned ? 'translate-x-5' : 'translate-x-0'
                            )}
                          />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium text-violet-900">最近使用节点数量</Label>
                          <span className="text-sm text-violet-600 font-medium">{localUiSettings.recentNodeCount} 个</span>
                        </div>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          value={localUiSettings.recentNodeCount}
                          onChange={(e) =>
                            setLocalUiSettings((p) => ({ ...p, recentNodeCount: Number(e.target.value) }))
                          }
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-violet-500"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>1</span>
                          <span>10</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label className="text-sm font-medium text-violet-900">节点排序方式</Label>
                          <p className="text-xs text-muted-foreground">
                            切换到按分类后，可在左侧节点库中拖拽调整分类/节点顺序，右键菜单会同步。
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: 'default', label: '默认' },
                          { value: 'name', label: '按名称' },
                          { value: 'category', label: '按分类' },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setLocalUiSettings((p) => ({
                                ...p,
                                fullMenuSort: opt.value as 'default' | 'name' | 'category',
                              }))
                            }
                            className={cn(
                              'rounded-xl border-2 py-2.5 text-sm font-medium transition-all',
                              localUiSettings.fullMenuSort === opt.value
                                ? 'border-violet-400 bg-violet-50 text-violet-700'
                                : 'border-gray-200 hover:border-gray-300 text-gray-600 bg-white'
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-border/40">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">运行前检查</Label>
                    <p className="text-xs text-muted-foreground">
                      编辑时自动检查工作流，发现问题在节点上高亮显示。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalUiSettings((p) => ({ ...p, enableValidation: !p.enableValidation }))}
                    className={cn(
                      'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2',
                      localUiSettings.enableValidation ? 'bg-violet-500' : 'bg-gray-200'
                    )}
                  >
                    <span
                      className={cn(
                        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform',
                        localUiSettings.enableValidation ? 'translate-x-5' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-border/40">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">节点库排序</Label>
                  <p className="text-xs text-muted-foreground">
                    自定义节点库中分类和节点的显示顺序。点击分类可调整该分类下节点的顺序。
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <span>分类顺序</span>
                    <button
                      type="button"
                      onClick={() => {
                        const defaults = ['control', 'ai-action', 'ai-query', 'wait', 'system'];
                        setLocalUiSettings((p) => ({ ...p, nodeCategoryOrder: defaults, nodeOrderWithinCategory: {} }));
                      }}
                      className="ml-auto text-violet-600 hover:text-violet-700 hover:underline"
                    >
                      重置默认
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {localUiSettings.nodeCategoryOrder.map((cat, idx) => {
                      const catKey = cat as NodeCategory;
                      const catNodes = nodeConfigs.filter((c) => c.category === catKey);
                      const isExpanded = expandedSortCategory === catKey;
                      const nodeOrder = localUiSettings.nodeOrderWithinCategory?.[catKey] || catNodes.map((n) => n.type);

                      const moveNode = (nodeIdx: number, direction: 'up' | 'down') => {
                        const newOrder = [...nodeOrder];
                        const targetIdx = direction === 'up' ? nodeIdx - 1 : nodeIdx + 1;
                        [newOrder[nodeIdx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[nodeIdx]];
                        setLocalUiSettings((p) => ({
                          ...p,
                          nodeOrderWithinCategory: {
                            ...p.nodeOrderWithinCategory,
                            [catKey]: newOrder,
                          },
                        }));
                      };

                      return (
                        <div key={cat} className="rounded-xl border border-gray-200 overflow-hidden">
                          <div
                            className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => setExpandedSortCategory(isExpanded ? null : catKey)}
                          >
                            <span className="text-xs text-gray-400 w-5 text-center">{idx + 1}</span>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="text-sm font-medium flex-1">
                              {categoryLabels[catKey] || cat}
                            </span>
                            <span className="text-xs text-gray-400">{catNodes.length} 个</span>
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => {
                                  setLocalUiSettings((p) => {
                                    const order = [...p.nodeCategoryOrder];
                                    [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                                    return { ...p, nodeCategoryOrder: order };
                                  });
                                }}
                                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="上移"
                              >
                                <ChevronUp className="w-4 h-4 text-gray-500" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === localUiSettings.nodeCategoryOrder.length - 1}
                                onClick={() => {
                                  setLocalUiSettings((p) => {
                                    const order = [...p.nodeCategoryOrder];
                                    [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
                                    return { ...p, nodeCategoryOrder: order };
                                  });
                                }}
                                className="p-1.5 rounded-lg hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="下移"
                              >
                                <ChevronDown className="w-4 h-4 text-gray-500" />
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-gray-200 p-2 space-y-1 bg-white">
                              {nodeOrder.map((nodeType, nodeIdx) => {
                                const nodeConfig = catNodes.find((n) => n.type === nodeType);
                                if (!nodeConfig) return null;
                                const Icon = nodeConfig.icon;
                                return (
                                  <div
                                    key={nodeType}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50"
                                  >
                                    <span className="text-xs text-gray-300 w-5 text-center">{nodeIdx + 1}</span>
                                    <div
                                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                                      style={{ backgroundColor: `${nodeConfig.color}15`, color: nodeConfig.color }}
                                    >
                                      {Icon && <Icon className="w-3.5 h-3.5" />}
                                    </div>
                                    <span className="text-sm flex-1 truncate">{nodeConfig.name}</span>
                                    <div className="flex items-center gap-0.5">
                                      <button
                                        type="button"
                                        disabled={nodeIdx === 0}
                                        onClick={() => moveNode(nodeIdx, 'up')}
                                        className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="上移"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={nodeIdx === nodeOrder.length - 1}
                                        onClick={() => moveNode(nodeIdx, 'down')}
                                        className="p-1 rounded-md hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                        title="下移"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => {
                                  setLocalUiSettings((p) => {
                                    const next = { ...p.nodeOrderWithinCategory };
                                    delete next[catKey];
                                    return { ...p, nodeOrderWithinCategory: next };
                                  });
                                }}
                                className="w-full text-xs text-violet-600 hover:text-violet-700 py-1.5 hover:bg-violet-50 rounded-lg transition-colors"
                              >
                                重置此分类顺序
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="storage" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-sky-500" />
                存储路径
              </CardTitle>
              <CardDescription>配置各类数据的存储位置。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">日志存储路径</Label>
                <div className="flex gap-2">
                  <Input
                    value={getDisplayPath('log')}
                    readOnly
                    className="bg-white flex-1 text-xs"
                  />
                  <Button variant="secondary" size="sm" onClick={() => handleOpenPath('log')}>
                    <FolderOpen className="w-4 h-4 mr-1" /> 打开
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleSelectFolder('log')}>
                    选择目录
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">工作流执行日志、Midscene 报告等</p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">工作流库存储路径</Label>
                <div className="flex gap-2">
                  <Input
                    value={getDisplayPath('workflow')}
                    readOnly
                    className="bg-white flex-1 text-xs"
                  />
                  <Button variant="secondary" size="sm" onClick={() => handleOpenPath('workflow')}>
                    <FolderOpen className="w-4 h-4 mr-1" /> 打开
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleSelectFolder('workflow')}>
                    选择目录
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">所有工作流文件的存储位置</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-rose-500" />
                数据管理
              </CardTitle>
              <CardDescription>重置设置或清理数据。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-border/40 p-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-sky-500" />
                    <span className="text-sm font-medium">清理执行日志</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    清理指定天数之前的执行日志和报告，释放存储空间
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 px-3 text-sm border rounded-lg bg-white"
                    defaultValue="30"
                    id="clearLogDays"
                  >
                    <option value="7">7 天前</option>
                    <option value="30">30 天前</option>
                    <option value="90">90 天前</option>
                    <option value="0">全部</option>
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const select = document.getElementById('clearLogDays') as HTMLSelectElement;
                      const days = Number(select.value);
                      const msg = days === 0
                        ? '确定要清理所有执行日志吗？此操作不可撤销。'
                        : `确定要清理 ${days} 天前的执行日志吗？此操作不可撤销。`;
                      if (!confirm(msg)) return;
                      try {
                        const res = await invoke<any>('execution:clear', days);
                        if (res.success) {
                          setStatus({ type: 'success', message: `已清理 ${res.data.count} 条执行记录` });
                        } else {
                          setStatus({ type: 'error', message: res.error || '清理失败' });
                        }
                      } catch (e) {
                        setStatus({ type: 'error', message: '清理失败' });
                      }
                      setTimeout(() => setStatus(null), 2000);
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" /> 清理
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border/40 p-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium">重置设置</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    重置所有设置为默认值，模型库配置不会被删除
                  </p>
                </div>
                <Button variant="outline" onClick={handleReset}>
                  重置设置
                </Button>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-500" />
                    <span className="text-sm font-medium text-rose-700">一键清理所有数据</span>
                  </div>
                  <p className="text-xs text-rose-600">
                    清空所有本地数据，包括模型配置、工作流、设置等，应用将恢复到刚安装的状态
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowClearConfirm(true)}
                >
                  清理所有数据
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="about" className="space-y-4 mt-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" />
                关于 mimic-flow
              </CardTitle>
              <CardDescription>AI 驱动的桌面自动化工作流工具</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-400 to-sky-400 flex items-center justify-center shadow-lg shrink-0">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-gray-800">mimic-flow</div>
                  <div className="text-sm text-gray-500">版本 {appVersion}</div>
                  <div className="text-sm text-gray-600">
                    基于 AI 的可视化桌面自动化工作流编排工具，让复杂的电脑操作变得简单直观。
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-500" />
                  相关链接
                </div>
                <div className="space-y-2">
                  <button
                    onClick={() => window.mimic?.invoke('shell:open-external', 'https://jibuzixin.github.io/mimic-flow/')}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center shrink-0">
                      <HomeIcon className="w-4 h-4 text-sky-600" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">官方主页</div>
                      <div className="text-xs text-gray-500">jibuzixin.github.io/mimic-flow</div>
                    </div>
                  </button>
                  <button
                    onClick={() => window.mimic?.invoke('shell:open-external', 'https://github.com/jibuzixin/mimic-flow')}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      <GithubIcon className="w-4 h-4 text-gray-600" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">GitHub 仓库</div>
                      <div className="text-xs text-gray-500">github.com/jibuzixin/mimic-flow</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-rose-500" />
                  致谢
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-violet-50/50 rounded-xl border border-violet-100">
                    <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                      <Eye className="w-4 h-4 text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-800">Midscene.js</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        提供 AI 视觉驱动的网页自动化能力，本项目的核心引擎之一
                      </div>
                      <button
                        onClick={() => window.mimic?.invoke('shell:open-external', 'https://midscenejs.com')}
                        className="text-xs text-violet-600 hover:text-violet-700 mt-1 flex items-center gap-1"
                      >
                        <Globe className="w-3 h-3" />
                        midscenejs.com
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <GithubIcon className="w-4 h-4 text-gray-600" />
                  联系方式 & 社区
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="text-xs text-gray-500 leading-relaxed">
                    如有问题或建议，欢迎通过 GitHub Issue 反馈，我们会尽快回复。
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-600" />
                  开源协议
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="text-sm font-medium text-gray-800 mb-1">MIT License</div>
                  <div className="text-xs text-gray-500 leading-relaxed">
                    本项目采用 MIT 开源协议，您可以自由地使用、复制、修改、合并、发布、分发、再授权和/或销售本软件的副本。
                    有关详细信息，请参阅项目根目录下的 LICENSE 文件。
                  </div>
                </div>
              </div>

              <div className="text-center text-xs text-gray-400 pt-2">
                Made with <Heart className="w-3 h-3 inline text-rose-400" /> by jibuzixin
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SaveBar />

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowClearConfirm(false)} />
          <div className="relative w-96 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                </div>
                <div>
                  <h3 className="font-semibold">确认清理所有数据？</h3>
                  <p className="text-sm text-muted-foreground">此操作不可撤销</p>
                </div>
              </div>
              <div className="text-sm text-gray-600 space-y-1 pl-13">
                <p>• 所有模型配置将被删除</p>
                <p>• 所有工作流将被删除</p>
                <p>• 所有设置将重置为默认值</p>
                <p>• 应用将恢复到刚安装的状态</p>
              </div>
            </div>
            <div className="flex border-t border-gray-100">
              <button
                className="flex-1 py-3 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                onClick={() => setShowClearConfirm(false)}
              >
                取消
              </button>
              <button
                className="flex-1 py-3 text-sm text-rose-600 font-medium hover:bg-rose-50 transition-colors border-l border-gray-100"
                onClick={handleClearAll}
              >
                确认清理
              </button>
            </div>
          </div>
        </div>
      )}

      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-20 right-6 z-50 w-10 h-10 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-all hover:shadow-xl active:scale-95"
          title="回到顶部"
        >
          <ChevronUp className="w-5 h-5 text-gray-600" />
        </button>
      )}
    </div>
  );
}
