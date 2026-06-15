"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { label: string; value: string }[];
  searchable?: boolean;
  value: string;
  onValueChange?: (value: string) => void;
}

export function Select({ label, options, searchable, value, onValueChange, className, ...props }: SelectProps) {
  const [query, setQuery] = React.useState("");
  const filteredOptions = React.useMemo(
    () => options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()) || option.value.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <label className="block text-sm font-medium text-slate-800">{label}</label>
      {searchable ? (
        <div className="space-y-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search properties..."
            className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
          <select
            value={value}
            onChange={(event) => {
              onValueChange?.(event.target.value);
            }}
            className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            {...props}
          >
            <option value="">Unmapped</option>
            {filteredOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <select
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
          className="flex h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          {...props}
        >
          <option value="">Unmapped</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
