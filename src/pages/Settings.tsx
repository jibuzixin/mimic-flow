import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Slider } from '../components/ui/slider';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
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
  Layers,
  Monitor,
  Clock,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { invoke } from '../lib/api';
import { cn } from '../lib/utils';
import type { ModelProfile, ModelCapability, ModelPricing, DefaultModelSelection } from '../../types';
import type { IpcResponse } from '../../types/flow';
import { v4 as uuidv4 } from 'uuid';

const CAPABILITY_META: Record<
  ModelCapability,
  { label: string; icon: React.ElementType; color: string; description: string }
> = {
  multimodal: {
    label: '多模态',
    icon: Eye,
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    description: '视频解析、参考图定位、视觉理解',
  },
  text: {
    label: '文本',
    icon: FileText,
    color: 'bg-sky-100 text-sky-700 border-sky-200',
    description: '汇总、去重、文本推理',
  },
  asr: {
    label: 'ASR',
    icon: Mic,
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    description: '语音转录',
  },
  midscene: {
    label: 'Midscene',
    icon: Monitor,
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    description: '页面自动化执行',
  },
};

function PricingEditor({
  pricing,
  onChange,
}: {
  pricing: ModelPricing;
  onChange: (p: ModelPricing) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl bg-white/50 p-4">
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
          className="bg-white/60"
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
          className="bg-white/60"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">货币</Label>
        <RadioGroup
          value={pricing.currency}
          onValueChange={(v: string) => onChange({ ...pricing, currency: v as 'CNY' | 'USD' })}
          className="flex gap-4 pt-2"
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="CNY" id="pricing-cny" />
            <Label htmlFor="pricing-cny" className="font-normal">CNY</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="USD" id="pricing-usd" />
            <Label htmlFor="pricing-usd" className="font-normal">USD</Label>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
}

function ModelEditor({
  model,
  onChange,
  onDelete,
}: {
  model: ModelProfile;
  onChange: (m: ModelProfile) => void;
  onDelete: () => void;
}) {
  const meta = CAPABILITY_META[model.capability];
  const Icon = meta.icon;

  return (
    <div className="rounded-2xl border border-border/40 bg-white/50 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', meta.color)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              {model.name || '未命名模型'}
              <Badge variant="outline" className={cn(meta.color, 'text-[10px]')}>
                {meta.label}
              </Badge>
            </h4>
            <p className="text-xs text-muted-foreground truncate">{meta.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={model.enabled}
            onCheckedChange={(v) => onChange({ ...model, enabled: v })}
          />
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2 md:col-span-2">
          <Label className="text-xs text-muted-foreground">显示名称</Label>
          <Input
            value={model.name}
            onChange={(e) => onChange({ ...model, name: e.target.value })}
            placeholder="例如：豆包多模态"
            className="bg-white/60"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Provider</Label>
          <Select
            value={model.provider}
            onValueChange={(v) => onChange({ ...model, provider: v })}
          >
            <SelectTrigger className="bg-white/60">
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
          <Label className="text-xs text-muted-foreground">能力类型</Label>
          <Select
            value={model.capability}
            onValueChange={(v) => onChange({ ...model, capability: v as ModelCapability })}
          >
            <SelectTrigger className="bg-white/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="multimodal">多模态</SelectItem>
              <SelectItem value="text">文本</SelectItem>
              <SelectItem value="asr">ASR</SelectItem>
              <SelectItem value="midscene">Midscene</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <Server className="w-3 h-3" /> Base URL
          </Label>
          <Input
            value={model.baseUrl}
            onChange={(e) => onChange({ ...model, baseUrl: e.target.value })}
            placeholder="https://ark.cn-beijing.volces.com/api/v3"
            className="bg-white/60"
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
            className="bg-white/60"
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
            className="bg-white/60"
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
            className="bg-white/60"
          />
        </div>
        {model.capability === 'multimodal' && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">单次最大图片数</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={model.maxImagesPerRequest ?? 10}
              onChange={(e) => onChange({ ...model, maxImagesPerRequest: Math.max(1, Number(e.target.value)) })}
              className="bg-white/60"
            />
          </div>
        )}
        {model.capability === 'midscene' && (
          <>
            <div className="flex items-center justify-between rounded-xl bg-white/40 p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Deep Think</Label>
                <p className="text-xs text-muted-foreground">更注重任务拆解</p>
              </div>
              <Switch
                checked={model.defaultDeepThink ?? false}
                onCheckedChange={(v) => onChange({ ...model, defaultDeepThink: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/40 p-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">启用缓存</Label>
                <p className="text-xs text-muted-foreground">允许 Midscene 缓存规划结果</p>
              </div>
              <Switch
                checked={model.cacheable ?? true}
                onCheckedChange={(v) => onChange({ ...model, cacheable: v })}
              />
            </div>
          </>
        )}
      </div>

      <PricingEditor
        pricing={model.pricing}
        onChange={(p) => onChange({ ...model, pricing: p })}
      />
    </div>
  );
}

export default function SettingsPage() {
  const {
    models,
    defaultModelIds,
    videoSavePath,
    videoParseConcurrency,
    setModels,
    setDefaultModelIds,
    setVideoSavePath,
    setVideoParseConcurrency,
  } = useAppStore();

  const [localModels, setLocalModels] = useState<ModelProfile[]>([]);
  const [localDefaultIds, setLocalDefaultIds] = useState<DefaultModelSelection>({});
  const [localConcurrency, setLocalConcurrency] = useState(videoParseConcurrency);
  const [localRuntimeOption, setLocalRuntimeOption] = useState({ defaultTimeout: 300000, defaultRetry: 0 });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState('models');
  const [hasChanges, setHasChanges] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);

  useEffect(() => {
    setLocalModels(models.length ? models : []);
  }, [models]);

  useEffect(() => {
    setLocalDefaultIds(defaultModelIds);
  }, [defaultModelIds]);

  useEffect(() => {
    setLocalConcurrency(videoParseConcurrency);
  }, [videoParseConcurrency]);

  useEffect(() => {
    invoke<IpcResponse<{ globalRuntimeOption: { defaultTimeout: number; defaultRetry: number } }>>('config:get').then((res) => {
      if (res.success && res.data?.globalRuntimeOption) {
        setLocalRuntimeOption(res.data.globalRuntimeOption);
        setInitialLoaded(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialLoaded) return;
    setHasChanges(true);
  }, [localModels, localDefaultIds, localConcurrency, localRuntimeOption, initialLoaded]);

  const handleAddModel = (capability: ModelCapability) => {
    const newModel: ModelProfile = {
      id: uuidv4(),
      name: '',
      provider: 'doubao',
      capability,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: '',
      modelId: '',
      enabled: true,
      pricing: { inputPricePer1K: 0, outputPricePer1K: 0, currency: 'CNY' },
      timeout: 60000,
      maxImagesPerRequest: capability === 'multimodal' ? 10 : undefined,
      defaultDeepThink: capability === 'midscene' ? false : undefined,
      cacheable: capability === 'midscene' ? true : undefined,
    };
    setLocalModels((prev) => [...prev, newModel]);
  };

  const handleDeleteModel = (id: string) => {
    setLocalModels((prev) => prev.filter((m) => m.id !== id));
    setLocalDefaultIds((prev) => {
      const next = { ...prev };
      if (next.multimodal === id) delete next.multimodal;
      if (next.text === id) delete next.text;
      if (next.asr === id) delete next.asr;
      if (next.midscene === id) delete next.midscene;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      // 自动修正默认选择：若某个能力没有默认模型，则选择第一个启用的该能力模型
      const nextDefaultIds = { ...localDefaultIds };
      (['multimodal', 'text', 'asr', 'midscene'] as ModelCapability[]).forEach((cap) => {
        const candidates = localModels.filter((m) => m.capability === cap && m.enabled);
        if (candidates.length && !candidates.some((m) => m.id === nextDefaultIds[cap])) {
          nextDefaultIds[cap] = candidates[0].id;
        }
      });

      await setModels(localModels);
      await setDefaultModelIds(nextDefaultIds);
      await setVideoParseConcurrency(localConcurrency);
      await invoke('config:set', { globalRuntimeOption: localRuntimeOption });
      setLocalDefaultIds(nextDefaultIds);
      setHasChanges(false);
      setStatus({ type: 'success', message: '设置已保存' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ type: 'error', message: `保存失败：${message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectFolder = async () => {
    const path = await invoke<string | null>('dialog:select-folder');
    if (path) setVideoSavePath(path);
  };

  const renderDefaultSelect = (capability: ModelCapability, label: string) => {
    const candidates = localModels.filter((m) => m.capability === capability);
    const value = localDefaultIds[capability] || '';
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Select
          value={value}
          onValueChange={(v) => setLocalDefaultIds((prev) => ({ ...prev, [capability]: v }))}
          disabled={candidates.length === 0}
        >
          <SelectTrigger className="bg-white/60">
            <SelectValue placeholder={candidates.length === 0 ? '暂无可用模型' : '选择模型'} />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  {m.name || '未命名'}
                  {!m.enabled && <span className="text-xs text-muted-foreground">（已禁用）</span>}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const SaveBar = () => (
    <div className="sticky bottom-4 z-40 mt-6">
      <div
        className="flex items-center justify-between rounded-2xl border border-border/50 bg-white/90 backdrop-blur-md p-4 shadow-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {status?.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />}
          {status?.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />}
          {status?.type === 'info' && <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />}
          <span
            className={cn(
              'text-sm truncate',
              status?.type === 'success' && 'text-emerald-700',
              status?.type === 'error' && 'text-rose-700',
              status?.type === 'info' && 'text-sky-700'
            )}
            title={status?.message || (hasChanges ? '有未保存的更改' : '所有设置已保存')}
          >
            {status?.message || (hasChanges ? '有未保存的更改' : '所有设置已保存')}
          </span>
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
          <p className="text-muted-foreground">配置模型、价格、默认选项与存储路径。</p>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white/70 backdrop-blur-sm shadow-soft">
          <TabsTrigger value="models" className="gap-2">
            <Brain className="w-4 h-4" /> 模型管理
          </TabsTrigger>
          <TabsTrigger value="defaults" className="gap-2">
            <Sparkles className="w-4 h-4" /> 默认选择
          </TabsTrigger>
          <TabsTrigger value="runtime" className="gap-2">
            <Layers className="w-4 h-4" /> 运行设置
          </TabsTrigger>
        </TabsList>

        <TabsContent value="models" className="space-y-4 mt-4">
          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="w-5 h-5 text-violet-500" />
                模型列表
              </CardTitle>
              <CardDescription>可配置多个模型，在不同场景下选择使用。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => handleAddModel('multimodal')}>
                  <Plus className="w-4 h-4 mr-1" /> 多模态
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAddModel('text')}>
                  <Plus className="w-4 h-4 mr-1" /> 文本
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAddModel('asr')}>
                  <Plus className="w-4 h-4 mr-1" /> ASR
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAddModel('midscene')}>
                  <Plus className="w-4 h-4 mr-1" /> Midscene
                </Button>
              </div>

              {localModels.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  暂无模型配置，点击上方按钮添加
                </div>
              ) : (
                <div className="space-y-4">
                  {localModels.map((model) => (
                    <ModelEditor
                      key={model.id}
                      model={model}
                      onChange={(m) => setLocalModels((prev) => prev.map((x) => (x.id === m.id ? m : x)))}
                      onDelete={() => handleDeleteModel(model.id)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="defaults" className="space-y-4 mt-4">
          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-sky-500" />
                默认模型选择
              </CardTitle>
              <CardDescription>各场景默认使用的模型，也可在具体功能中单独指定。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {renderDefaultSelect('multimodal', '默认多模态模型（视频解析）')}
                {renderDefaultSelect('text', '默认文本模型（汇总/对话）')}
                {renderDefaultSelect('asr', '默认 ASR 模型（语音转录）')}
                {renderDefaultSelect('midscene', '默认 Midscene 模型（流程执行）')}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runtime" className="space-y-4 mt-4">
          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-sky-500" />
                存储设置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input value={videoSavePath} readOnly placeholder="默认使用应用数据目录" className="bg-white/60" />
                <Button variant="secondary" onClick={handleSelectFolder}>选择目录</Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-500" />
                视频解析设置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label className="text-sm font-medium">并发批次数量</Label>
                  <span className="text-xs text-muted-foreground">{localConcurrency}</span>
                </div>
                <Slider value={[localConcurrency]} onValueChange={(v) => setLocalConcurrency(v[0])} min={1} max={10} step={1} />
                <p className="text-xs text-muted-foreground">并发数越高解析越快，但对模型服务压力越大。</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-sky-500" />
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
                    onChange={(e) => setLocalRuntimeOption((p) => ({ ...p, defaultTimeout: Math.max(1000, Number(e.target.value)) }))}
                    className="bg-white/60"
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
                    onChange={(e) => setLocalRuntimeOption((p) => ({ ...p, defaultRetry: Math.max(0, Math.min(10, Number(e.target.value))) }))}
                    className="bg-white/60"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SaveBar />
    </div>
  );
}
