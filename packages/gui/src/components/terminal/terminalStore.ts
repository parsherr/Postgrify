/**
 * Terminal tab store — useReducer tabanlı, her tab bağımsız.
 * Tab tipleri: "shell" | "sql"
 */

import { useReducer, useCallback } from "react";

export type TerminalType = "shell" | "sql";

export interface TerminalTab {
  id: string;
  type: TerminalType;
  title: string;
  /** SQL terminal için seçili DB */
  selectedDb?: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  /** Panel açık mı (header dışındaki alan) */
  open: boolean;
}

type Action =
  | { type: "ADD_TAB"; tab: TerminalTab }
  | { type: "REMOVE_TAB"; id: string }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "SET_OPEN"; open: boolean }
  | { type: "SET_DB"; id: string; db: string };

let counter = 1;
export function nextTabId() {
  return `tab-${counter++}`;
}

function reducer(state: TerminalState, action: Action): TerminalState {
  switch (action.type) {
    case "ADD_TAB": {
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeId: action.tab.id,
        open: true,
      };
    }
    case "REMOVE_TAB": {
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeId = state.activeId;
      if (activeId === action.id) {
        // Bir sonraki veya önceki sekmeye geç
        const idx = state.tabs.findIndex((t) => t.id === action.id);
        activeId = tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null;
      }
      return { ...state, tabs, activeId };
    }
    case "SET_ACTIVE":
      return { ...state, activeId: action.id };
    case "SET_OPEN":
      return { ...state, open: action.open };
    case "SET_DB": {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, selectedDb: action.db } : t
        ),
      };
    }
    default:
      return state;
  }
}

const INITIAL: TerminalState = {
  tabs: [],
  activeId: null,
  open: false,
};

export function useTerminalStore() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const addTab = useCallback((type: TerminalType) => {
    const id = nextTabId();
    const title = type === "shell" ? `Shell ${id}` : `SQL ${id}`;
    dispatch({ type: "ADD_TAB", tab: { id, type, title } });
  }, []);

  const removeTab = useCallback((id: string) => {
    dispatch({ type: "REMOVE_TAB", id });
  }, []);

  const setActive = useCallback((id: string) => {
    dispatch({ type: "SET_ACTIVE", id });
  }, []);

  const setOpen = useCallback((open: boolean) => {
    dispatch({ type: "SET_OPEN", open });
  }, []);

  const setDb = useCallback((id: string, db: string) => {
    dispatch({ type: "SET_DB", id, db });
  }, []);

  return { state, addTab, removeTab, setActive, setOpen, setDb };
}