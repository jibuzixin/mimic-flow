import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: string[];
  multiline?: boolean;
}

export const VariableInput: React.FC<VariableInputProps> = ({ value, onChange, placeholder, variables, multiline }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [hashStartPos, setHashStartPos] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredVariables = variables.filter((v) =>
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
          const varMatch = textBeforeCursor.match(/\{\{([\w.]+)\}\}$/);
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

      if (!showDropdown || filteredVariables.length === 0) {
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
            prev < filteredVariables.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredVariables[selectedIndex] && hashStartPos !== null) {
            const varText = `{{${filteredVariables[selectedIndex]}}}`;
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
    [showDropdown, filteredVariables, selectedIndex, value, onChange, hashStartPos, setCursorPosition]
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

  const renderHighlightedValue = () => {
    if (!value) return null;
    
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    
    const regex = /\{\{([\w.]+)\}\}/g;
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

  const hasVariables = /\{\{[\w.]+\}\}/.test(value);
  const showHighlighted = hasVariables && !isFocused && !showDropdown;

  return (
    <div className="relative">
      {showHighlighted ? (
        <div
          className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white ${
            multiline ? 'min-h-[80px] whitespace-pre-wrap' : ''
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
          rows={4}
          className={`w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white resize-none ${
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
      {showDropdown && filteredVariables.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-64 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl"
            style={{
              left: inputRef.current ? inputRef.current.getBoundingClientRect().left : 0,
              top: inputRef.current ? inputRef.current.getBoundingClientRect().bottom + 4 : 0,
            }}
          >
            <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
              可用变量
            </div>
            {filteredVariables.map((variable, index) => (
              <div
                key={variable}
                onClick={() => handleSelect(variable)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 transition-colors ${
                  index === selectedIndex ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                }`}
              >
                {variable}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
