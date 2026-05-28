"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface SelectionContextValue {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  selectedIds: string[];
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function InvoiceSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      toggle,
      setAll,
      clear,
      isSelected: (id: string) => selected.has(id),
      selectedIds: Array.from(selected),
    }),
    [selected, toggle, setAll, clear]
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useInvoiceSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useInvoiceSelection must be used within InvoiceSelectionProvider");
  }
  return ctx;
}
