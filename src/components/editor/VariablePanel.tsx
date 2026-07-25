import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Variable, ChevronDown } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';

type VarType = 'string' | 'number' | 'boolean' | 'array' | 'object';

const VAR_TYPE_OPTIONS: { label: string; value: VarType; defaultVal: string; placeholder: string }[] = [
  { label: '字符串', value: 'string', defaultVal: '', placeholder: '如: hello world' },
  { label: '数字', value: 'number', defaultVal: '0', placeholder: '如: 100, 3.14' },
  { label: '布尔', value: 'boolean', defaultVal: 'false', placeholder: 'true / false' },
  { label: '数组', value: 'array', defaultVal: '[]', placeholder: '如: [1, 2, 3]' },
  { label: '对象 (JSON)', value: 'object', defaultVal: '{}', placeholder: '如: {"key": "value"}' },
];

interface VariablePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VariablePanel: React.FC<VariablePanelProps> = ({ isOpen, onClose }) => {
  const { currentWorkflow, addGlobalVar, updateGlobalVar, deleteGlobalVar } = useWorkflowStore();
  const [newVarName, setNewVarName] = useState('');
  const [newVarType, setNewVarType] = useState<VarType>('string');
  const [newVarValue, setNewVarValue] = useState('');
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const variables = currentWorkflow?.globalVars || {};
  const varEntries = Object.entries(variables);

  const detectVarType = (value: unknown): VarType => {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'string';
    return typeof value as VarType;
  };

  const parseValue = (str: string, type: VarType): unknown => {
    switch (type) {
      case 'number': {
        const num = Number(str);
        return isNaN(num) ? 0 : num;
      }
      case 'boolean':
        return str === 'true';
      case 'array':
      case 'object': {
        try {
          const parsed = JSON.parse(str);
          if (type === 'array' && !Array.isArray(parsed)) return [];
          if (type === 'object' && (Array.isArray(parsed) || typeof parsed !== 'object' || parsed === null)) return {};
          return parsed;
        } catch {
          return type === 'array' ? [] : {};
        }
      }
      case 'string':
      default:
        return str;
    }
  };

  const handleTypeChange = (type: VarType) => {
    setNewVarType(type);
    const opt = VAR_TYPE_OPTIONS.find((o) => o.value === type);
    if (opt) setNewVarValue(opt.defaultVal);
  };

  const handleAdd = () => {
    if (!newVarName.trim()) return;
    const value = parseValue(newVarValue, newVarType);
    addGlobalVar(newVarName.trim(), value);
    setNewVarName('');
    setNewVarType('string');
    setNewVarValue('');
  };

  const handleStartEdit = (name: string, value: unknown) => {
    setEditingVar(name);
    const type = detectVarType(value);
    if (type === 'array' || type === 'object' || typeof value === 'object') {
      setEditValue(JSON.stringify(value));
    } else {
      setEditValue(String(value));
    }
  };

  const handleSaveEdit = () => {
    if (!editingVar) return;
    const currentVal = variables[editingVar];
    const type = detectVarType(currentVal);
    const value = parseValue(editValue, type);
    updateGlobalVar(editingVar, value);
    setEditingVar(null);
  };

  const getValueType = (value: unknown): string => {
    if (typeof value === 'string') return '字符串';
    if (typeof value === 'number') return '数字';
    if (typeof value === 'boolean') return '布尔';
    if (value === null) return 'null';
    if (Array.isArray(value)) return '数组';
    if (typeof value === 'object') return '对象';
    return '未知';
  };

  const getValueColor = (value: unknown): string => {
    if (typeof value === 'string') return 'text-green-600 bg-green-50';
    if (typeof value === 'number') return 'text-blue-600 bg-blue-50';
    if (typeof value === 'boolean') return 'text-purple-600 bg-purple-50';
    return 'text-gray-600 bg-gray-50';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative z-10 w-[500px] max-h-[80vh] bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
          >
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-indigo-50/50 to-purple-50/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                  <Variable className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-gray-800">全局变量</h3>
                  <p className="text-xs text-gray-500 mt-0.5">在节点输入框中输入 <code className="bg-white px-1 py-0.5 rounded border border-gray-200 font-mono text-indigo-600">#</code> 选择变量，或直接使用 {'{{变量名}}'} 引用</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/60 rounded-xl transition-colors"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-4 border-b border-gray-100">
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 space-y-1.5 mb-4">
                <div className="text-[11px] font-medium text-indigo-700 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-indigo-500" />
                  变量使用说明
                </div>
                <div className="text-[12px] text-indigo-600 leading-relaxed">
                  <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono">{'{{变量名}}'}</code> 在节点输入框中引用变量
                </div>
                <div className="text-[12px] text-indigo-600 leading-relaxed">
                  <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono">#</code> 输入 # 号快速选择变量插入
                </div>
                <div className="text-[11px] text-indigo-500 leading-relaxed">
                  转义：<code className="bg-indigo-100 px-1 py-0.5 rounded font-mono">{'\\{{text}\\}}'}</code> 输出字面量 {'{{text}}'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">变量名</label>
                    <input
                      type="text"
                      value={newVarName}
                      onChange={(e) => setNewVarName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                      placeholder="如: username, 计数器"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    />
                  </div>
                  <div style={{ width: 120 }}>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">类型</label>
                    <select
                      value={newVarType}
                      onChange={(e) => handleTypeChange(e.target.value as VarType)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white appearance-none cursor-pointer"
                    >
                      {VAR_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-gray-600 mb-1 block">初始值</label>
                    <input
                      type="text"
                      value={newVarValue}
                      onChange={(e) => setNewVarValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                      placeholder={VAR_TYPE_OPTIONS.find((o) => o.value === newVarType)?.placeholder}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white font-mono"
                    />
                  </div>
                  <button
                    onClick={handleAdd}
                    className="px-4 py-2 text-sm text-white bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95 font-medium flex items-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" />
                    添加
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {varEntries.length === 0 ? (
                <div className="text-center py-12">
                  <Variable className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm text-gray-400">暂无全局变量</p>
                  <p className="text-xs text-gray-400 mt-1">添加第一个变量开始使用</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {varEntries.map(([name, value]) => (
                    <motion.div
                      key={name}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="p-3 bg-gray-50/50 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all group"
                    >
                      {editingVar === name ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700 min-w-[100px]">{name}</span>
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') setEditingVar(null);
                            }}
                            onBlur={handleSaveEdit}
                            autoFocus
                            className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-800">{name}</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${getValueColor(value)}`}>
                                {getValueType(value)}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5 truncate font-mono">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleStartEdit(name, value)}
                              className="p-1.5 hover:bg-white rounded-lg transition-colors"
                              title="编辑"
                            >
                              <ChevronDown className="h-4 w-4 text-gray-400 rotate-[-90deg]" />
                            </button>
                            <button
                              onClick={() => deleteGlobalVar(name)}
                              className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-gray-100 bg-gray-50/50">
              <p className="text-xs text-gray-500 text-center">
                💡 输入 <code className="bg-white px-1.5 py-0.5 rounded border border-gray-200 font-mono text-indigo-600">#</code> 快速选择变量，或用 <code className="bg-white px-1.5 py-0.5 rounded border border-gray-200 font-mono text-indigo-600">{'{{变量名}}'}</code> 引用
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
