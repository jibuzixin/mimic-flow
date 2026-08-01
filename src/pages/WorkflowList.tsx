import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MoreVertical, Play, Copy, Download, Trash2, Edit2, FileJson, Upload, Eye, Check, X, ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square } from 'lucide-react';
import { useWorkflowStore, type WorkflowRecord } from '../stores/workflowStore';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type SortField = 'updatedAt' | 'createdAt' | 'name' | 'nodeCount';
type SortOrder = 'asc' | 'desc';

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
    updateWorkflowRecordMeta,
    exportWorkflow,
    importWorkflow,
    hasUnsavedChanges,
    saveCurrentWorkflow,
    loadFromStorage,
    setWorkflowGradient,
    setWorkflowBgImage,
  } = useWorkflowStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState<string | null>(null);
  const [hideSensitive, setHideSensitive] = useState(false);
  const [showGradientPicker, setShowGradientPicker] = useState(false);
  const [renameDialog, setRenameDialog] = useState<{ id: string; name: string; desc: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRect = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (activeMenu && menuRef.current && menuTriggerRect.current) {
      const menuEl = menuRef.current;
      const menuHeight = menuEl.offsetHeight;
      const triggerRect = menuTriggerRect.current;
      const spaceBelow = window.innerHeight - triggerRect.bottom - 4;
      
      let newTop = triggerRect.bottom + 4;
      if (spaceBelow < menuHeight && triggerRect.top - 4 > menuHeight) {
        newTop = triggerRect.top - menuHeight - 4;
      }
      
      setMenuPosition({
        top: newTop,
        right: window.innerWidth - triggerRect.right,
      });
      
      requestAnimationFrame(() => {
        setMenuVisible(true);
      });
    } else {
      setMenuVisible(false);
    }
  }, [activeMenu]);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const filtered = useMemo(() => {
    let list = workflows.filter((w) =>
      w.workflow.flowMeta.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    list = [...list].sort((a, b) => {
      let valA: string | number = 0;
      let valB: string | number = 0;

      switch (sortField) {
        case 'name':
          valA = a.workflow.flowMeta.name.toLowerCase();
          valB = b.workflow.flowMeta.name.toLowerCase();
          break;
        case 'createdAt':
          valA = a.createdAt;
          valB = b.createdAt;
          break;
        case 'nodeCount':
          valA = a.workflow.nodes.length;
          valB = b.workflow.nodes.length;
          break;
        case 'updatedAt':
        default:
          valA = a.updatedAt;
          valB = b.updatedAt;
          break;
      }

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

    return list;
  }, [workflows, searchTerm, sortField, sortOrder]);

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((w) => w.id)));
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`确定要删除选中的 ${selectedIds.size} 个工作流吗？此操作不可撤销。`)) {
      selectedIds.forEach((id) => deleteWorkflow(id));
      setSelectedIds(new Set());
      setSelectMode(false);
    }
  };

  const handleBatchExport = () => {
    if (selectedIds.size === 0) return;
    const exported = Array.from(selectedIds).map((id) => exportWorkflow(id, hideSensitive));
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflows-${selectedIds.size}-${Date.now()}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportDialog(null);
  };

  const handleBatchDuplicate = () => {
    selectedIds.forEach((id) => duplicateWorkflow(id));
    setSelectedIds(new Set());
    setSelectMode(false);
  };

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

  const handleRun = async (wf: WorkflowRecord) => {
    try {
      const flowSchema = exportWorkflow(wf.id);
      const runRes = await window.mimic?.invoke('flow-v2:run', flowSchema, { workflowId: wf.id });
      if (!(runRes as any)?.success) {
        alert('启动失败: ' + ((runRes as any)?.error || '未知错误'));
      }
    } catch (e) {
      alert('启动失败: ' + (e instanceof Error ? e.message : String(e)));
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

  const handleRename = (id: string, currentName: string, currentDesc = '') => {
    setRenameDialog({ id, name: currentName, desc: currentDesc });
    setActiveMenu(null);
    setMenuPosition(null);
  };

  const confirmRename = () => {
    if (renameDialog && renameDialog.name.trim()) {
      updateWorkflowRecordMeta(renameDialog.id, {
        name: renameDialog.name.trim(),
        desc: (renameDialog.desc || '').slice(0, 200),
      });
    }
    setRenameDialog(null);
  };

  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeMenu) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setWorkflowBgImage(activeMenu, dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleExport = (id: string) => {
    setShowExportDialog(id);
    setActiveMenu(null);
  };

  const confirmExport = () => {
    if (!showExportDialog) return;

    if (showExportDialog === 'batch') {
      handleBatchExport();
      return;
    }

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

      <div className="mb-6 flex items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="搜索工作流..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="relative">
          <Button
            variant="outline"
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="gap-2"
          >
            {sortOrder === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            {sortField === 'updatedAt' ? '更新时间' :
             sortField === 'createdAt' ? '创建时间' :
             sortField === 'name' ? '名称' : '节点数量'}
          </Button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-40 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-1">
                {[
                  { field: 'updatedAt', label: '更新时间' },
                  { field: 'createdAt', label: '创建时间' },
                  { field: 'name', label: '名称' },
                  { field: 'nodeCount', label: '节点数量' },
                ].map(({ field, label }) => (
                  <button
                    key={field}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gray-50 ${
                      sortField === field ? 'text-violet-600 font-medium' : 'text-gray-700'
                    }`}
                    onClick={() => {
                      if (sortField === field) {
                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortField(field as SortField);
                        setSortOrder('desc');
                      }
                      setShowSortMenu(false);
                    }}
                  >
                    {label}
                    {sortField === field && (
                      sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <Button
          variant={selectMode ? 'default' : 'outline'}
          onClick={() => {
            setSelectMode(!selectMode);
            setSelectedIds(new Set());
          }}
          className="gap-2"
        >
          {selectMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
          {selectMode ? '取消选择' : '多选'}
        </Button>
      </div>

      {selectMode && filtered.length > 0 && (
        <div className="mb-4 flex items-center justify-between px-4 py-3 bg-violet-50 rounded-xl border border-violet-100">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
            >
              {selectedIds.size === filtered.length && filtered.length > 0 ? (
                <CheckSquare className="h-4 w-4" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              <span className="font-medium">
                已选择 {selectedIds.size} / {filtered.length} 个
              </span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBatchDuplicate}
              disabled={selectedIds.size === 0}
              className="gap-1.5 text-xs"
            >
              <Copy className="h-3.5 w-3.5" />
              批量复制
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowExportDialog('batch')}
              disabled={selectedIds.size === 0}
              className="gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              批量导出
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className="gap-1.5 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              批量删除
            </Button>
          </div>
        </div>
      )}

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
              className={`group bg-white rounded-2xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative ${
                selectedIds.has(wf.id)
                  ? 'border-violet-400 ring-2 ring-violet-200'
                  : 'border-gray-200/70'
              }`}
            >
              {selectMode && (
                <button
                  className="absolute top-3 left-3 z-10 w-6 h-6 rounded-md bg-white/90 backdrop-blur-sm border-2 flex items-center justify-center hover:bg-white transition-colors"
                  style={{
                    borderColor: selectedIds.has(wf.id) ? '#8b5cf6' : '#d1d5db',
                  }}
                  onClick={(e) => toggleSelect(wf.id, e)}
                >
                  {selectedIds.has(wf.id) && <Check className="w-4 h-4 text-violet-500" />}
                </button>
              )}
              <div
                className="cursor-pointer"
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(wf.id);
                  } else {
                    handleOpen(wf);
                  }
                }}
              >
                <div
                  className={`h-28 relative overflow-hidden rounded-t-2xl ${wf.bgImage ? '' : `bg-gradient-to-br ${wf.bgGradient || gradients[idx % gradients.length]}`}`}
                  style={wf.bgImage ? { backgroundImage: `url(${wf.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
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
                      handleRun(wf);
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
                          menuTriggerRect.current = rect;
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
            ref={menuRef}
            className={`fixed w-36 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 py-1 transition-all duration-150 ease-out ${
              menuVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
            }`}
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
                if (wf) handleRename(wf.id, wf.workflow.flowMeta.name, wf.workflow.flowMeta.desc || '');
                setActiveMenu(null);
                setMenuPosition(null);
              }}
            >
              <Edit2 className="h-3.5 w-3.5" />
              重命名
            </button>
            <div className="px-3 py-2">
              <div className="text-xs text-gray-500 mb-2">更换背景</div>
              <div className="grid grid-cols-6 gap-1.5 mb-2">
                {gradients.map((g) => (
                  <button
                    key={g}
                    className={`w-full aspect-square rounded-md bg-gradient-to-br ${g} hover:scale-110 transition-transform`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeMenu) {
                        setWorkflowGradient(activeMenu, g);
                        setWorkflowBgImage(activeMenu, null);
                      }
                    }}
                  />
                ))}
              </div>
              <button
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-md border border-dashed border-gray-200"
                onClick={(e) => {
                  e.stopPropagation();
                  bgImageInputRef.current?.click();
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                上传图片
              </button>
              {activeMenu && workflows.find(w => w.id === activeMenu)?.bgImage && (
                <button
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-md mt-1.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeMenu) {
                      setWorkflowBgImage(activeMenu, null);
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  移除图片背景
                </button>
              )}
            </div>
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
              <h3 className="text-lg font-semibold text-gray-800">
                {showExportDialog === 'batch' ? '批量导出工作流' : '导出工作流'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {showExportDialog === 'batch'
                  ? `将选中的 ${selectedIds.size} 个工作流导出为 JSON 文件`
                  : '将工作流导出为 JSON 文件，可用于分享或备份'}
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

      {renameDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setRenameDialog(null)}
          />
          <div className="relative w-96 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="p-4 pb-2">
              <h3 className="text-sm font-semibold text-gray-800">编辑工作流信息</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">修改名称和简介，简介会显示在工作流卡片上。</p>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">名称</label>
                <input
                  type="text"
                  value={renameDialog.name}
                  onChange={(e) => setRenameDialog({ ...renameDialog, name: e.target.value })}
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  placeholder="请输入工作流名称"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 flex items-center justify-between">
                  <span>简介</span>
                  <span className="text-[10px] text-gray-400">{(renameDialog.desc || '').length} / 200</span>
                </label>
                <textarea
                  value={renameDialog.desc}
                  onChange={(e) => setRenameDialog({ ...renameDialog, desc: e.target.value.slice(0, 200) })}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 resize-none"
                  placeholder="一句话描述这个工作流的用途，例如：每周一导出销售报表并发送邮件…"
                />
              </div>
            </div>
            <div className="p-4 pt-0 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenameDialog(null)}
              >
                取消
              </Button>
              <Button size="sm" onClick={confirmRename} disabled={!renameDialog.name.trim()}>
                确定
              </Button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={bgImageInputRef}
        type="file"
        accept="image/*"
        onChange={handleBgImageUpload}
        className="hidden"
      />
    </div>
  );
}
