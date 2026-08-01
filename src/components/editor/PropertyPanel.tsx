import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Settings, Trash2, X, ChevronUp, MousePointerClick, FileText, Plus, Image, Keyboard, Target, Move } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { getNodeConfig, type PropertyField } from './nodeConfigs';
import { VariableInput } from './VariableInput';
import { VarNameInput } from './VarNameInput';
import { KeySelect } from './KeySelect';
import type { FlowNode } from '../../../types/flow-v2';

interface HelpTooltipProps {
  text: string;
}

const HelpTooltip: React.FC<HelpTooltipProps> = ({ text }) => {
  const [show, setShow] = useState(false);
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    arrowLeft: number | null;
    above: boolean;
  } | null>(null);

  const MAX_WIDTH = 300;
  const VIEWPORT_MARGIN = 12;
  const GAP = 8; // tooltip 与图标之间的距离

  const updatePosition = useCallback(() => {
    if (!iconRef.current || !tooltipRef.current) return;

    const iconRect = iconRef.current.getBoundingClientRect();
    const tooltipWidth = Math.min(MAX_WIDTH, tooltipRef.current.offsetWidth);
    const tooltipHeight = tooltipRef.current.offsetHeight;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // 先按居中上方计算，若空间不足则切到下方
    let top: number;
    let above = iconRect.top - GAP - tooltipHeight >= VIEWPORT_MARGIN;
    if (above) {
      top = iconRect.top - GAP - tooltipHeight;
    } else {
      // 下方空间不足时，优先选择剩余更大的一侧
      const spaceAbove = iconRect.top;
      const spaceBelow = viewportH - iconRect.bottom;
      above = spaceAbove > spaceBelow;
      top = above
        ? Math.max(VIEWPORT_MARGIN, iconRect.top - GAP - tooltipHeight)
        : iconRect.bottom + GAP;
    }

    // 水平方向：先按居中，若超出视窗则贴着边缘显示（保证完全可见）
    const rawLeft = iconRect.left + iconRect.width / 2 - tooltipWidth / 2;
    const minLeft = VIEWPORT_MARGIN;
    const maxLeft = viewportW - VIEWPORT_MARGIN - tooltipWidth;
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, rawLeft));

    // 计算小箭头应该放在哪（如果 tooltip 被夹边，箭头要指向图标而不是永远居中）
    const iconCenterX = iconRect.left + iconRect.width / 2;
    // arrowLeft 是相对于 tooltip 的偏移
    let arrowLeft: number | null = iconCenterX - clampedLeft;
    // 限制箭头在 tooltip 合理范围内
    if (arrowLeft < 16) arrowLeft = 16;
    if (arrowLeft > tooltipWidth - 16) arrowLeft = tooltipWidth - 16;

    setPlacement({
      left: clampedLeft,
      top,
      arrowLeft,
      above,
    });
  }, []);

  useEffect(() => {
    if (show) {
      // 需要下一帧再测量，确保 tooltip DOM 已渲染有尺寸
      const rafId = requestAnimationFrame(() => {
        updatePosition();
      });
      const handler = () => updatePosition();
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler);
      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
      };
    }
  }, [show, updatePosition]);

  return (
    <>
      <div
        ref={iconRef}
        className="flex items-center"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <HelpCircle className="h-3 w-3 text-gray-400 cursor-help" />
      </div>
      {show &&
        createPortal(
          <div
            ref={tooltipRef}
            className="fixed z-[9999] px-3 py-2 text-xs bg-gray-800 text-white rounded-xl shadow-2xl pointer-events-none break-words"
            style={{
              maxWidth: MAX_WIDTH,
              left: placement ? placement.left : -9999,
              top: placement ? placement.top : -9999,
              lineHeight: 1.5,
            }}
          >
            {text}
            {placement && (
              <div
                className="absolute w-0 h-0 border-4 border-transparent"
                style={{
                  left:
                    placement.arrowLeft !== null
                      ? `${placement.arrowLeft - 4}px`
                      : '50%',
                  transform: placement.arrowLeft === null ? 'translateX(-50%)' : undefined,
                  ...(placement.above
                    ? {
                        top: '100%',
                        marginTop: -1,
                        borderTopColor: '#1f2937',
                      }
                    : {
                        bottom: '100%',
                        marginBottom: -1,
                        borderBottomColor: '#1f2937',
                      }),
                }}
              />
            )}
          </div>,
          document.body
        )}
    </>
  );
};

interface KeyboardGroupsEditorProps {
  value: unknown;
  onChange: (value: { keys: string[] }[]) => void;
}

const KeyboardGroupsEditor: React.FC<KeyboardGroupsEditorProps> = ({ value, onChange }) => {
  const groups = Array.isArray(value) ? value as { keys: string[] }[] : [{ keys: [] }];
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const recordingRef = useRef<{ keys: Set<string>; cleanup: () => void } | null>(null);

  const updateGroup = (index: number, updates: Partial<{ keys: string[] }>) => {
    const newGroups = [...groups];
    newGroups[index] = { ...newGroups[index], ...updates };
    onChange(newGroups);
  };

  const addGroup = () => {
    const newGroups = [...groups, { keys: [] }];
    onChange(newGroups);
  };

  const removeGroup = (index: number) => {
    if (groups.length <= 1) return;
    const newGroups = groups.filter((_, i) => i !== index);
    onChange(newGroups);
  };

  const startRecording = (index: number) => {
    if (recordingIndex !== null) return;
    setRecordingIndex(index);

    const pressedKeys = new Set<string>();

    const keyMap: Record<string, string> = {
      ' ': 'space',
      'Control': 'ctrl',
      'Meta': 'cmd',
      'Command': 'cmd',
      'ArrowUp': 'up',
      'ArrowDown': 'down',
      'ArrowLeft': 'left',
      'ArrowRight': 'right',
      'Escape': 'esc',
      'Enter': 'enter',
      'Tab': 'tab',
      'Backspace': 'backspace',
      'Delete': 'delete',
      'Home': 'home',
      'End': 'end',
      'PageUp': 'pageup',
      'PageDown': 'pagedown',
    };

    const normalizeKey = (e: KeyboardEvent): string => {
      if (e.key.length === 1) {
        return e.key.toLowerCase();
      }
      return keyMap[e.key] || e.key.toLowerCase();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = normalizeKey(e);
      if (!pressedKeys.has(key)) {
        pressedKeys.add(key);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = Array.from(pressedKeys);
      updateGroup(index, { keys });
      cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
      setRecordingIndex(null);
      recordingRef.current = null;
    };

    recordingRef.current = { keys: pressedKeys, cleanup };
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);
  };

  const formatKeys = (keys: string[]) => {
    if (keys.length === 0) return '未设置';
    return keys.join(' + ');
  };

  return (
    <div className="space-y-2">
      {recordingIndex !== null && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 text-center font-medium animate-pulse">
          🔴 正在录制按键...按下组合键后松开完成
        </div>
      )}
      {groups.map((group, i) => (
        <div
          key={i}
          className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl space-y-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 shrink-0">#{i + 1}</span>
            <div className={`flex-1 px-2 py-1.5 border rounded-lg text-xs font-mono truncate ${
              recordingIndex === i
                ? 'bg-amber-50 border-amber-300 text-amber-700'
                : 'bg-white border-gray-200 text-gray-700'
            }`}>
              {recordingIndex === i ? '录制中...' : formatKeys(group.keys)}
            </div>
            <button
              type="button"
              onClick={() => startRecording(i)}
              disabled={recordingIndex !== null}
              className={`px-2 py-1 text-xs rounded-lg transition-colors shrink-0 flex items-center gap-1 ${
                recordingIndex === i
                  ? 'bg-amber-100 text-amber-700'
                  : recordingIndex !== null
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'text-violet-600 bg-violet-50 hover:bg-violet-100'
              }`}
            >
              <Keyboard className="h-3 w-3" />
              {recordingIndex === i ? '录制中' : '录制'}
            </button>
            {groups.length > 1 && (
              <button
                type="button"
                onClick={() => removeGroup(i)}
                className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addGroup}
        disabled={recordingIndex !== null}
        className="w-full px-3 py-2 text-sm text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus className="h-4 w-4" />
        添加按键组
      </button>
    </div>
  );
};

export const PropertyPanel: React.FC = () => {
  const { currentWorkflow, selectedNodeId, setSelectedNode, updateNodeParams, updateNode, deleteNode, nodeOutputs } =
    useWorkflowStore();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const selectedNode = currentWorkflow?.nodes.find((n) => n.id === selectedNodeId);
  const config = selectedNode ? getNodeConfig(selectedNode.nodeType) : null;
  const nodeOutput = selectedNodeId ? nodeOutputs[selectedNodeId] : undefined;

  const getPrecedingNodeVars = useCallback((): string[] => {
    if (!currentWorkflow || !selectedNodeId) return [];

    const nodeMap = new Map<string, FlowNode>();
    currentWorkflow.nodes.forEach((n) => nodeMap.set(n.id, n));

    const prevNodesMap = new Map<string, string[]>();
    currentWorkflow.nodes.forEach((node) => {
      node.nextNodes?.forEach((next) => {
        if (!prevNodesMap.has(next.nodeId)) {
          prevNodesMap.set(next.nodeId, []);
        }
        prevNodesMap.get(next.nodeId)!.push(node.id);
      });
    });

    const visited = new Set<string>();
    const queue: string[] = [];
    const prevNodeIds: string[] = [];

    const initialPrevs = prevNodesMap.get(selectedNodeId) || [];
    initialPrevs.forEach((id) => {
      if (!visited.has(id)) {
        visited.add(id);
        queue.push(id);
      }
    });

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      prevNodeIds.push(nodeId);

      const prevs = prevNodesMap.get(nodeId) || [];
      prevs.forEach((prevId) => {
        if (!visited.has(prevId)) {
          visited.add(prevId);
          queue.push(prevId);
        }
      });
    }

    const nodeVars: string[] = [];
    const seen = new Set<string>();
    prevNodeIds.forEach((nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      const params = node.nodeParams as any;
      if (node.nodeType === 'control.var' && params?.varName) {
        if (!seen.has(params.varName)) {
          seen.add(params.varName);
          nodeVars.push(params.varName);
        }
        if (params?.saveToNewVar && params?.outputVarName && !seen.has(params.outputVarName)) {
          seen.add(params.outputVarName);
          nodeVars.push(params.outputVarName);
        }
      } else if (node.nodeType === 'control.loop') {
        if (params?.loopType === 'for' && params?.iteratorVar) {
          if (!seen.has(params.iteratorVar)) {
            seen.add(params.iteratorVar);
            nodeVars.push(params.iteratorVar);
          }
        } else if (params?.loopType === 'forEach') {
          if (params?.itemVar && !seen.has(params.itemVar)) {
            seen.add(params.itemVar);
            nodeVars.push(params.itemVar);
          }
          if (params?.keyVar && !seen.has(params.keyVar)) {
            seen.add(params.keyVar);
            nodeVars.push(params.keyVar);
          }
        }
      } else if (params?.outputVar) {
        if (!seen.has(params.outputVar)) {
          seen.add(params.outputVar);
          nodeVars.push(params.outputVar);
        }
      }
    });

    return nodeVars;
  }, [currentWorkflow, selectedNodeId]);

  const globalVarNames = useMemo(() => {
    if (!currentWorkflow?.globalVars) return [];
    return Object.keys(currentWorkflow.globalVars);
  }, [currentWorkflow?.globalVars]);

  const nodeOutputVars = useMemo(() => getPrecedingNodeVars(), [getPrecedingNodeVars]);

  const variables = useMemo(() => {
    const allVars: string[] = [];
    globalVarNames.forEach((v) => allVars.push(v));
    nodeOutputVars.forEach((v) => allVars.push(v));
    return allVars;
  }, [globalVarNames, nodeOutputVars]);

  useEffect(() => {
    if (selectedNodeId) {
      setIsCollapsed(false);
    }
  }, [selectedNodeId]);

  const handleParamChange = (key: string, value: unknown) => {
    if (!selectedNode) return;
    const params = { ...selectedNode.nodeParams, [key]: value };
    if (key === 'saveToNewVar' && value === true) {
      if (!params.outputVarName || String(params.outputVarName).trim() === '') {
        const varName = params.varName ? String(params.varName) : '';
        params.outputVarName = varName ? `return_${varName}` : 'return_value';
      }
    }
    if (key === 'varName' && params.saveToNewVar) {
      const currentOutput = String(params.outputVarName || '');
      const newVarName = String(value || '');
      if (currentOutput === '' || currentOutput.startsWith('return_')) {
        params.outputVarName = newVarName ? `return_${newVarName}` : 'return_value';
      }
    }
    updateNodeParams(selectedNode.id, params);
  };

  const handleNameChange = (name: string) => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, { nodeName: name });
  };

  const renderField = (field: PropertyField) => {
    const value = (selectedNode?.nodeParams as Record<string, unknown>)?.[field.key];

    switch (field.type) {
      case 'text':
        return (
          <VariableInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
          />
        );

      case 'textarea':
        return (
          <VariableInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
            multiline
          />
        );

      case 'number':
        return (
          <input
            type="text"
            inputMode="decimal"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-') {
                handleParamChange(field.key, val);
              } else if (!isNaN(Number(val))) {
                handleParamChange(field.key, val);
              }
            }}
            onBlur={(e) => {
              const val = e.target.value;
              if (val === '' || val === '-' || isNaN(Number(val))) {
                handleParamChange(field.key, 0);
              } else {
                handleParamChange(field.key, Number(val));
              }
            }}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
          />
        );

      case 'select':
        return (
          <select
            value={String(value ?? '')}
            onChange={(e) => handleParamChange(field.key, e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
          >
            {field.options?.map((opt) => {
              if (opt.value.startsWith('---') && opt.value.endsWith('---')) {
                return (
                  <optgroup key={opt.value} label={opt.label} />
                );
              }
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              );
            })}
          </select>
        );

      case 'switch':
        return (
          <button
            onClick={() => handleParamChange(field.key, !value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? 'bg-indigo-500' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                value ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        );

      case 'variable': {
        const valStr = String(value ?? '');
        const isPureVar = /^\{\{\s*[^{}\s]+\s*\}\}$/.test(valStr) || /^[^{}\s]+$/.test(valStr);
        const hasVarTemplate = valStr.includes('{{');
        const showWarning = hasVarTemplate && !isPureVar;
        return (
          <div className="space-y-1.5">
            <VariableInput
              value={valStr}
              onChange={(v) => handleParamChange(field.key, v)}
              placeholder={field.placeholder}
              variables={variables}
              globalVariables={globalVarNames}
              nodeVariables={nodeOutputVars}
            />
            {showWarning && (
              <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                ⚠️ 检测到混合文本和变量。条件判断仅取第一个变量的值进行比较，建议使用变量赋值节点先处理好再进行判断。
              </div>
            )}
          </div>
        );
      }

      case 'key-select':
        return (
          <KeySelect
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
          />
        );

      case 'var-name':
        return (
          <VarNameInput
            value={String(value ?? '')}
            onChange={(v) => handleParamChange(field.key, v)}
            placeholder={field.placeholder}
            variables={variables}
            globalVariables={globalVarNames}
            nodeVariables={nodeOutputVars}
          />
        );

      case 'file-path': {
        const paths = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const addFiles = async () => {
          try {
            const result = await window.mimic.invoke('dialog:select-file', {
              multiSelections: true,
            });
            if (result) {
              const newPaths = Array.isArray(result) ? result : [result];
              const allPaths = [...paths, ...newPaths];
              handleParamChange(field.key, allPaths.join(','));
            }
          } catch (e) {
            console.error('选择文件失败', e);
          }
        };
        const removeFile = (index: number) => {
          const newPaths = paths.filter((_, i) => i !== index);
          handleParamChange(field.key, newPaths.join(','));
        };
        return (
          <div className="space-y-2">
            {paths.length > 0 ? (
              <div className="space-y-1.5">
                {paths.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg group"
                  >
                    <div className="w-6 h-6 rounded bg-indigo-100 flex items-center justify-center shrink-0">
                      <FileText className="h-3.5 w-3.5 text-indigo-600" />
                    </div>
                    <span
                      className="flex-1 text-xs font-mono text-gray-700 truncate"
                      title={p}
                    >
                      {p.split(/[\\/]/).pop() || p}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 border border-dashed border-gray-300 rounded-xl text-center text-xs text-gray-400">
                未选择文件
              </div>
            )}
            <button
              type="button"
              onClick={addFiles}
              className="w-full px-3 py-2 text-sm text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              添加文件
            </button>
          </div>
        );
      }

      case 'image-list': {
        const images = Array.isArray(value) ? value as { name: string; url: string }[] : [];
        
        const updateImage = (index: number, updates: Partial<{ name: string; url: string }>) => {
          const newImages = [...images];
          newImages[index] = { ...newImages[index], ...updates };
          handleParamChange(field.key, newImages);
        };
        
        const addImage = (name?: string, url?: string) => {
          const newImages = [...images, { name: name || `图片${images.length + 1}`, url: url || '' }];
          handleParamChange(field.key, newImages);
        };
        
        const removeImage = (index: number) => {
          const newImages = images.filter((_, i) => i !== index);
          handleParamChange(field.key, newImages);
        };
        
        const selectImageFile = async (index: number) => {
          try {
            const result = await window.mimic.invoke('dialog:select-file', {
              multiSelections: false,
              filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
            });
            if (result && typeof result === 'string') {
              updateImage(index, { url: result });
            }
          } catch (e) {
            console.error('选择图片失败', e);
          }
        };
        
        const handlePaste = async (e: React.ClipboardEvent) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = reader.result as string;
                  addImage(`剪贴板图片${images.length + 1}`, base64);
                };
                reader.readAsDataURL(file);
              }
              break;
            }
          }
        };
        
        return (
          <div className="space-y-2" onPaste={handlePaste}>
            {images.length > 0 && (
              <div className="space-y-2">
                {images.map((img, i) => (
                  <div
                    key={i}
                    className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 shrink-0">#{i + 1}</span>
                      <input
                        type="text"
                        value={img.name || ''}
                        onChange={(e) => updateImage(i, { name: e.target.value })}
                        placeholder="图片名称"
                        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={img.url || ''}
                        onChange={(e) => updateImage(i, { url: e.target.value })}
                        placeholder="图片路径/URL/Base64"
                        className="flex-1 px-2 py-1 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => selectImageFile(i)}
                        className="px-2 py-1 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors shrink-0"
                      >
                        选择
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => addImage()}
                className="flex-1 px-3 py-2 text-sm text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                添加图片
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const clipItems = await navigator.clipboard.read();
                    for (const item of clipItems) {
                      const imgType = item.types.find((t) => t.startsWith('image/'));
                      if (imgType) {
                        const blob = await item.getType(imgType);
                        const reader = new FileReader();
                        reader.onload = () => {
                          const base64 = reader.result as string;
                          addImage(`剪贴板图片${images.length + 1}`, base64);
                        };
                        reader.readAsDataURL(blob);
                        break;
                      }
                    }
                  } catch (e) {
                    console.error('读取剪贴板失败，请在图片区域按 Ctrl+V 粘贴', e);
                  }
                }}
                className="px-3 py-2 text-sm text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
                title="也可以在图片区域按 Ctrl+V 粘贴"
              >
                粘贴
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              提示：在图片区域按 Ctrl+V 可直接粘贴剪贴板图片
            </p>
            {images.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="convert-http-img"
                  checked={!!(selectedNode?.nodeParams as any)?.convertHttpImage2Base64}
                  onChange={(e) => handleParamChange('convertHttpImage2Base64', e.target.checked)}
                  className="w-3.5 h-3.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                />
                <label htmlFor="convert-http-img" className="text-xs text-gray-600 cursor-pointer">
                  HTTP 图片自动转 Base64
                </label>
              </div>
            )}
          </div>
        );
      }

      case 'coordinate': {
        const params = selectedNode?.nodeParams as Record<string, unknown> || {};
        const x = params.x as number ?? 0;
        const y = params.y as number ?? 0;
        const pickCoordinate = async () => {
          try {
            const result = await window.mimic.invoke('system:pick-coordinate') as { x: number; y: number };
            if (result && typeof result === 'object' && 'x' in result && 'y' in result) {
              if (selectedNode) {
                updateNodeParams(selectedNode.id, { x: result.x, y: result.y });
              }
            }
          } catch (e) {
            console.error('拾取坐标失败', e);
          }
        };
        const testPosition = async () => {
          try {
            await window.mimic.invoke('system:move-mouse', x, y);
          } catch (e) {
            console.error('移动鼠标失败', e);
          }
        };
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-gray-500">X 坐标</label>
                <input
                  type="number"
                  value={x}
                  onChange={(e) => handleParamChange('x', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all bg-white"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-gray-500">Y 坐标</label>
                <input
                  type="number"
                  value={y}
                  onChange={(e) => handleParamChange('y', Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all bg-white"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={pickCoordinate}
                className="flex-1 px-3 py-2 text-sm text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <Target className="h-4 w-4" />
                点击拾取坐标
              </button>
              <button
                type="button"
                onClick={testPosition}
                className="flex-1 px-3 py-2 text-sm text-cyan-600 bg-cyan-50 hover:bg-cyan-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <Move className="h-4 w-4" />
                测试位置
              </button>
            </div>
          </div>
        );
      }

      case 'image-template': {
        const imgValue = String(value ?? '');
        const hasImage = imgValue.length > 0;

        const selectImageFile = async () => {
          try {
            const result = await window.mimic.invoke('dialog:select-file', {
              multiSelections: false,
              filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }],
            });
            if (result && typeof result === 'string') {
              handleParamChange(field.key, result);
            }
          } catch (e) {
            console.error('选择图片失败', e);
          }
        };

        const handlePaste = async (e: React.ClipboardEvent) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
              e.preventDefault();
              const file = item.getAsFile();
              if (file) {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = reader.result as string;
                  handleParamChange(field.key, base64);
                };
                reader.readAsDataURL(file);
              }
              break;
            }
          }
        };

        const clearImage = () => {
          handleParamChange(field.key, '');
        };

        return (
          <div className="space-y-2" onPaste={handlePaste}>
            {hasImage ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                <img
                  src={imgValue}
                  alt="模板图片"
                  className="w-full h-32 object-contain"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 w-6 h-6 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="px-3 py-6 border-2 border-dashed border-gray-300 rounded-xl text-center text-xs text-gray-400">
                <Image className="h-8 w-8 mx-auto mb-2 opacity-40" />
                未选择模板图片
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={selectImageFile}
                className="flex-1 px-3 py-2 text-sm text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <Plus className="h-4 w-4" />
                选择图片
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const clipItems = await navigator.clipboard.read();
                    for (const item of clipItems) {
                      const imgType = item.types.find((t) => t.startsWith('image/'));
                      if (imgType) {
                        const blob = await item.getType(imgType);
                        const reader = new FileReader();
                        reader.onload = () => {
                          const base64 = reader.result as string;
                          handleParamChange(field.key, base64);
                        };
                        reader.readAsDataURL(blob);
                        break;
                      }
                    }
                  } catch (e) {
                    console.error('读取剪贴板失败，请在图片区域按 Ctrl+V 粘贴', e);
                  }
                }}
                className="px-3 py-2 text-sm text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors font-medium flex items-center justify-center gap-1.5"
                title="也可以在图片区域按 Ctrl+V 粘贴"
              >
                粘贴
              </button>
            </div>
            <p className="text-xs text-gray-400 text-center">
              提示：在图片区域按 Ctrl+V 可直接粘贴
            </p>
          </div>
        );
      }

      case 'keyboard-groups': {
        return (
          <KeyboardGroupsEditor
            value={value}
            onChange={(newGroups) => handleParamChange(field.key, newGroups)}
          />
        );
      }

      default:
        return null;
    }
  };

  const hasSelection = !!selectedNode && !!config;
  const Icon = config?.icon;

  const shouldExpand = hasSelection && !isCollapsed;

  return (
    <div
      className={`absolute right-4 top-4 z-10 w-80 flex flex-col ${shouldExpand ? 'bottom-4' : ''}`}
    >
      <div className={`bg-white/90 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${shouldExpand ? 'flex-1' : ''}`}>
        {/* 头部 - 永远显示 */}
        <div
          className="p-4 border-b border-gray-100 bg-gradient-to-l from-gray-50/50 to-white cursor-pointer select-none"
          onClick={() => hasSelection && setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${hasSelection ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-400'}`}>
              <Settings className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-gray-800">属性面板</h3>
              <p className="text-xs text-gray-500 truncate">
                {hasSelection ? config!.name : '请选择节点'}
              </p>
            </div>
            {hasSelection && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNode(null);
                  }}
                  className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors"
                  title="关闭"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
                <div
                  className={`transform transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
                >
                  <ChevronUp className="h-4 w-4 text-gray-400" />
                </div>
              </>
            )}
          </div>
        </div>

        {/* 有选中节点且未收起时显示内容 */}
        {hasSelection && !isCollapsed && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <div
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ backgroundColor: `${config!.color}10` }}
              >
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${config!.color}20`, color: config!.color }}
                >
                  {Icon && <Icon className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    type="text"
                    value={selectedNode!.nodeName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full text-sm font-semibold text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 focus:outline-none transition-colors"
                  />
                  <div className="text-xs text-gray-500 mt-0.5">{config!.name}</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-400">
                节点 ID: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{selectedNode!.id}</code>
              </div>
            </div>

            <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-4">
              {config!.propertyFields.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">该节点无参数配置</p>
              ) : (
                <>
                  <div
                    className="p-3 rounded-xl border space-y-1"
                    style={{
                      backgroundColor: `${config!.color}0a`,
                      borderColor: `${config!.color}20`,
                    }}
                  >
                    <div
                      className="text-[11px] font-medium flex items-center gap-1.5"
                      style={{ color: config!.color }}
                    >
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: config!.color }}
                      />
                      功能说明
                    </div>
                    <div
                      className="text-[12px] leading-relaxed"
                      style={{ color: `${config!.color}cc` }}
                    >
                      {config!.description}
                    </div>
                  </div>

                  {selectedNode!.nodeType === 'control.var' && (
                    <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-100 space-y-1">
                      <div className="text-[11px] font-medium text-indigo-700 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-indigo-500" />
                        变量语法
                      </div>
                      <div className="text-[11px] text-indigo-600 leading-relaxed">
                        双大括号引用变量，如 <code className="bg-indigo-100 px-1 py-0.5 rounded font-mono">{'{{count}}'}</code>，输入 # 快速选择
                      </div>
                      <div className="text-[11px] text-indigo-500 leading-relaxed">
                        转义：<code className="bg-indigo-100 px-1 py-0.5 rounded font-mono">{'\\{{text}\\}}'}</code> 输出字面量 {'{{text}}'}
                      </div>
                    </div>
                  )}

                  {(() => {
                    if (selectedNode!.nodeType !== 'system.mouseUp' && selectedNode!.nodeType !== 'system.keyUp') return null;
                    const isMouseUp = selectedNode!.nodeType === 'system.mouseUp';
                    const targetType = isMouseUp ? 'system.mouseDown' : 'system.keyDown';
                    const nodes = currentWorkflow?.nodes || [];
                    const idx = nodes.findIndex((n) => n.id === selectedNodeId);
                    let nearest: FlowNode | null = null;
                    for (let j = idx - 1; j >= 0; j--) {
                      if (nodes[j].nodeType === targetType) { nearest = nodes[j]; break; }
                    }
                    const params = (selectedNode!.nodeParams || {}) as any;
                    const autoSync = params.autoSync !== false;

                    const applyFill = () => {
                      if (!nearest || !selectedNode) return;
                      if (isMouseUp) {
                        const near = (nearest.nodeParams || {}) as any;
                        updateNodeParams(selectedNode.id, {
                          ...params,
                          autoSync: false,
                          button: near.button || 'left',
                        });
                      } else {
                        const near = (nearest.nodeParams || {}) as any;
                        // ⬇️ 编辑态填到 keyUp 面板的 keyGroups 也要按抬起逆序展示：
                        //   1) 整体组数逆序（先按的组后抬）
                        //   2) 每个组内的 keys 也要逆序（最后按的键先抬）
                        const filledGroups = Array.isArray(near.keyGroups)
                          ? JSON.parse(JSON.stringify(near.keyGroups))
                          : [{ keys: [] }];
                        const reversedForUp = filledGroups
                          .slice()
                          .reverse()
                          .map((g: any) => ({
                            keys: Array.isArray(g?.keys) ? g.keys.slice().reverse() : [],
                          }));
                        updateNodeParams(selectedNode.id, {
                          ...params,
                          autoSync: false,
                          keyGroups: reversedForUp,
                        });
                      }
                    };

                    return (
                      <div
                        className="p-3 rounded-xl space-y-2"
                        style={{
                          backgroundColor: isMouseUp ? '#8b5cf60a' : '#7c3aed0a',
                          border: `1px solid ${isMouseUp ? '#8b5cf622' : '#7c3aed22'}`,
                        }}
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: isMouseUp ? '#7c3aed' : '#6d28d9' }}>
                          <span className="w-1 h-1 rounded-full" style={{ backgroundColor: isMouseUp ? '#7c3aed' : '#6d28d9' }} />
                          {autoSync ? '🤖 智能同步已开启' : '📝 手动模式'}
                        </div>
                        {autoSync ? (
                          <div className="text-[12px] leading-relaxed" style={{ color: (isMouseUp ? '#7c3aed' : '#6d28d9') + 'cc' }}>
                            运行时会自动抬起上方最近一次{isMouseUp ? '鼠标按下' : '键盘按下'}节点的内容，无需手动填写。
                            {nearest
                              ? (() => {
                                const np = (nearest.nodeParams || {}) as any;
                                let detail = '';
                                if (isMouseUp) {
                                  detail = `（按键：${np.button || 'left'}）`;
                                } else {
                                  const groups = Array.isArray(np.keyGroups) ? np.keyGroups : [];
                                  // 预览抬键顺序（整体组数逆序 + 每组内 keys 逆序）
                                  const upOrder = groups
                                    .slice()
                                    .reverse()
                                    .map((g: any) => {
                                      const keys = Array.isArray(g?.keys) ? g.keys.slice().reverse() : [];
                                      return `[${keys.join(' + ')}]`;
                                    })
                                    .join(' → ');
                                  detail = `（${groups.length} 组，抬键顺序：${upOrder || '空'}）`;
                                }
                                return (
                                  <span className="block mt-1 text-[11px] opacity-80">
                                    → 预计同步节点：<code className="bg-white/60 px-1.5 py-0.5 rounded">{nearest.nodeName || nearest.id}</code>
                                    <span className="block mt-0.5">{detail}</span>
                                  </span>
                                );
                              })()
                              : <span className="block mt-1 text-[11px] text-rose-500">⚠ 未在当前工作流找到对应的按下节点，请确认连线顺序</span>}
                          </div>
                        ) : (
                          <div className="text-[12px] leading-relaxed" style={{ color: (isMouseUp ? '#7c3aed' : '#6d28d9') + 'cc' }}>
                            已切换到手动模式，下方的配置项已显示。若想恢复自动同步可打开上方的开关。
                          </div>
                        )}
                        {nearest && (
                          <button
                            onClick={applyFill}
                            className="w-full text-[12px] mt-1 px-3 py-1.5 rounded-lg font-medium transition-all text-white shadow-sm hover:opacity-90"
                            style={{ background: `linear-gradient(135deg, ${isMouseUp ? '#8b5cf6' : '#7c3aed'}, ${isMouseUp ? '#a78bfa' : '#8b5cf6'})` }}
                          >
                            ✨ 把最近按下节点的内容填到这里（自动切手动模式）
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {config!.propertyFields
                    .filter((field) => {
                      if (!field.showWhen) {
                        if (selectedNode?.nodeType === 'control.var') {
                          if (field.key === 'saveToNewVar' || field.key === 'outputVarName') {
                            const op = selectedNode.nodeParams?.operation as string;
                            const computeOps = [
                              'add', 'subtract', 'multiply', 'divide', 'modulo',
                              'abs', 'round', 'ceil', 'floor',
                              'toNumber', 'toInteger', 'toString',
                              'concat', 'toUpperCase', 'toLowerCase', 'trim',
                              'substring', 'charAt', 'replace', 'strLength',
                              'startsWith', 'endsWith', 'includes',
                              'arrayLength', 'arrayGet', 'arrayJoin',
                              'objectGet', 'objectKeys', 'objectValues',
                            ];
                            return computeOps.includes(op);
                          }
                        }
                        return true;
                      }
                      return Object.entries(field.showWhen).every(
                        ([key, value]) => selectedNode!.nodeParams?.[key] === value
                      );
                    })
                    .map((field) => (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center gap-1">
                          <label className="text-xs font-semibold text-gray-700">{field.label}</label>
                          {field.description && <HelpTooltip text={field.description} />}
                        </div>
                        {renderField(field)}
                      </div>
                    ))}
                </>
              )}

              <div className="pt-4 mt-4 border-t border-gray-100">
                <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <span className="w-1 h-3.5 bg-gray-400 rounded-full"></span>
                  通用设置
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">超时时间 (ms)</label>
                    <input
                      type="number"
                      value={30000}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-600">重试次数</label>
                    <input
                      type="number"
                      value={1}
                      min={0}
                      max={10}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
                    />
                  </div>
                </div>
              </div>

              {(() => {
                const nodeType = selectedNode?.nodeType;
                const params = selectedNode?.nodeParams as any;
                const hasOutput = nodeType === 'control.log' ||
                  nodeType === 'control.end' ||
                  (nodeType === 'control.var' && params?.printResult === true);
                if (!hasOutput) return null;
                return (
                  <div className="pt-4 mt-4 border-t border-gray-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-500" />
                      <span className="text-xs font-semibold text-gray-700">输出内容</span>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 max-h-64 overflow-auto">
                      {nodeOutput !== undefined && nodeOutput !== '' ? (
                        <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
                          {String(nodeOutput)}
                        </pre>
                      ) : (
                        <p className="text-xs text-gray-400 italic">暂无输出，运行后显示</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="pt-4 mt-4 border-t border-gray-100">
                <button
                  onClick={() => {
                    deleteNode(selectedNode!.id);
                    setSelectedNode(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors font-medium"
                >
                  <Trash2 className="h-4 w-4" />
                  删除节点
                </button>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  选中节点后按 Backspace 也可删除
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 未选中时的提示 */}
        {!hasSelection && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gray-100 flex items-center justify-center">
              <MousePointerClick className="h-7 w-7 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">选择一个节点</p>
            <p className="text-xs text-gray-400 mt-1">查看和编辑属性</p>
          </div>
        )}
      </div>
    </div>
  );
};
