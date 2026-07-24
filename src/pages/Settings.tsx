import { useState, useEffect } from 'react';
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
  RotateCcw,
  Database,
  Settings as SettingsIcon,
  Boxes,
  HardDrive,
  Zap,
  Palette,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { invoke } from '../lib/api';
import { cn } from '../lib/utils';
import type { ModelProfile, ModelTag, EngineModelConfig, DefaultModelSelection } from '../../types';
import { MODEL_TAG_META } from '../../types';
import type { IpcResponse } from '../../types/flow';
import { v4 as uuidv4 } from 'uuid';

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
                  onValueChange={(v) => onChange({ ...model, provider: v })}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="doubao">豆包</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="custom">自定义</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">模型系列</Label>
                <Input
                  value={model.modelFamily || ''}
                  onChange={(e) => onChange({ ...model, modelFamily: e.target.value })}
                  placeholder="例如：doubao-seed"
                  className="bg-white"
                />
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
                  <p className="text-xs text-muted-foreground">启用深度思考模式</p>
                </div>
                <Switch
                  checked={model.reasoningEnabled ?? false}
                  onCheckedChange={(v) => onChange({ ...model, reasoningEnabled: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">启用缓存</Label>
                  <p className="text-xs text-muted-foreground">允许缓存规划结果</p>
                </div>
                <Switch
                  checked={model.cacheable ?? true}
                  onCheckedChange={(v) => onChange({ ...model, cacheable: v })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Coins className="w-3 h-3" /> 价格配置
              </Label>
              <PricingEditor
                pricing={model.pricing}
                onChange={(p) => onChange({ ...model, pricing: p })}
              />
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

export default function SettingsPage() {
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
  const [localRuntimeOption, setLocalRuntimeOption] = useState({ defaultTimeout: 300000, defaultRetry: 0 });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState('simple');
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
    invoke<IpcResponse<{ globalRuntimeOption: { defaultTimeout: number; defaultRetry: number } }>>('config:get').then((res) => {
      if (res.success && res.data?.globalRuntimeOption) {
        setLocalRuntimeOption(res.data.globalRuntimeOption);
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
      modelFamily: 'doubao-seed',
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
      await setLogSavePath(localLogPath);
      await setWorkflowSavePath(localWorkflowPath);
      await setUiSettings(localUiSettings);
      await invoke('config:set', { globalRuntimeOption: localRuntimeOption });
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
    if (type === 'log') {
      return localLogPath || defaultPaths?.log || '默认应用数据目录';
    } else {
      return localWorkflowPath || defaultPaths?.workflow || '默认应用数据目录';
    }
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24">
      <section className="space-y-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
          <p className="text-muted-foreground">配置模型、引擎、存储路径等。</p>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
        </TabsList>

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
              <CardDescription>重置设置或清理所有数据。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
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
    </div>
  );
}
