import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  variables: string[];
}

export const VariableInput: React.FC<VariableInputProps> = ({ value, onChange, placeholder, variables }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredVariables = variables.filter((v) =>
    v.toLowerCase().includes(filter.toLowerCase())
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || filteredVariables.length === 0) {
        if (e.key === '#') {
          e.preventDefault();
          setShowDropdown(true);
          setFilter('');
          setSelectedIndex(0);
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
          if (filteredVariables[selectedIndex]) {
            onChange(value + filteredVariables[selectedIndex]);
            setShowDropdown(false);
            setFilter('');
          }
          break;
        case 'Escape':
          e.preventDefault();
          setShowDropdown(false);
          setFilter('');
          break;
        default:
          break;
      }
    },
    [showDropdown, filteredVariables, selectedIndex, value, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      const lastHashIndex = newValue.lastIndexOf('#');
      if (lastHashIndex !== -1 && lastHashIndex === newValue.length - 1) {
        setShowDropdown(true);
        setFilter('');
        setSelectedIndex(0);
      } else if (lastHashIndex !== -1 && lastHashIndex < newValue.length - 1) {
        setShowDropdown(true);
        setFilter(newValue.slice(lastHashIndex + 1));
        setSelectedIndex(0);
      } else {
        setShowDropdown(false);
        setFilter('');
      }
      onChange(newValue);
    },
    [onChange]
  );

  const handleSelect = useCallback(
    (variable: string) => {
      const lastHashIndex = value.lastIndexOf('#');
      if (lastHashIndex !== -1) {
        onChange(value.slice(0, lastHashIndex) + variable);
      } else {
        onChange(value + variable);
      }
      setShowDropdown(false);
      setFilter('');
    },
    [value, onChange]
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

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all bg-white"
      />
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
