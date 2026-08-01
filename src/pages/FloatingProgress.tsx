import { useState, useEffect } from 'react';
import {
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  Minimize2,
  X,
  Square,
  History,
} from 'lucide-react';

export default function FloatingProgress() {
  const [workflowName, setWorkflowName] = useState('');
  const [currentNode, setCurrentNode] = useState('');
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsed, setElapsed] = useState(0);
  /** 去重后的总节点数（进度条分母） */
  const [totalNodes, setTotalNodes] = useState(0);
  /** 去重后的已完成节点数（进度条分子），不会因循环越界 */
  const [uniqueCompletedNodes, setUniqueCompletedNodes] = useState(0);
  /** 累计执行次数（含循环重复执行），仅展示「已经跑了多少步」 */
  const [totalInvocations, setTotalInvocations] = useState(0);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed' | 'stopped'>(
    'idle'
  );
  const [runningNodes, setRunningNodes] = useState<string[]>([]);
  const [currentEngine, setCurrentEngine] = useState('');
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalHtmlHeight = document.documentElement.style.height;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyMargin = document.body.style.margin;
    const originalBodyBg = document.body.style.background;
    const originalBodyHeight = document.body.style.height;
    const root = document.getElementById('root');
    const originalRootHeight = root?.style.height;

    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.background = 'transparent';
    document.body.style.height = '100%';
    if (root) {
      root.style.height = '100%';
    }

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.documentElement.style.height = originalHtmlHeight;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.margin = originalBodyMargin;
      document.body.style.background = originalBodyBg;
      document.body.style.height = originalBodyHeight;
      if (root && originalRootHeight !== undefined) {
        root.style.height = originalRootHeight;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchState = async () => {
      try {
        const state = await window.mimic.invoke('floating:get-state');
        if (!mounted || !state) return;
        const s = state as any;
        if (s.status && s.status !== 'idle') {
          setWorkflowName(s.workflowName || '');
          setCurrentNode(s.currentNode || '');
          setStartTime(s.startTime || Date.now());
          setTotalNodes(s.totalNodes || 0);
          setUniqueCompletedNodes(s.uniqueCompletedNodes ?? s.completedNodes ?? 0);
          setTotalInvocations(s.totalInvocations ?? s.completedNodes ?? 0);
          setLastDuration(s.lastDuration || null);
          setStatus(s.status);
          setRunningNodes(s.runningNodes || []);
          setCurrentEngine(s.currentEngine || '');
        }
      } catch (e) {
        console.warn('Failed to get floating state:', e);
      }
    };

    fetchState();

    const offFlowStart = window.mimic.on('floating:flow-start', (data: any) => {
      if (!mounted) return;
      setWorkflowName(data.workflowName || '工作流');
      setStartTime(data.startTime || Date.now());
      setTotalNodes(data.totalNodes || 0);
      setUniqueCompletedNodes(0);
      setTotalInvocations(0);
      setCurrentNode('准备中...');
      setStatus('running');
      setLastDuration(data.lastDuration || null);
      setRunningNodes([]);
      setCurrentEngine('');
      setCarouselIndex(0);
    });

    const offNodeStart = window.mimic.on('floating:node-start', (data: any) => {
      if (!mounted) return;
      setCurrentNode(data.nodeName || data.nodeType || '');
      if (data.runningNodes) {
        setRunningNodes(data.runningNodes);
      }
      if (data.currentEngine) {
        setCurrentEngine(data.currentEngine);
      }
    });

    const offNodeComplete = window.mimic.on('floating:node-complete', (data: any) => {
      if (!mounted) return;
      if (data.uniqueCompletedNodes !== undefined) {
        setUniqueCompletedNodes(data.uniqueCompletedNodes);
      }
      if (data.totalInvocations !== undefined) {
        setTotalInvocations(data.totalInvocations);
      } else if (data.completedNodes !== undefined) {
        setTotalInvocations(data.completedNodes);
        setUniqueCompletedNodes((prev) => Math.max(prev, Math.min(data.completedNodes, totalNodes)));
      } else {
        setTotalInvocations((prev) => prev + 1);
      }
      if (data.totalNodes) setTotalNodes(data.totalNodes);
      if (data.runningNodes) {
        setRunningNodes(data.runningNodes);
      }
    });

    const offNodeError = window.mimic.on('floating:node-error', (data: any) => {
      if (!mounted) return;
      if (data.uniqueCompletedNodes !== undefined) {
        setUniqueCompletedNodes(data.uniqueCompletedNodes);
      }
      if (data.totalInvocations !== undefined) {
        setTotalInvocations(data.totalInvocations);
      } else if (data.completedNodes !== undefined) {
        setTotalInvocations(data.completedNodes);
        setUniqueCompletedNodes((prev) => Math.max(prev, Math.min(data.completedNodes, totalNodes)));
      } else {
        setTotalInvocations((prev) => prev + 1);
      }
      if (data.totalNodes) setTotalNodes(data.totalNodes);
      if (data.runningNodes) {
        setRunningNodes(data.runningNodes);
      }
    });

    const offFlowComplete = window.mimic.on('floating:flow-complete', (data: any) => {
      if (!mounted) return;
      // flow 完成时直接拉到 100%
      const finalTotal = data.totalNodes ?? totalNodes;
      if (finalTotal) {
        setTotalNodes(finalTotal);
        setUniqueCompletedNodes(finalTotal);
      }
      if (data.totalInvocations !== undefined) setTotalInvocations(data.totalInvocations);
      if (data.status === 'success') {
        setStatus('success');
        setCurrentNode('执行完成');
      } else if (data.status === 'stopped') {
        setStatus('stopped');
        setCurrentNode('已停止');
      } else {
        setStatus('failed');
        setCurrentNode('执行失败');
      }
    });

    return () => {
      mounted = false;
      offFlowStart();
      offNodeStart();
      offNodeComplete();
      offNodeError();
      offFlowComplete();
    };
  }, []);

  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(timer);
  }, [startTime, status]);

  useEffect(() => {
    if (status !== 'running' || runningNodes.length <= 1) {
      setCarouselIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % runningNodes.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [runningNodes, status]);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes > 0) {
      return `${minutes}分${secs}秒`;
    }
    return `${(ms / 1000).toFixed(1)}秒`;
  };

  // 进度计算：
  //   - 进度条（百分比）= 去重后的唯一节点进度，不会因为循环 node-3 跑了 3 次就从 3/9 → 6/9 越界；
  //   - running 中上限 99.9%，到 flow-complete 再强制拉到 100%，视觉更自然。
  const isFinished = status === 'success' || status === 'failed' || status === 'stopped';
  const progressPct = totalNodes > 0 ? (uniqueCompletedNodes / totalNodes) * 100 : 0;
  const progress = Math.round(
    isFinished ? Math.max(0, Math.min(100, progressPct)) : Math.min(99.9, progressPct)
  );

  const handleRestore = () => {
    window.mimic.invoke('window:restore-main');
  };

  const handleClose = () => {
    window.mimic.invoke('window:close-floating');
  };

  const handleStop = () => {
    if (status === 'running' && confirm('确定要停止当前工作流吗？')) {
      window.mimic.invoke('flow-v2:stop');
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'text-violet-500';
      case 'success':
        return 'text-emerald-500';
      case 'failed':
        return 'text-rose-500';
      case 'stopped':
        return 'text-amber-500';
      default:
        return 'text-gray-400';
    }
  };

  const getProgressColor = () => {
    switch (status) {
      case 'failed':
        return 'bg-rose-400';
      case 'stopped':
        return 'bg-amber-400';
      case 'success':
        return 'bg-emerald-400';
      default:
        return 'bg-violet-500';
    }
  };

  if (status === 'idle') {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-gray-400 text-sm bg-transparent">
        等待执行...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-transparent flex items-stretch">
      <div className="flex-1 bg-white flex flex-col select-none rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
      {/* 顶部标题栏：可拖动区域 */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-sky-50 [-webkit-app-region:drag] shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Activity className={`w-4 h-4 shrink-0 ${status === 'running' ? 'animate-pulse text-violet-500' : getStatusColor()}`} />
          <span className="text-sm font-semibold text-gray-700 truncate">
            {workflowName}
          </span>
        </div>
        <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag] shrink-0">
          <button
            onClick={handleRestore}
            className="p-1.5 rounded-lg hover:bg-white/80 transition-colors group"
            title="展开主窗口"
          >
            <Minimize2 className="w-3.5 h-3.5 text-gray-400 group-hover:text-violet-500 transition-colors" />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors group"
            title="关闭"
          >
            <X className="w-3.5 h-3.5 text-gray-400 group-hover:text-red-500 transition-colors" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 px-3.5 py-2.5 space-y-2.5 overflow-hidden flex flex-col">
        {/* 当前节点 */}
        <div className="flex items-start gap-2.5">
          <div className={`mt-0.5 shrink-0 ${getStatusColor()}`}>
            {status === 'running' && (
              <Play className="w-4 h-4 fill-current" />
            )}
            {status === 'success' && (
              <CheckCircle className="w-4 h-4" />
            )}
            {status === 'failed' && (
              <XCircle className="w-4 h-4" />
            )}
            {status === 'stopped' && (
              <Square className="w-4 h-4 fill-current" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-gray-400 mb-0.5">
              {status === 'running' && runningNodes.length > 0
                ? `执行中 · ${runningNodes.length} 个任务${currentEngine ? ` · ${currentEngine}` : ''}`
                : '当前节点'}
            </div>
            <div className="relative h-5 overflow-hidden">
              {status === 'running' && runningNodes.length > 0 ? (
                <div
                  className="absolute w-full transition-transform duration-500 ease-in-out"
                  style={{ transform: `translateY(-${carouselIndex * 20}px)` }}
                >
                  {runningNodes.map((node, idx) => (
                    <div
                      key={idx}
                      className="h-5 flex items-center text-sm font-medium text-gray-800 truncate"
                    >
                      {node}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm font-medium text-gray-800 truncate">
                  {currentNode}
                </div>
              )}
            </div>
            {status === 'running' && runningNodes.length > 1 && (
              <div className="flex items-center justify-center gap-1 mt-1">
                {runningNodes.map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-1 h-1 rounded-full transition-colors ${
                      idx === carouselIndex ? 'bg-violet-500' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 进度条 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-gray-500">
            <span>执行进度</span>
            <span className="font-medium">
              {uniqueCompletedNodes}/{totalNodes} · {progress}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getProgressColor()}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {totalInvocations > uniqueCompletedNodes && (
            <div className="text-[10px] text-violet-500/90 text-right flex items-center justify-end gap-1">
              <History className="w-3 h-3" />
              <span>
                循环运行中 · 累计执行 {totalInvocations} 次
              </span>
            </div>
          )}
        </div>

        {/* 时间信息 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl p-2">
            <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
              <Clock className="w-3 h-3" />
              <span>已执行</span>
            </div>
            <div className="text-sm font-bold text-gray-700">
              {formatDuration(elapsed)}
            </div>
          </div>
          <div className="bg-gray-50 rounded-xl p-2">
            <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
              <History className="w-3 h-3" />
              <span>上次耗时</span>
            </div>
            <div className="text-sm font-bold text-gray-700">
              {lastDuration ? formatDuration(lastDuration) : '-'}
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mt-auto pt-0.5">
          {status === 'running' ? (
            <button
              onClick={handleStop}
              className="w-full py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-medium transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              停止执行
            </button>
          ) : (
            <button
              onClick={handleRestore}
              className="w-full py-2 px-3 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-600 text-sm font-medium transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              展开主窗口查看详情
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
