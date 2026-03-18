import { createContext, useContext, useMemo, useReducer } from "react";
import type { PropsWithChildren } from "react";
import type { Dispatch } from "react";
import type { AlertAction, AlertState, EmaAlert } from "@/types/alert";

const initialState: AlertState = {
  alerts: [],
  unreadCount: 0,
  stream: {
    connected: false,
    reconnectAttempt: 0,
    lastHeartbeatAt: null,
    lastMessageAt: null,
    lastError: null,
  },
  preferences: {
    vibrationEnabled: true,
    hapticsEnabled: true,
    inAppSoundEnabled: false,
  },
};

function mergeAlert(list: EmaAlert[], next: EmaAlert): EmaAlert[] {
  const idx = list.findIndex((a) => a.id === next.id);
  if (idx === -1) {
    return [next, ...list].slice(0, 200);
  }

  const updated = [...list];
  updated[idx] = { ...updated[idx], ...next };
  return updated.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function reducer(state: AlertState, action: AlertAction): AlertState {
  switch (action.type) {
    case "STREAM_CONNECTED":
      return {
        ...state,
        stream: {
          ...state.stream,
          connected: true,
          lastError: null,
          reconnectAttempt: 0,
        },
      };

    case "STREAM_DISCONNECTED":
      return {
        ...state,
        stream: {
          ...state.stream,
          connected: false,
          lastError: action.error || state.stream.lastError,
        },
      };

    case "STREAM_MESSAGE":
      return {
        ...state,
        stream: {
          ...state.stream,
          lastMessageAt: new Date().toISOString(),
        },
      };

    case "STREAM_HEARTBEAT":
      return {
        ...state,
        stream: {
          ...state.stream,
          lastHeartbeatAt: new Date().toISOString(),
        },
      };

    case "STREAM_RECONNECT_ATTEMPT":
      return {
        ...state,
        stream: {
          ...state.stream,
          reconnectAttempt: action.attempt,
        },
      };

    case "UPSERT_ALERT": {
      const exists = state.alerts.some((a) => a.id === action.payload.id);
      return {
        ...state,
        alerts: mergeAlert(state.alerts, action.payload),
        unreadCount: exists ? state.unreadCount : state.unreadCount + 1,
      };
    }

    case "MARK_ALL_READ":
      return { ...state, unreadCount: 0 };

    case "SET_PREFERENCES":
      return {
        ...state,
        preferences: {
          ...state.preferences,
          ...action.payload,
        },
      };

    default:
      return state;
  }
}

interface AlertContextValue {
  state: AlertState;
  dispatch: Dispatch<AlertAction>;
}

const AlertContext = createContext<AlertContextValue | null>(null);

export function AlertProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

export function useAlertContext() {
  const value = useContext(AlertContext);
  if (!value) {
    throw new Error("useAlertContext must be used within AlertProvider");
  }
  return value;
}
