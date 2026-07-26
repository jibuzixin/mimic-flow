import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  ArrowRight,
  RefreshCw,
  Layers,
  Zap,
  FileText,
  Edit3,
  Loader2,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { invoke } from '../lib/api';
import { cn } from '../lib/utils';
import { useWorkflowStore } from '../stores/workflowStore';

interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failed' | 'stopped' | 'running';
  startTime: number;
  endTime: number;
  duration: number;
  nodeTotal: number;
  nodeSuccess: number;
  nodeFailed: number;
  hasMidsceneReport: boolean;
}

interface DashboardStats {
  totalExecutions: number;
  successCount: number;
  failedCount: number;
  successRate: number;
  workflowCount: number;
  recentExecutions: ExecutionRecord[];
  executionTrend: Array<{ date: string; total: number; success: number; failed: number }>;
}

const features = [
  { title: '工作流编排', desc: '可视化编辑器，拖拽式构建自动化流程。', icon: Layers, path: '/workflows', color: 'from-violet-400 to-fuchsia-400' },
  { title: '执行日志', desc: '查看历史执行记录、详细日志和 AI 报告。', icon: FileText, path: '/logs', color: 'from-sky-400 to-cyan-400' },
  { title: '设置中心', desc: '配置模型、外观、存储路径等系统设置。', icon: Zap, path: '/settings', color: 'from-amber-400 to-orange-400' },
];

function formatNumber(n: number) {
  return n.toLocaleString('zh-CN');
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}秒`;
  const min = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(0);
  return `${min}分${s}秒`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusIcon(status: ExecutionRecord['status']) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-rose-500" />;
    case 'stopped':
      return <Clock className="w-4 h-4 text-amber-500" />;
    case 'running':
      return <Play className="w-4 h-4 text-sky-500 animate-pulse" />;
  }
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningExecution, setRunningExecution] = useState<ExecutionRecord | null>(null);
  const [, setTick] = useState(0);
  const navigate = useNavigate();
  const { workflows, exportWorkflow } = useWorkflowStore();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const loadStats = async () => {
    setLoading(true);
    const res = await invoke<any>('execution:stats');
    if (res.success && res.data) {
      setStats(res.data);
    }
    setLoading(false);
  };

  const findWorkflow = (workflowId: string, workflowName: string) => {
    let workflow = workflows.find((w) => w.id === workflowId);
    if (!workflow) {
      workflow = workflows.find((w) => w.workflow?.flowMeta?.name === workflowName);
    }
    return workflow;
  };

  const handleRunWorkflow = async (workflowId: string, workflowName: string) => {
    try {
      const workflow = findWorkflow(workflowId, workflowName);
      if (!workflow) {
        alert('工作流不存在');
        return;
      }
      const flowSchema = exportWorkflow(workflow.id);
      const runRes = await window.mimic?.invoke('flow-v2:run', flowSchema, { workflowId: workflow.id });
      if (!(runRes as any)?.success) {
        alert('启动失败: ' + ((runRes as any)?.error || '未知错误'));
      }
    } catch (e) {
      alert('启动失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleStopWorkflow = async () => {
    try {
      await window.mimic?.invoke('flow-v2:stop');
    } catch (e) {
      alert('停止失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  useEffect(() => {
    loadStats();
    
    const unsubscribe = window.mimic.on('flow-v2:event', (event: any) => {
      if (event.type === 'flow:start') {
        const workflowId = event.workflowId || event.flowId;
        const workflowName = event.workflowName || '工作流';
        setRunningExecution({
          id: event.flowId,
          workflowId,
          workflowName,
          status: 'running',
          startTime: event.startTime || Date.now(),
          endTime: 0,
          duration: 0,
          nodeTotal: 0,
          nodeSuccess: 0,
          nodeFailed: 0,
          hasMidsceneReport: false,
        });
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setTick((t) => t + 1);
        }, 1000);
      } else if (event.type === 'flow:complete') {
        setRunningExecution(null);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setTimeout(loadStats, 500);
      }
    });

    return () => {
      unsubscribe?.();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">首页</h1>
        <p className="text-muted-foreground">快速开始工作流，查看最近执行动态</p>
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

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" /> 总执行次数
            </p>
            <p className="text-2xl font-semibold">{formatNumber(stats?.totalExecutions ?? 0)}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Layers className="w-3 h-3" /> 工作流数
            </p>
            <p className="text-2xl font-semibold">{workflows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-soft bg-white/70 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Play className="w-5 h-5 text-violet-500" />
              最近执行
            </CardTitle>
            <CardDescription>查看最近 10 条执行记录</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/logs">
              查看全部
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">加载中...</div>
          ) : (runningExecution && (!stats?.recentExecutions || stats.recentExecutions.length === 0)) || (stats?.recentExecutions && stats.recentExecutions.length > 0) ? (
            <div className="space-y-2">
              {runningExecution && (
                <div
                  key={runningExecution.id}
                  className="w-full flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm shadow-soft"
                >
                  <button
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-default"
                  >
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
                    <div className="text-left min-w-0">
                      <p className="font-medium truncate text-amber-900">{runningExecution.workflowName}</p>
                      <p className="text-xs text-amber-600">
                        正在执行 · {formatDuration(Date.now() - runningExecution.startTime)}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-[11px] border-amber-300 bg-amber-100 text-amber-700"
                    >
                      执行中
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 hover:bg-amber-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStopWorkflow();
                      }}
                      title="停止"
                    >
                      <Square className="w-3.5 h-3.5 text-amber-600 fill-amber-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 hover:bg-amber-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        const wf = findWorkflow(runningExecution.workflowId, runningExecution.workflowName);
                        if (wf) {
                          navigate(`/workflows/editor?id=${wf.id}`);
                        } else {
                          alert('工作流不存在');
                        }
                      }}
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-700" />
                    </Button>
                  </div>
                </div>
              )}
              {stats.recentExecutions
                .filter((r) => !runningExecution || r.workflowId !== runningExecution.workflowId)
                .map((record) => (
                <div
                  key={record.id}
                  className="w-full flex items-center justify-between rounded-xl bg-white/50 px-4 py-3 text-sm hover:bg-white/80 transition-all hover:shadow-soft group"
                >
                  <button
                    onClick={() => navigate(`/logs?id=${record.id}`)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    {getStatusIcon(record.status)}
                    <div className="text-left min-w-0">
                      <p className="font-medium truncate">{record.workflowName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(record.startTime)} · {formatDuration(record.duration)}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px]',
                        record.status === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                        record.status === 'failed' && 'border-rose-200 bg-rose-50 text-rose-700',
                        record.status === 'stopped' && 'border-amber-200 bg-amber-50 text-amber-700'
                      )}
                    >
                      {record.status === 'success' ? '成功' : record.status === 'failed' ? '失败' : '已停止'}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRunWorkflow(record.workflowId, record.workflowName);
                      }}
                      title="运行"
                      disabled={!!runningExecution}
                    >
                      <Play className={cn(
                        "w-3.5 h-3.5",
                        runningExecution ? "text-muted-foreground" : "text-emerald-600"
                      )} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        const wf = findWorkflow(record.workflowId, record.workflowName);
                        if (wf) {
                          navigate(`/workflows/editor?id=${wf.id}`);
                        } else {
                          alert('工作流不存在');
                        }
                      }}
                      title="编辑"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-violet-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              暂无执行记录，去创建工作流试试吧
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
