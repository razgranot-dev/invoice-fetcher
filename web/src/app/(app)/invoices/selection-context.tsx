"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { pruneSelection } from "@/lib/export-selection";

interface SelectionContextValue {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
  selectedIds: string[];
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function InvoiceSelectionProvider({
  children,
  visibleIds,
}: {
  children: ReactNode;
  /** IDs currently visible on the page. When provided, the selection is
   *  pruned to this set on every change — including the empty list, which
   *  InvoiceList never sees because it unmounts (M17): without pruning HERE,
   *  a filter change that empties the view would leave invisible rows
   *  exportable via the header buttons. */
  visibleIds?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visibleIds) return;
    // pruneSelection returns the SAME Set reference when nothing changed, so
    // this setter bails out without a re-render (no update loops).
    setSelected((prev) => pruneSelection(prev, visibleIds));
  }, [visibleIds]);

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
