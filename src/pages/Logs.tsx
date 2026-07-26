import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  List,
  FileText,
  Clock,
  Trash2,
  ExternalLink,
  ChevronRight,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  StopCircle,
  PlayCircle,
} from 'lucide-react';
import { invoke } from '../lib/api';
import { cn } from '../lib/utils';

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

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: 'scheduler' | 'engine' | 'node' | 'variable';
  message: string;
  nodeId?: string;
  nodeName?: string;
  data?: Record<string, unknown>;
}

interface ExecutionDetail extends ExecutionRecord {
  logs: LogEntry[];
  midsceneReportPath?: string;
  midsceneReportUrl?: string;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(0);
  return `${min}m ${s}s`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getStatusIcon(status: ExecutionRecord['status']) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-rose-500" />;
    case 'stopped':
      return <StopCircle className="w-4 h-4 text-amber-500" />;
    case 'running':
      return <PlayCircle className="w-4 h-4 text-sky-500 animate-pulse" />;
  }
}

function getStatusLabel(status: ExecutionRecord['status']) {
  switch (status) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'stopped':
      return '已停止';
    case 'running':
      return '运行中';
  }
}

function groupByDate(items: ExecutionRecord[]) {
  const groups: Record<string, ExecutionRecord[]> = {};
  for (const item of items) {
    const date = new Date(item.startTime).toLocaleDateString('zh-CN');
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  }
  return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
}

export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<ExecutionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const loadRecords = async () => {
    setLoading(true);
    const res = await invoke<any>('execution:list', { page: 1, pageSize: 50 });
    if (res.success && res.data) {
      setRecords(res.data.items || []);
      if (!selectedId && res.data.items?.length > 0) {
        setSelectedId(res.data.items[0].id);
      }
    }
    setLoading(false);
  };

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    const res = await invoke<any>('execution:get', id);
    if (res.success && res.data) {
      setDetail(res.data);
    }
    setDetailLoading(false);
  };

  useEffect(() => {
    loadRecords();
  }, []);

  useEffect(() => {
    if (selectedId) {
      setSearchParams({ id: selectedId }, { replace: true });
      loadDetail(selectedId);
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [selectedId]);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return r.workflowName.toLowerCase().includes(q);
      }
      return true;
    });
  }, [records, search, filterStatus]);

  const groupedRecords = useMemo(() => groupByDate(filteredRecords), [filteredRecords]);

  const nodeLevelLogs = useMemo(() => {
    if (!detail?.logs) return [];
    
    const filtered = detail.logs.filter((log) => {
      const msg = log.message;
      return (
        msg.includes('开始执行节点') ||
        msg.includes('节点执行完成') ||
        msg.includes('节点执行失败') ||
        msg.includes('📤') ||
        msg.includes('📢') ||
        msg.includes('🔄') ||
        msg.includes('▶️') ||
        msg.includes('✓') ||
        msg.includes('❌') ||
        msg.includes('⏱️') ||
        msg.includes('工作流')
      );
    });
    
    const seen = new Set<string>();
    return filtered.filter((log) => {
      const msg = log.message;
      const nodeId = (log as any).nodeId || '';
      
      if (msg.includes('开始执行节点')) {
        const key = `start-${nodeId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
      if (msg.includes('节点执行完成')) {
        const key = `end-${nodeId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
      return true;
    });
  }, [detail?.logs]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条执行记录吗？')) return;
    await invoke<any>('execution:delete', id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
    }
  };

  const handleOpenReport = () => {
    if (selectedId) {
      invoke<any>('execution:openReport', selectedId);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <List className="w-6 h-6 text-violet-500" />
            执行日志
          </h1>
          <p className="text-sm text-muted-foreground">查看工作流的执行记录和详细日志</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索工作流名称..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-3 text-sm border rounded-lg w-48 bg-white/60 focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 px-3 text-sm border rounded-lg bg-white/60 focus:outline-none focus:ring-2 focus:ring-violet-200"
          >
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="stopped">已停止</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadRecords}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新
          </Button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* 左侧：执行记录列表 */}
        <Card className="w-72 shrink-0 border-0 shadow-soft bg-white/70 backdrop-blur-sm flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" />
              执行记录
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-4">
            {loading ? (
              <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">暂无执行记录</div>
            ) : (
              groupedRecords.map(([date, items]) => (
                <div key={date}>
                  <div className="text-xs font-medium text-muted-foreground mb-2 px-1">{date}</div>
                  <div className="space-y-2">
                    {items.map((record) => (
                      <button
                        key={record.id}
                        onClick={() => setSelectedId(record.id)}
                        className={cn(
                          'w-full text-left rounded-xl border p-3 transition-all hover:shadow-soft group',
                          selectedId === record.id
                            ? 'bg-violet-50 border-violet-200 ring-1 ring-violet-200'
                            : 'bg-white/50 border-transparent hover:bg-white/80'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {getStatusIcon(record.status)}
                            <span className="text-sm font-medium truncate">{record.workflowName}</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(record.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-rose-100 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(record.duration)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] h-5 px-1.5',
                              record.status === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                              record.status === 'failed' && 'border-rose-200 bg-rose-50 text-rose-700',
                              record.status === 'stopped' && 'border-amber-200 bg-amber-50 text-amber-700'
                            )}
                          >
                            {getStatusLabel(record.status)}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground/70 mt-1">
                          {new Date(record.startTime).toLocaleTimeString('zh-CN', { hour12: false })}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 右侧：详情 */}
        <Card className="flex-1 border-0 shadow-soft bg-white/70 backdrop-blur-sm flex flex-col min-w-0">
          {detail ? (
            <>
              <CardHeader className="pb-3 border-b border-border/30">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(detail.status)}
                      <h2 className="text-lg font-semibold">{detail.workflowName}</h2>
                      <Badge
                        variant="outline"
                        className={cn(
                          detail.status === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                          detail.status === 'failed' && 'border-rose-200 bg-rose-50 text-rose-700',
                          detail.status === 'stopped' && 'border-amber-200 bg-amber-50 text-amber-700'
                        )}
                      >
                        {getStatusLabel(detail.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>开始：{formatTime(detail.startTime)}</span>
                      <span>耗时：{formatDuration(detail.duration)}</span>
                      <span>
                        节点：{detail.nodeSuccess}/{detail.nodeTotal}
                        {detail.nodeFailed > 0 && <span className="text-rose-500"> ({detail.nodeFailed}失败)</span>}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {detail.hasMidsceneReport && (
                      <Button variant="outline" size="sm" onClick={handleOpenReport}>
                        <ExternalLink className="w-4 h-4 mr-1.5" />
                        查看报告
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 overflow-hidden p-0">
                <div className="h-full overflow-y-auto p-4">
                    {nodeLevelLogs.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                        暂无日志
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {nodeLevelLogs.map((log, idx) => {
                          const isNodeStart = log.message.includes('开始执行节点');
                          const isNodeEnd =
                            log.message.includes('节点执行完成') || log.message.includes('节点执行失败');
                          const isVariable = log.message.includes('📤') || log.message.includes('📢');
                          const isWorkflowStart = log.message.includes('▶️') || log.message.includes('工作流开始');
                          const isWorkflowEnd = log.message.includes('🏁') || log.message.includes('工作流结束') || log.message.includes('工作流执行成功') || log.message.includes('工作流执行失败');
                          const isSleep = log.message.includes('⏱️');
                          
                          const showData = log.data && Object.keys(log.data as any).length > 0 && !isNodeEnd;
                          
                          let displayMessage = log.message;
                          const data = log.data as any;
                          if (isNodeEnd && data?.duration !== undefined && data?.duration !== null) {
                            const dur = Number(data.duration);
                            const durStr = dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`;
                            displayMessage = log.message.replace('节点执行完成', '节点完成').replace('节点执行失败', '节点失败');
                            displayMessage += ` (${durStr})`;
                          }
                          if (isNodeStart) {
                            displayMessage = log.message.replace('开始执行节点', '▶ 开始');
                          }
                          if (isWorkflowStart && log.message.includes('工作流开始执行')) {
                            displayMessage = '▶️ 工作流开始执行';
                          }
                          if (log.message === '工作流执行成功') {
                            displayMessage = '✅ 工作流执行成功';
                          }

                          return (
                            <div
                              key={idx}
                              className={cn(
                                'text-sm rounded-lg border p-2.5',
                                log.level === 'error' && 'bg-rose-50 border-rose-100 text-rose-800',
                                log.level === 'warn' && 'bg-amber-50 border-amber-100 text-amber-800',
                                log.level === 'info' && !isNodeStart && !isNodeEnd && !isVariable && !isWorkflowStart && !isWorkflowEnd && !isSleep && 'bg-slate-50 border-slate-100 text-slate-700',
                                isNodeStart && 'bg-sky-50 border-sky-100 text-sky-800',
                                isNodeEnd && log.level === 'info' && 'bg-emerald-50 border-emerald-100 text-emerald-800',
                                isVariable && 'bg-violet-50/50 border-violet-100 text-violet-800',
                                isWorkflowStart && 'bg-indigo-50 border-indigo-100 text-indigo-800',
                                isWorkflowEnd && 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium',
                                isSleep && 'bg-amber-50 border-amber-100 text-amber-800'
                              )}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] opacity-60 font-mono">
                                  {new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                                </span>
                                {(log as any).nodeName && (
                                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                                    {(log as any).nodeName}
                                  </Badge>
                                )}
                              </div>
                              <div className="font-medium text-sm">{displayMessage}</div>
                              {showData && (
                                <pre className="mt-1.5 p-2 rounded bg-white/60 text-xs overflow-x-auto">
                                  {JSON.stringify(log.data, null, 2)}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
              </CardContent>
            </>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">加载中...</div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <ChevronRight className="w-12 h-12 opacity-20 mb-2" />
              <p className="text-sm">选择左侧记录查看详情</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
