import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Play,
  Pause,
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
  Plus,
  Trash2,
  Calendar,
  CalendarClock,
  AlertCircle,
  Pencil,
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

interface ScheduledTask {
  id: string;
  name: string;
  workflowId: string;
  workflowName: string;
  triggerType: 'once' | 'interval' | 'cron';
  nextRunAt: number;
  lastRunAt?: number;
  intervalMs?: number;
  cronExpression?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface TaskState {
  tasks: ScheduledTask[];
  running: boolean;
  queueSize: number;
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
  const { workflows, exportWorkflow, loadFromStorage } = useWorkflowStore();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [taskState, setTaskState] = useState<TaskState>({ tasks: [], running: false, queueSize: 0 });
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [wfSearch, setWfSearch] = useState('');
  const [taskForm, setTaskForm] = useState({
    name: '',
    workflowId: '',
    workflowName: '',
    triggerType: 'once' as ScheduledTask['triggerType'],
    onceAt: '',
    intervalMin: 30,
    cronExpression: '0 9 * * *',
    enabled: true,
  });
  const [taskLoading, setTaskLoading] = useState(false);

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

  const loadTasks = async () => {
    try {
      const res = await invoke<any>('scheduled-tasks:list');
      if (res && res.tasks) {
        setTaskState({ tasks: res.tasks, running: res.running, queueSize: res.queueSize });
      }
    } catch (e) {
      // ignore in browser mock
    }
  };

  const openNewTask = () => {
    setEditingTask(null);
    const now = new Date(Date.now() + 3600_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    setWfSearch('');
    setTaskForm({
      name: '',
      workflowId: '',
      workflowName: '',
      triggerType: 'once',
      onceAt: local,
      intervalMin: 30,
      cronExpression: '0 9 * * *',
      enabled: true,
    });
    setTaskDialogOpen(true);
  };

  const openEditTask = (task: ScheduledTask) => {
    setEditingTask(task);
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date(task.nextRunAt);
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setWfSearch(task.workflowName || '');
    setTaskForm({
      name: task.name,
      workflowId: task.workflowId,
      workflowName: task.workflowName || '',
      triggerType: task.triggerType,
      onceAt: local,
      intervalMin: task.intervalMs ? Math.round(task.intervalMs / 60000) : 30,
      cronExpression: task.cronExpression || '0 9 * * *',
      enabled: task.enabled,
    });
    setTaskDialogOpen(true);
  };

  const onWfSearchChange = (val: string) => {
    setWfSearch(val);
    const match = workflows.find((w) => (w.workflow?.flowMeta?.name || w.id) === val);
    if (match) {
      setTaskForm({
        ...taskForm,
        workflowId: match.id,
        workflowName: match.workflow?.flowMeta?.name || match.id,
      });
    } else if (val.trim()) {
      const fuzzy = workflows.find((w) =>
        (w.workflow?.flowMeta?.name || w.id).toLowerCase().includes(val.toLowerCase())
      );
      if (fuzzy) {
        setTaskForm({
          ...taskForm,
          workflowId: fuzzy.id,
          workflowName: fuzzy.workflow?.flowMeta?.name || fuzzy.id,
        });
      }
    }
  };

  const saveTask = async () => {
    if (!taskForm.name.trim()) { alert('请输入任务名称'); return; }
    if (!taskForm.workflowId) { alert('请选择工作流'); return; }
    const wf = workflows.find((w) => w.id === taskForm.workflowId);
    if (!wf) { alert('工作流不存在'); return; }
    setTaskLoading(true);
    try {
      let nextRunAt: number | undefined;
      if (taskForm.triggerType === 'once') {
        if (!taskForm.onceAt) { alert('请选择执行时间'); setTaskLoading(false); return; }
        nextRunAt = new Date(taskForm.onceAt).getTime();
      }
      const payload: any = {
        name: taskForm.name.trim(),
        workflowId: taskForm.workflowId,
        workflowName: wf.workflow.flowMeta.name || '工作流',
        triggerType: taskForm.triggerType,
        enabled: taskForm.enabled,
        intervalMs: taskForm.triggerType === 'interval' ? taskForm.intervalMin * 60_000 : undefined,
        cronExpression: taskForm.triggerType === 'cron' ? taskForm.cronExpression : undefined,
        nextRunAt,
      };
      if (editingTask) {
        await invoke('scheduled-tasks:update', editingTask.id, payload);
      } else {
        await invoke('scheduled-tasks:add', payload);
      }
      setTaskDialogOpen(false);
      setEditingTask(null);
      setTimeout(loadTasks, 100);
    } catch (e) {
      alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTaskLoading(false);
    }
  };

  const deleteTask = async (id: string) => {
    if (!confirm('确定要删除该定时任务吗？')) return;
    try {
      await invoke('scheduled-tasks:delete', id);
      loadTasks();
    } catch (e) {
      alert('删除失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const runTaskNow = async (id: string) => {
    try {
      await invoke('scheduled-tasks:run-now', id);
      alert('已加入执行队列');
      loadTasks();
    } catch (e) {
      alert('执行失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const toggleTaskEnabled = async (task: ScheduledTask) => {
    try {
      await invoke('scheduled-tasks:update', task.id, { enabled: !task.enabled });
      loadTasks();
    } catch (e) {
      alert('操作失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  function triggerLabel(t: ScheduledTask) {
    if (t.triggerType === 'once') return '单次执行';
    if (t.triggerType === 'interval') {
      const mins = Math.round((t.intervalMs || 0) / 60000);
      return `每 ${mins} 分钟`;
    }
    return `Cron: ${t.cronExpression || ''}`;
  }

  useEffect(() => {
    (async () => {
      try {
        await loadFromStorage?.();
      } catch {}
      loadStats();
      loadTasks();
    })();

    let pollTimer: NodeJS.Timeout | null = null;
    pollTimer = setInterval(() => {
      loadTasks();
    }, 5000);
    
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
        setTimeout(loadTasks, 800);
      }
    });

    return () => {
      unsubscribe?.();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
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
              <CalendarClock className="w-5 h-5 text-amber-500" />
              定时任务
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <span>支持单次/间隔/Cron 方式调度，由于鼠标键盘硬件限制，任务执行时按顺序排队运行</span>
              {taskState.queueSize > 0 && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 text-[11px] ml-2">
                  队列中 {taskState.queueSize}
                </Badge>
              )}
              {taskState.running && (
                <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 text-[11px]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
                  运行中
                </Badge>
              )}
            </CardDescription>
          </div>
          <Button size="sm" onClick={openNewTask} className="gap-1">
            <Plus className="w-4 h-4" /> 新建任务
          </Button>
        </CardHeader>
        <CardContent>
          {taskState.tasks.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm flex flex-col items-center gap-3">
              <Calendar className="w-12 h-12 opacity-20" />
              <div>
                <p>暂无定时任务</p>
                <p className="text-xs mt-1 opacity-80">点击右上角「新建任务」，让工作流按计划自动执行</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {taskState.tasks.map((t) => {
                const nextIn = t.nextRunAt - Date.now();
                const isRunning = !!runningExecution && (
                  (runningExecution.workflowId && runningExecution.workflowId === t.workflowId) ||
                  (runningExecution.workflowName && runningExecution.workflowName === t.workflowName)
                );
                const isDoneOnce = !isRunning && t.triggerType === 'once' && t.enabled === false && !!t.lastRunAt;
                const isPaused = !isRunning && !isDoneOnce && !t.enabled;
                const isActive = !isRunning && !isDoneOnce && t.enabled;
                const statusText = isDoneOnce
                  ? '已完成'
                  : isPaused
                  ? '已暂停'
                  : nextIn <= 0
                  ? '即将运行'
                  : nextIn < 60_000
                  ? `${Math.max(1, Math.round(nextIn / 1000))} 秒后`
                  : nextIn < 3_600_000
                  ? `${Math.round(nextIn / 60_000)} 分钟后`
                  : nextIn < 86_400_000
                  ? `${(nextIn / 3_600_000).toFixed(1)} 小时后`
                  : `${(nextIn / 86_400_000).toFixed(1)} 天后`;
                const nextInText = isRunning
                  ? `运行中 · ${formatDuration(Date.now() - (runningExecution?.startTime || Date.now()))}`
                  : isDoneOnce
                  ? '已完成'
                  : isPaused
                  ? '已暂停'
                  : statusText;
                const cardCls = cn(
                  'w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all group border',
                  isRunning && [
                    'bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50',
                    'border-emerald-300',
                    'shadow-[0_0_0_3px_rgba(16,185,129,0.10),0_10px_30px_-5px_rgba(16,185,129,0.20)]',
                    'hover:shadow-[0_0_0_3px_rgba(16,185,129,0.18),0_14px_36px_-6px_rgba(16,185,129,0.28)]'
                  ],
                  !isRunning && isDoneOnce && 'bg-sky-50/60 border-sky-200/70 hover:bg-sky-50',
                  !isRunning && isPaused && 'bg-gray-50 border-gray-200 hover:bg-gray-100',
                  !isRunning && isActive && 'bg-white border-amber-200/60 hover:border-amber-300 hover:shadow-[0_6px_20px_rgba(251,191,36,0.12)]'
                );
                const iconBoxCls = cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                  isRunning && 'bg-gradient-to-br from-emerald-500 to-teal-500 animate-pulse',
                  !isRunning && isDoneOnce && 'bg-gradient-to-br from-sky-400 to-blue-500',
                  !isRunning && isPaused && 'bg-gray-200',
                  !isRunning && isActive && 'bg-gradient-to-br from-amber-400 to-orange-400'
                );
                const iconTextCls = cn(
                  'w-4 h-4 shrink-0',
                  isRunning && 'text-white',
                  !isRunning && isDoneOnce && 'text-white',
                  !isRunning && isPaused && 'text-gray-500',
                  !isRunning && isActive && 'text-white'
                );
                const titleTextCls = cn(
                  'font-semibold truncate',
                  isRunning && 'text-emerald-900',
                  !isRunning && isDoneOnce && 'text-sky-900',
                  !isRunning && isPaused && 'text-gray-500 line-clamp-1',
                  !isRunning && isActive && 'text-slate-800'
                );
                return (
                  <div key={t.id} className={cardCls}>
                    <button className="flex items-center gap-3 min-w-0 flex-1 text-left">
                      <div className={iconBoxCls}>
                        {isRunning ? (
                          <Activity className={iconTextCls} />
                        ) : isDoneOnce ? (
                          <CheckCircle2 className={iconTextCls} />
                        ) : isPaused ? (
                          <Pause className={iconTextCls} />
                        ) : (
                          <Clock className={iconTextCls} />
                        )}
                      </div>
                      <div className="text-left min-w-0">
                        <p className={titleTextCls}>{t.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {triggerLabel(t)} · 工作流：{t.workflowName}
                        </p>
                        <p className={cn(
                          'text-[11px] mt-0.5 font-medium',
                          isRunning && 'text-emerald-700',
                          !isRunning && isDoneOnce && 'text-sky-700',
                          !isRunning && isPaused && 'text-gray-500',
                          !isRunning && isActive && 'text-amber-700'
                        )}>
                          {isRunning
                            ? `正在执行 · 已运行 ${formatDuration(Date.now() - (runningExecution?.startTime || Date.now()))}`
                            : `下次运行：${new Date(t.nextRunAt).toLocaleString()}（${nextInText}）`
                          }
                          {!isRunning && t.lastRunAt && ` · 上次：${new Date(t.lastRunAt).toLocaleString()}`}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className={cn(
                        'text-[11px] font-medium',
                        isRunning && 'border-emerald-400 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 animate-pulse',
                        !isRunning && isDoneOnce && 'border-sky-300 bg-sky-100/80 text-sky-700',
                        !isRunning && isPaused && 'border-gray-300 bg-gray-100 text-gray-600',
                        !isRunning && isActive && 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      )}>
                        {isRunning ? '执行中' : isDoneOnce ? '已完成' : isPaused ? '已暂停' : '启用中'}
                      </Badge>
                      <Button variant="ghost" size="icon" className={cn(
                        'w-8 h-8',
                        isRunning
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-emerald-100/60'
                      )}
                        onClick={() => !isRunning && runTaskNow(t.id)}
                        title={isRunning ? '执行中' : '立即运行（加入执行队列）'}>
                        <Play className={cn(
                          'w-4 h-4',
                          isRunning ? 'text-gray-400' : 'text-emerald-600'
                        )} />
                      </Button>
                      <Button variant="ghost" size="icon" className={cn(
                        'w-8 h-8',
                        isRunning
                          ? 'cursor-not-allowed opacity-50 text-gray-400'
                          : isActive
                          ? 'hover:bg-amber-100/70 text-amber-700'
                          : 'hover:bg-violet-100/70 text-violet-700'
                      )}
                        onClick={() => !isRunning && toggleTaskEnabled(t)}
                        title={isRunning ? '执行中' : isActive ? '暂停' : '启用'}>
                        {isRunning ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isActive ? (
                          <Pause className="w-4 h-4 fill-current" />
                        ) : (
                          <Play className="w-4 h-4 fill-current" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" className={cn(
                        'w-8 h-8 transition-opacity',
                        isRunning
                          ? 'opacity-0 pointer-events-none'
                          : 'opacity-0 group-hover:opacity-100 hover:bg-violet-100/70'
                      )}
                        onClick={() => openEditTask(t)}
                        title="编辑">
                        <Pencil className="w-3.5 h-3.5 text-violet-600" />
                      </Button>
                      <Button variant="ghost" size="icon" className={cn(
                        'w-8 h-8 transition-opacity',
                        isRunning
                          ? 'opacity-0 pointer-events-none'
                          : 'opacity-0 group-hover:opacity-100 hover:bg-rose-100/70'
                      )}
                        onClick={() => deleteTask(t.id)}
                        title="删除">
                        <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {taskDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-amber-500" />
                {editingTask ? '编辑定时任务' : '新建定时任务'}
              </h3>
              <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setTaskDialogOpen(false)}>
                <XCircle className="w-4 h-4 text-gray-500" />
              </Button>
            </div>
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <Label className="text-sm">任务名称</Label>
                <Input value={taskForm.name} onChange={(e) => setTaskForm({ ...taskForm, name: e.target.value })} placeholder="例如：每日数据备份" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">工作流（可输入搜索）</Label>
                <div className="relative">
                  <Input
                    value={wfSearch}
                    onChange={(e) => onWfSearchChange(e.target.value)}
                    placeholder="输入工作流名搜索，例如：数据备份..."
                    list="wf-datalist"
                    autoComplete="off"
                  />
                  <datalist id="wf-datalist">
                    {workflows.length === 0 && (
                      <option value="">暂无工作流，请先创建工作流</option>
                    )}
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.workflow?.flowMeta?.name || wf.id}>
                        {wf.id}
                      </option>
                    ))}
                  </datalist>
                  {taskForm.workflowId ? (
                    <div className="mt-1.5 text-[11px] text-emerald-700 flex items-center gap-1 pl-1">
                      <CheckCircle2 className="w-3 h-3" />
                      已匹配：{taskForm.workflowName || taskForm.workflowId}
                    </div>
                  ) : wfSearch ? (
                    <div className="mt-1.5 text-[11px] text-amber-700 flex items-center gap-1 pl-1">
                      <AlertCircle className="w-3 h-3" />
                      未匹配到工作流，请从列表选择或输入正确名称
                    </div>
                  ) : (
                    <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1 pl-1">
                      共 {workflows.length} 个工作流可供选择
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm">触发方式</Label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'once', label: '单次执行' },
                    { key: 'interval', label: '固定间隔' },
                    { key: 'cron', label: 'Cron 表达式' },
                  ] as const).map((op) => (
                    <button
                      key={op.key}
                      type="button"
                      onClick={() => setTaskForm({ ...taskForm, triggerType: op.key })}
                      className={cn(
                        'px-3 py-2 rounded-lg border text-sm transition-all',
                        taskForm.triggerType === op.key
                          ? 'bg-violet-50 border-violet-300 text-violet-700 shadow-soft'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      )}
                    >
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>
              {taskForm.triggerType === 'once' && (
                <div className="space-y-1.5">
                  <Label className="text-sm">执行时间</Label>
                  <Input
                    type="datetime-local"
                    value={taskForm.onceAt}
                    onChange={(e) => setTaskForm({ ...taskForm, onceAt: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 到时将自动执行工作流
                  </p>
                </div>
              )}
              {taskForm.triggerType === 'interval' && (
                <div className="space-y-1.5">
                  <Label className="text-sm">执行间隔（分钟）</Label>
                  <Input
                    type="number"
                    min={1}
                    value={taskForm.intervalMin}
                    onChange={(e) => setTaskForm({ ...taskForm, intervalMin: Math.max(1, parseInt(e.target.value || '1')) })}
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 每 {taskForm.intervalMin} 分钟自动执行一次
                  </p>
                </div>
              )}
              {taskForm.triggerType === 'cron' && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Cron 表达式（分 时 日 月 周）</Label>
                  <Input
                    value={taskForm.cronExpression}
                    onChange={(e) => setTaskForm({ ...taskForm, cronExpression: e.target.value })}
                    placeholder="0 9 * * *"
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> 例如：0 9 * * * = 每天 9:00 执行；*/30 * * * * = 每 30 分钟
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50/60">
              <Button variant="outline" onClick={() => setTaskDialogOpen(false)} disabled={taskLoading}>取消</Button>
              <Button onClick={saveTask} disabled={taskLoading}>
                {taskLoading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

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
