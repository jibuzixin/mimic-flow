import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, Play, Copy, Download, Trash2, Edit2, FileJson, Upload, Eye } from 'lucide-react';
import { useWorkflowStore, type WorkflowRecord } from '../stores/workflowStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

const gradients = [
  'from-violet-400 to-fuchsia-400',
  'from-sky-400 to-cyan-400',
  'from-amber-400 to-orange-400',
  'from-emerald-400 to-teal-400',
  'from-rose-400 to-pink-400',
  'from-indigo-400 to-blue-400',
];

export default function WorkflowList() {
  const navigate = useNavigate();
  const {
    workflows,
    createWorkflow,
    loadWorkflowToCanvas,
    deleteWorkflow,
    duplicateWorkflow,
    renameWorkflow,
    exportWorkflow,
    importWorkflow,
    hasUnsavedChanges,
    saveCurrentWorkflow,
  } = useWorkflowStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [showExportDialog, setShowExportDialog] = useState<string | null>(null);
  const [hideSensitive, setHideSensitive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = workflows.filter((w) =>
    w.workflow.flowMeta.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const checkUnsavedAndProceed = (callback: () => void) => {
    if (hasUnsavedChanges()) {
      const confirmed = confirm(
        '当前画布有未保存的修改，继续操作将会丢失这些修改。\n\n是否继续？\n\n（点击"取消"返回保存，点击"确定"继续并丢弃修改）'
      );
      if (!confirmed) return false;
    }
    callback();
    return true;
  };

  const handleOpen = (wf: WorkflowRecord) => {
    const proceed = checkUnsavedAndProceed(() => {
      loadWorkflowToCanvas(wf.id);
      navigate('/workflows/editor');
    });
    if (!proceed) {
      setActiveMenu(null);
    }
  };

  const handleCreate = () => {
    const proceed = checkUnsavedAndProceed(() => {
      const id = createWorkflow('新建工作流');
      loadWorkflowToCanvas(id);
      navigate('/workflows/editor');
    });
    if (!proceed) {
      setActiveMenu(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个工作流吗？此操作不可撤销。')) {
      deleteWorkflow(id);
    }
    setActiveMenu(null);
  };

  const handleDuplicate = (id: string) => {
    duplicateWorkflow(id);
    setActiveMenu(null);
  };

  const handleRename = (id: string, currentName: string) => {
    const newName = prompt('请输入新的工作流名称：', currentName);
    if (newName && newName.trim()) {
      renameWorkflow(id, newName.trim());
    }
    setActiveMenu(null);
  };

  const handleExport = (id: string) => {
    setShowExportDialog(id);
    setActiveMenu(null);
  };

  const confirmExport = () => {
    if (!showExportDialog) return;
    
    const wf = exportWorkflow(showExportDialog, hideSensitive);
    const blob = new Blob([JSON.stringify(wf, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wf.flowMeta.name || 'workflow'}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportDialog(null);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        importWorkflow(data);
      } catch (err) {
        alert('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">工作流库</h1>
          <p className="text-sm text-gray-500 mt-1">管理你的所有自动化工作流</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.flow.json"
            onChange={handleImport}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            导入
          </Button>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            新建工作流
          </Button>
        </div>
      </div>

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="搜索工作流..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center">
              <FileJson className="h-10 w-10 text-violet-500" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {searchTerm ? '没有找到匹配的工作流' : '还没有工作流'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {searchTerm ? '试试其他关键词' : '创建你的第一个自动化工作流吧'}
            </p>
            {!searchTerm && (
              <Button onClick={handleCreate} className="gap-2">
                <Plus className="h-4 w-4" />
                新建工作流
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pr-2 py-2">
          {filtered.map((wf, idx) => (
            <div
              key={wf.id}
              className="group bg-white rounded-2xl border border-gray-200/70 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative"
            >
              <div
                className="cursor-pointer"
                onClick={() => handleOpen(wf)}
              >
                <div
                  className={`h-28 bg-gradient-to-br ${gradients[idx % gradients.length]} relative overflow-hidden rounded-t-2xl`}
                >
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <Play className="h-10 w-10 text-white/0 group-hover:text-white/90 transition-all scale-75 group-hover:scale-100" />
                  </div>
                  <div className="absolute bottom-3 left-4 right-4">
                    <div className="text-white font-semibold text-sm truncate drop-shadow">
                      {wf.workflow.flowMeta.name}
                    </div>
                  </div>
                </div>

                <div className="p-4 pb-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">
                      {wf.workflow.nodes.length} 个节点
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDate(wf.updatedAt)}
                    </span>
                  </div>
                  {wf.workflow.flowMeta.desc && (
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {wf.workflow.flowMeta.desc}
                    </p>
                  )}
                </div>
              </div>

              <div className="p-4 pt-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpen(wf);
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpen(wf);
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    运行
                  </Button>
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeMenu === wf.id) {
                          setActiveMenu(null);
                          setMenuPosition(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPosition({
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          });
                          setActiveMenu(wf.id);
                        }
                      }}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeMenu && menuPosition && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setActiveMenu(null);
              setMenuPosition(null);
            }}
          />
          <div
            className="fixed w-36 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 py-1"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
            }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                const wf = workflows.find(w => w.id === activeMenu);
                if (wf) handleRename(wf.id, wf.workflow.flowMeta.name);
                setActiveMenu(null);
                setMenuPosition(null);
              }}
            >
              <Edit2 className="h-3.5 w-3.5" />
              重命名
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicate(activeMenu);
                setActiveMenu(null);
                setMenuPosition(null);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
              onClick={(e) => {
                e.stopPropagation();
                handleExport(activeMenu);
                setActiveMenu(null);
                setMenuPosition(null);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(activeMenu);
                setActiveMenu(null);
                setMenuPosition(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </button>
          </div>
        </>
      )}

      {showExportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowExportDialog(null)}
          />
          <div className="relative w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">导出工作流</h3>
              <p className="text-sm text-gray-500 mt-1">
                将工作流导出为 JSON 文件，可用于分享或备份
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <input
                  type="checkbox"
                  id="hideSensitive"
                  checked={hideSensitive}
                  onChange={(e) => setHideSensitive(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded text-violet-600 focus:ring-violet-500"
                />
                <div>
                  <label htmlFor="hideSensitive" className="text-sm font-medium text-gray-700 cursor-pointer">
                    隐藏敏感信息
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    自动隐藏密码、API Key、Token 等敏感字段（替换为 ******）
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowExportDialog(null)}
              >
                取消
              </Button>
              <Button onClick={confirmExport}>
                <Download className="h-4 w-4 mr-1.5" />
                导出
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
