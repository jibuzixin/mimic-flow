import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, GripVertical, Layers, ChevronUp, Pin, PinOff } from 'lucide-react';
import { nodeConfigs, categoryLabels, type NodeCategory, type NodeConfig } from './nodeConfigs';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAppStore } from '../../stores/appStore';

interface NodeLibraryProps {
  onDragStart: (nodeType: string) => void;
  onDragEnd: () => void;
}

export const NodeLibrary: React.FC<NodeLibraryProps> = ({ onDragStart, onDragEnd }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<NodeCategory>>(
    new Set(['control', 'ai-action', 'ai-query', 'wait', 'system']),
  );

  const { pinnedNodeTypes, pinNode, unpinNode } = useWorkflowStore();
  const { uiSettings } = useAppStore();

  const filteredConfigs = useMemo(() => {
    if (!searchTerm) return nodeConfigs;
    const term = searchTerm.toLowerCase();
    return nodeConfigs.filter(
      (c) => c.name.toLowerCase().includes(term) || c.description.toLowerCase().includes(term),
    );
  }, [searchTerm]);

  const groupedConfigs = useMemo(() => {
    const groups: Record<NodeCategory, NodeConfig[]> = {
      control: [],
      'ai-action': [],
      'ai-query': [],
      wait: [],
      system: [],
    };
    filteredConfigs.forEach((c) => {
      groups[c.category].push(c);
    });

    const categoryOrder = uiSettings.nodeCategoryOrder as NodeCategory[];
    const sortedCategories = categoryOrder.filter((c) => groups[c as NodeCategory]?.length > 0);
    const defaultCategories = (Object.keys(groups) as NodeCategory[]).filter(
      (c) => !categoryOrder.includes(c) && groups[c].length > 0,
    );
    const orderedCategories = [...sortedCategories, ...defaultCategories];

    const orderedGroups: Record<string, NodeConfig[]> = {};
    for (const cat of orderedCategories) {
      const nodes = groups[cat];
      const nodeOrder = uiSettings.nodeOrderWithinCategory?.[cat];
      if (nodeOrder && nodeOrder.length > 0) {
        const ordered = [...nodes].sort((a, b) => {
          const aIdx = nodeOrder.indexOf(a.type);
          const bIdx = nodeOrder.indexOf(b.type);
          if (aIdx === -1 && bIdx === -1) return 0;
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        });
        orderedGroups[cat] = ordered;
      } else {
        orderedGroups[cat] = nodes;
      }
    }

    return { categories: orderedCategories, groups: orderedGroups };
  }, [filteredConfigs, uiSettings.nodeCategoryOrder, uiSettings.nodeOrderWithinCategory]);

  const toggleCategory = (cat: NodeCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, nodeType: string) => {
    e.dataTransfer.setData('application/reactflow', nodeType);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(nodeType);
  };

  return (
    <div
      className={`absolute left-4 top-4 z-10 w-72 flex flex-col ${isCollapsed ? '' : 'bottom-4'}`}
    >
      <div className={`bg-white/90 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden ${isCollapsed ? '' : 'flex-1'}`}>
        {/* 头部 - 永远显示 */}
        <div
          className="p-4 border-b border-gray-100 bg-gradient-to-r from-gray-50/50 to-white cursor-pointer select-none"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
              <Layers className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-800">节点库</h3>
              <p className="text-xs text-gray-500">{nodeConfigs.length} 个可用节点</p>
            </div>
            <div
              className={`transform transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
            >
              <ChevronUp className="h-4 w-4 text-gray-400" />
            </div>
          </div>
        </div>

        {/* 搜索和内容 - 可收起 */}
        {!isCollapsed && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 pb-3 pt-1 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜索节点..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="overflow-y-auto p-2.5 pt-0 flex-1 min-h-0">
              {groupedConfigs.categories.map((category) => {
                const items = groupedConfigs.groups[category] || [];
                if (items.length === 0) return null;
                const isExpanded = expandedCategories.has(category);

                return (
                  <div key={category} className="mb-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCategory(category);
                      }}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100/50 rounded-xl transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {categoryLabels[category]}
                      <span className="ml-auto text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded-full text-[10px]">
                        {items.length}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-1.5 mt-1.5 pl-1">
                        {items.map((config) => {
                          const Icon = config.icon;
                          const isPinned = pinnedNodeTypes.includes(config.type);
                          return (
                            <div
                              key={config.type}
                              draggable
                              onDragStart={(e) => handleDragStart(e, config.type)}
                              onDragEnd={onDragEnd}
                              className="flex items-center gap-2.5 px-3 py-2.5 bg-white border border-gray-200/70 rounded-xl cursor-grab active:cursor-grabbing hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 hover:translate-x-0.5 transition-all group"
                              style={{ borderLeftWidth: '3px', borderLeftColor: config.color }}
                            >
                              <div
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                style={{ backgroundColor: `${config.color}15`, color: config.color }}
                              >
                                {Icon && <Icon className="h-4 w-4" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-gray-700 truncate">
                                  {config.name}
                                </div>
                                <div className="text-[11px] text-gray-400 truncate leading-tight">
                                  {config.description}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  if (isPinned) {
                                    unpinNode(config.type);
                                  } else {
                                    pinNode(config.type);
                                  }
                                }}
                                className={`p-1 rounded-lg transition-opacity ${
                                  isPinned ? 'opacity-100 text-amber-500' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-amber-500'
                                }`}
                                title={isPinned ? '取消固定' : '固定到右键菜单'}
                              >
                                {isPinned ? <Pin className="h-3.5 w-3.5" fill="currentColor" /> : <PinOff className="h-3.5 w-3.5" />}
                              </button>
                              <GripVertical className="h-3.5 w-3.5 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
