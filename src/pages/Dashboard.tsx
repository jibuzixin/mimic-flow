import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useUsageStore } from '../stores/usageStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Video, Workflow, Play, Sparkles, ArrowRight, RefreshCw, Coins, BarChart3, Activity, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ModelUsageRecord } from '../../types';

const features = [
  { title: '视频模仿', desc: '上传或录制视频，让 AI 解析并生成可执行工作流。', icon: Video, path: '/recorder', color: 'from-violet-400 to-fuchsia-400' },
  { title: '事件监听', desc: '录制鼠标键盘操作，生成可编排的自动化流程。', icon: Workflow, path: '/recorder', color: 'from-sky-400 to-cyan-400' },
  { title: '你说我做', desc: '用自然语言指挥 AI 一步步完成操作。', icon: Sparkles, path: '/executor', color: 'from-amber-400 to-orange-400' },
];

function formatNumber(n: number) {
  return n.toLocaleString('zh-CN');
}

function formatCurrency(n: number, currency: 'CNY' | 'USD') {
  const symbol = currency === 'CNY' ? '¥' : '$';
  return `${symbol}${n.toFixed(4)}`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function CostLineChart({ records }: { records: ModelUsageRecord[] }) {
  if (records.length < 2) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-muted-foreground bg-white/40 rounded-xl">
        数据不足，无法生成趋势图
      </div>
    );
  }

  const data = [...records].reverse().slice(-20);
  const max = Math.max(...data.map((d) => d.cost), 0.001);
  const width = 100;
  const height = 40;
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (d.cost / max) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="w-full h-32 bg-white/40 rounded-xl p-4">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(139, 92, 246, 0.25)" />
            <stop offset="100%" stopColor="rgba(139, 92, 246, 0)" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke="rgb(139, 92, 246)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        <polygon fill="url(#lineGradient)" points={`0,${height} ${points} ${width},${height}`} />
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const { platform, modelProvider } = useAppStore();
  const { stats, load, refresh } = useUsageStore();

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">仪表盘</h1>
        <p className="text-muted-foreground">
          当前平台：<Badge variant="secondary">{platform}</Badge>
          {modelProvider?.apiKey && modelProvider?.multimodalModel?.model && (
            <span className="ml-3">
              已配置多模态模型：<Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{modelProvider.multimodalModel.model}</Badge>
            </span>
          )}
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {features.map((f) => (
          <Card key={f.title} className="group border-0 shadow-soft hover:shadow-glow transition-all duration-300 bg-white/70 backdrop-blur-sm">
            <CardHeader>
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center shadow-soft mb-3`}>
                <f.icon className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">{f.title}</CardTitle>
              <CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="ghost" className="group/btn px-0" asChild>
                <Link to={f.path}>
                  进入
                  <ArrowRight className="w-4 h-4 ml-1 transition-transform group-hover/btn:translate-x-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-violet-500" />
              模型使用统计
            </CardTitle>
            <CardDescription>基于原始响应 usage 字段粗略估算，仅供参考。</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-white/50 p-4 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="w-3 h-3" /> 总请求</p>
              <p className="text-2xl font-semibold">{formatNumber(stats?.totalRequests ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-white/50 p-4 space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Coins className="w-3 h-3" /> 总花费</p>
              <p className="text-2xl font-semibold">{formatCurrency(stats?.totalCost ?? 0, stats?.primaryCurrency ?? 'CNY')}</p>
            </div>
            <div className="rounded-xl bg-white/50 p-4 space-y-1">
              <p className="text-xs text-muted-foreground">总 Tokens</p>
              <p className="text-2xl font-semibold">{formatNumber(stats?.totalTokens ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-white/50 p-4 space-y-1">
              <p className="text-xs text-muted-foreground">已统计请求</p>
              <p className="text-2xl font-semibold">{formatNumber(stats?.usageKnownRequests ?? 0)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-500" />
                最近请求
              </h4>
              {stats && stats.recentRecords.length > 0 ? (
                <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                  {stats.recentRecords.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-xl bg-white/50 px-3 py-2 text-sm">
                      <div className="space-y-0.5">
                        <p className="font-medium">{r.model || '未知模型'}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(r.timestamp)} · {r.feature}</p>
                      </div>
                      <div className="text-right space-y-0.5">
                        <p className="font-medium">{formatCurrency(r.cost, r.currency)}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(r.usage.totalTokens)} tokens</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">暂无使用记录。</p>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium">单次请求花费趋势</h4>
              <CostLineChart records={stats?.recentRecords ?? []} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Play className="w-5 h-5 text-violet-500" />
            最近工作流
          </CardTitle>
          <CardDescription>暂无工作流，去录制或解析一个吧。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/workflows">查看全部工作流</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
