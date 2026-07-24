import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';

interface VarNameInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: string[];
  globalVariables?: string[];
  nodeVariables?: string[];
}

const VAR_NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z_][\u4e00-\u9fa5a-zA-Z0-9_]*$/;

export const isValidVarName = (name: string): boolean => {
  if (!name) return false;
  return VAR_NAME_REGEX.test(name);
};

export const VarNameInput: React.FC<VarNameInputProps> = ({
  value,
  onChange,
  placeholder,
  variables,
  globalVariables,
  nodeVariables,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hashStartPos, setHashStartPos] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredGlobalVars = useMemo(
    () =>
      (globalVariables || []).filter((v) =>
        v.toLowerCase().includes(filter.toLowerCase()),
      ),
    [globalVariables, filter],
  );

  const filteredNodeVars = useMemo(
    () =>
      (nodeVariables || []).filter((v) =>
        v.toLowerCase().includes(filter.toLowerCase()),
      ),
    [nodeVariables, filter],
  );

  const filteredOtherVars = useMemo(() => {
    const set = new Set([...(globalVariables || []), ...(nodeVariables || [])]);
    return variables.filter(
      (v) => !set.has(v) && v.toLowerCase().includes(filter.toLowerCase()),
    );
  }, [variables, globalVariables, nodeVariables, filter]);

  const displayList = useMemo(() => {
    const list: { type: 'global' | 'node' | 'other'; name: string }[] = [];
    filteredGlobalVars.forEach((v) => list.push({ type: 'global', name: v }));
    filteredNodeVars.forEach((v) => list.push({ type: 'node', name: v }));
    filteredOtherVars.forEach((v) => list.push({ type: 'other', name: v }));
    return list;
  }, [filteredGlobalVars, filteredNodeVars, filteredOtherVars]);

  const hasError = value !== '' && !isValidVarName(value);

  const setCursorPosition = useCallback((pos: number) => {
    const input = inputRef.current;
    if (!input) return;
    requestAnimationFrame(() => {
      input.setSelectionRange(pos, pos);
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const cursorPos = input.selectionStart ?? 0;

      if (!showDropdown || displayList.length === 0) {
        if (e.key === '#') {
          e.preventDefault();
          const newValue =
            value.slice(0, cursorPos) + '#' + value.slice(cursorPos);
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
            prev < displayList.length - 1 ? prev + 1 : prev,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (displayList[selectedIndex] && hashStartPos !== null) {
            const varName = displayList[selectedIndex].name;
            const newValue =
              value.slice(0, hashStartPos) +
              varName +
              value.slice(cursorPos);
            onChange(newValue);
            const newCursorPos = hashStartPos + varName.length;
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
    [
      showDropdown,
      displayList,
      selectedIndex,
      value,
      onChange,
      hashStartPos,
      setCursorPosition,
    ],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let newValue = e.target.value;
      const cursorPos = e.target.selectionStart ?? 0;

      newValue = newValue.replace(/\{\{|\}\}/g, '');

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
    [onChange],
  );

  const handleSelect = useCallback(
    (variable: string) => {
      const input = inputRef.current;
      const cursorPos = input?.selectionStart ?? value.length;
      const startPos = hashStartPos ?? cursorPos - 1;

      const newValue =
        value.slice(0, startPos) + variable + value.slice(cursorPos);
      onChange(newValue);

      const newCursorPos = startPos + variable.length;
      setCursorPosition(newCursorPos);

      setShowDropdown(false);
      setFilter('');
      setHashStartPos(null);
    },
    [value, onChange, hashStartPos, setCursorPosition],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
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
    const selectedEl = container.querySelector(
      '[data-selected="true"]',
    ) as HTMLElement | null;
    if (selectedEl) {
      const containerRect = container.getBoundingClientRect();
      const elRect = selectedEl.getBoundingClientRect();
      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, showDropdown, displayList.length]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`w-full px-3 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 transition-all bg-white font-mono ${
            hasError
              ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500 pr-9'
              : 'border-gray-200 focus:ring-indigo-500/20 focus:border-indigo-500'
          }`}
        />
        {hasError && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <AlertCircle className="h-4 w-4 text-red-500" />
          </div>
        )}
      </div>
      {hasError && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          变量名不合法：只能包含中文、字母、数字、下划线，且不能以数字开头
        </p>
      )}
      {showDropdown &&
        displayList.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-64 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"
            style={{
              left: inputRef.current
                ? inputRef.current.getBoundingClientRect().left
                : 0,
              top: inputRef.current
                ? inputRef.current.getBoundingClientRect().bottom + 4
                : 0,
            }}
          >
            {filteredGlobalVars.length > 0 && (
              <>
                <div className="px-3 py-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-0">
                  全局变量
                </div>
                {filteredGlobalVars.map((variable) => {
                  const idx = displayList.findIndex(
                    (item) => item.type === 'global' && item.name === variable,
                  );
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
                  const idx = displayList.findIndex(
                    (item) => item.type === 'node' && item.name === variable,
                  );
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
                  const idx = displayList.findIndex(
                    (item) => item.type === 'other' && item.name === variable,
                  );
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
          document.body,
        )}
    </div>
  );
};
