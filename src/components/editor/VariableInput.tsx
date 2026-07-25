import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: string[];
  globalVariables?: string[];
  nodeVariables?: string[];
  multiline?: boolean;
}

export const VariableInput: React.FC<VariableInputProps> = ({ value, onChange, placeholder, variables, globalVariables, nodeVariables, multiline }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [hashStartPos, setHashStartPos] = useState<number | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'top' | 'bottom'>('bottom');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allVariables = useMemo(() => {
    const set = new Set<string>();
    if (globalVariables) globalVariables.forEach(v => set.add(v));
    if (nodeVariables) nodeVariables.forEach(v => set.add(v));
    variables.forEach(v => set.add(v));
    return Array.from(set);
  }, [variables, globalVariables, nodeVariables]);

  const filteredGlobalVars = useMemo(() =>
    (globalVariables || []).filter(v => v.toLowerCase().includes(filter.toLowerCase())),
    [globalVariables, filter]
  );

  const filteredNodeVars = useMemo(() =>
    (nodeVariables || []).filter(v => v.toLowerCase().includes(filter.toLowerCase())),
    [nodeVariables, filter]
  );

  const filteredOtherVars = useMemo(() => {
    const set = new Set([...(globalVariables || []), ...(nodeVariables || [])]);
    return variables.filter(v => !set.has(v) && v.toLowerCase().includes(filter.toLowerCase()));
  }, [variables, globalVariables, nodeVariables, filter]);

  const displayList = useMemo(() => {
    const list: { type: 'global' | 'node' | 'other'; name: string }[] = [];
    filteredGlobalVars.forEach((v) => list.push({ type: 'global', name: v }));
    filteredNodeVars.forEach((v) => list.push({ type: 'node', name: v }));
    filteredOtherVars.forEach((v) => list.push({ type: 'other', name: v }));
    return list;
  }, [filteredGlobalVars, filteredNodeVars, filteredOtherVars]);

  const filteredVariables = allVariables.filter((v) =>
    v.toLowerCase().includes(filter.toLowerCase())
  );

  const setCursorPosition = useCallback((pos: number) => {
    const input = inputRef.current;
    if (!input) return;
    requestAnimationFrame(() => {
      input.setSelectionRange(pos, pos);
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const input = e.currentTarget;
      const cursorPos = input.selectionStart ?? 0;

      if (e.key === 'Backspace') {
        if (cursorPos > 0) {
          const textBeforeCursor = value.slice(0, cursorPos);
          const varMatch = textBeforeCursor.match(/\{\{([\u4e00-\u9fa5\w.]+)\}\}$/);
          if (varMatch) {
            e.preventDefault();
            const varStart = cursorPos - varMatch[0].length;
            const newValue = value.slice(0, varStart) + value.slice(cursorPos);
            onChange(newValue);
            setCursorPosition(varStart);
            return;
          }
        }
      }

      if (!showDropdown || displayList.length === 0) {
        if (e.key === '#') {
          e.preventDefault();
          const newValue = value.slice(0, cursorPos) + '#' + value.slice(cursorPos);
          onChange(newValue);
          setHashStartPos(cursorPos);
          setShowDropdown(true);
          setFilter('');
          setSelectedIndex(0);
          setCursorPosition(cursorPos + 1);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < displayList.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (displayList[selectedIndex] && hashStartPos !== null) {
            const varText = `{{${displayList[selectedIndex].name}}}`;
            const newValue = value.slice(0, hashStartPos) + varText + value.slice(cursorPos);
            onChange(newValue);
            const newCursorPos = hashStartPos + varText.length;
            setCursorPosition(newCursorPos);
            setShowDropdown(false);
            setFilter('');
            setHashStartPos(null);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setShowDropdown(false);
          setFilter('');
          setHashStartPos(null);
          break;
        default:
          break;
      }
    },
    [showDropdown, displayList, selectedIndex, value, onChange, hashStartPos, setCursorPosition]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart ?? 0;
      
      let hashIdx = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (newValue[i] === '#') {
          hashIdx = i;
          break;
        }
        if (newValue[i] === ' ' || newValue[i] === '\n') {
          break;
        }
      }

      if (hashIdx !== -1) {
        setHashStartPos(hashIdx);
        setShowDropdown(true);
        setFilter(newValue.slice(hashIdx + 1, cursorPos));
        setSelectedIndex(0);
      } else {
        setShowDropdown(false);
        setFilter('');
        setHashStartPos(null);
      }
      onChange(newValue);
    },
    [onChange]
  );

  const handleSelect = useCallback(
    (variable: string) => {
      const input = inputRef.current;
      const cursorPos = input?.selectionStart ?? value.length;
      const startPos = hashStartPos ?? cursorPos - 1;
      
      const varText = `{{${variable}}}`;
      const newValue = value.slice(0, startPos) + varText + value.slice(cursorPos);
      onChange(newValue);
      
      const newCursorPos = startPos + varText.length;
      setCursorPosition(newCursorPos);
      
      setShowDropdown(false);
      setFilter('');
      setHashStartPos(null);
    },
    [value, onChange, hashStartPos, setCursorPosition]
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
          setShowDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showDropdown || !dropdownRef.current) return;

    const container = dropdownRef.current;
    const selectedEl = container.querySelector('[data-selected="true"]') as HTMLElement | null;
    if (selectedEl) {
      const containerRect = container.getBoundingClientRect();
      const elRect = selectedEl.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, showDropdown, displayList.length]);

  useEffect(() => {
    if (!multiline || !inputRef.current) return;
    const textarea = inputRef.current as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, multiline]);

  useEffect(() => {
    if (!showDropdown || !inputRef.current) return;

    const inputRect = inputRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;
    const spaceAbove = inputRect.top;
    const dropdownMaxHeight = 240;

    if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
      setDropdownPosition('top');
    } else {
      setDropdownPosition('bottom');
    }
  }, [showDropdown]);

  const renderHighlightedValue = () => {
    if (!value) return null;
    
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    
    const regex = /\{\{([\u4e00-\u9fa5\w.]+)\}\}/g;
    let match;
    
    while ((match = regex.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${key++}`} className="text-gray-800">
            {value.slice(lastIndex, match.index)}
          </span>
        );
      }
      parts.push(
        <span
          key={`var-${key++}`}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-mono text-xs border border-indigo-200 mx-0.5"
        >
          {match[1]}
        </span>
      );
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < value.length) {
      parts.push(
        <span key={`text-${key++}`} className="text-gray-800">
          {value.slice(lastIndex)}
        </span>
      );
    }
    
    return parts;
  };

  const hasVariables = /\{\{[\u4e00-\u9fa5\w.]+\}\}/.test(value);
  const showHighlighted = hasVariables && !isFocused && !showDropdown;

  return (
    <div className="relative">
      {showHighlighted ? (
        <div
          className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white ${
            multiline ? 'min-h-[80px] whitespace-pre-wrap resize-y overflow-hidden' : ''
          }`}
          onClick={() => inputRef.current?.focus()}
        >
          {renderHighlightedValue()}
          {!value && placeholder && (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </div>
      ) : null}
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white resize-y overflow-hidden min-h-[80px] ${
            showHighlighted ? 'absolute inset-0 opacity-0 cursor-text' : ''
          }`}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white ${
            showHighlighted ? 'absolute inset-0 opacity-0 cursor-text' : ''
          }`}
        />
      )}
      {showDropdown && displayList.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-64 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"
            style={{
              left: inputRef.current ? inputRef.current.getBoundingClientRect().left : 0,
              ...(dropdownPosition === 'bottom'
                ? { top: inputRef.current ? inputRef.current.getBoundingClientRect().bottom + 4 : 0 }
                : { bottom: inputRef.current ? window.innerHeight - inputRef.current.getBoundingClientRect().top + 4 : 0 }
              ),
            }}
          >
            {filteredGlobalVars.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-0">
                  全局变量
                </div>
                {filteredGlobalVars.map((variable) => {
                  const idx = displayList.findIndex((item) => item.type === 'global' && item.name === variable);
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={`global-${variable}`}
                      data-selected={isSelected}
                      onClick={() => handleSelect(variable)}
                      className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-700 hover:bg-indigo-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                        {variable}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
            {filteredNodeVars.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-0">
                  节点输出
                </div>
                {filteredNodeVars.map((variable) => {
                  const idx = displayList.findIndex((item) => item.type === 'node' && item.name === variable);
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={`node-${variable}`}
                      data-selected={isSelected}
                      onClick={() => handleSelect(variable)}
                      className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-700 hover:bg-indigo-50'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        {variable}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
            {filteredOtherVars.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-0">
                  其他变量
                </div>
                {filteredOtherVars.map((variable) => {
                  const idx = displayList.findIndex((item) => item.type === 'other' && item.name === variable);
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={`other-${variable}`}
                      data-selected={isSelected}
                      onClick={() => handleSelect(variable)}
                      className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-700 hover:bg-indigo-50'
                      }`}
                    >
                      {variable}
                    </div>
                  );
                })}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
