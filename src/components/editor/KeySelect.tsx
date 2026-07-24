import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { KEY_OPTIONS, KEY_CATEGORY_LABELS, type KeyOption } from './keyOptions';

interface KeySelectProps {
  value: string;
  onChange: (value: string) => void;
}

export const KeySelect: React.FC<KeySelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(() => {
    if (!filter) return KEY_OPTIONS;
    const lower = filter.toLowerCase();
    return KEY_OPTIONS.filter(
      (opt) =>
        opt.value.toLowerCase().includes(lower) ||
        opt.label.toLowerCase().includes(lower)
    );
  }, [filter]);

  const groupedOptions = useMemo(() => {
    const groups: Record<string, KeyOption[]> = {};
    for (const opt of filteredOptions) {
      if (!groups[opt.category]) {
        groups[opt.category] = [];
      }
      groups[opt.category].push(opt);
    }
    return groups;
  }, [filteredOptions]);

  const flatList = useMemo(() => {
    const list: KeyOption[] = [];
    const order = ['function', 'navigation', 'editing', 'modifier', 'letter', 'number', 'numpad', 'symbol', 'media'];
    for (const cat of order) {
      if (groupedOptions[cat]) {
        list.push(...groupedOptions[cat]);
      }
    }
    return list;
  }, [groupedOptions]);

  const currentLabel = useMemo(() => {
    const opt = KEY_OPTIONS.find((o) => o.value === value);
    return opt ? opt.label : value;
  }, [value]);

  const handleSelect = useCallback(
    (optValue: string) => {
      onChange(optValue);
      setIsOpen(false);
      setFilter('');
      setSelectedIndex(0);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault();
          setIsOpen(true);
          setSelectedIndex(0);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatList.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            handleSelect(flatList[selectedIndex].value);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setFilter('');
          break;
        default:
          break;
      }
    },
    [isOpen, flatList, selectedIndex, handleSelect]
  );

  useEffect(() => {
    if (!isOpen || !dropdownRef.current) return;
    const container = dropdownRef.current;
    const selectedEl = container.querySelector('[data-selected="true"]') as HTMLElement | null;
    if (selectedEl) {
      const containerRect = container.getBoundingClientRect();
      const elRect = selectedEl.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, isOpen, flatList.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const categoryOrder = ['function', 'navigation', 'editing', 'modifier', 'letter', 'number', 'numpad', 'symbol', 'media'];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-200 rounded-xl hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white text-left"
      >
        <span className="font-mono text-gray-700">{currentLabel || '选择按键'}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-64 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"
            style={{
              left: containerRef.current ? containerRef.current.getBoundingClientRect().left : 0,
              top: containerRef.current
                ? containerRef.current.getBoundingClientRect().bottom + 4
                : 0,
            }}
          >
            <div className="p-2 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索按键..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-gray-50"
                />
              </div>
            </div>

            {flatList.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">
                没有匹配的按键
              </div>
            ) : (
              categoryOrder.map((cat) => {
                const items = groupedOptions[cat];
                if (!items || items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-[38px]">
                      {KEY_CATEGORY_LABELS[cat]}
                    </div>
                    {items.map((opt) => {
                      const idx = flatList.findIndex((o) => o.value === opt.value);
                      const isSelected = idx === selectedIndex;
                      return (
                        <div
                          key={opt.value}
                          data-selected={isSelected}
                          onClick={() => handleSelect(opt.value)}
                          className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'text-gray-700 hover:bg-indigo-50'
                          }`}
                        >
                          <span className="font-mono">{opt.label}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
