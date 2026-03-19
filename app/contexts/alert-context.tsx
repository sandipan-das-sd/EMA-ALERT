import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { PropsWithChildren } from "react";
import type { Dispatch } from "react";
import type { AlertAction, AlertState, EmaAlert } from "@/types/alert";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFERENCES_STORAGE_KEY = "ema_alert_preferences_v1";

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
    pushNotificationsEnabled: true,
  },
  market: {
    indices: {},
    quotes: {},
    lastUpdateAt: null,
  },
};

function keyVariants(key: string): string[] {
  const out = [key];
  if (key.includes("|")) out.push(key.replace("|", ":"));
  if (key.includes(":")) out.push(key.replace(":", "|"));
  return out;
}

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

    case "HYDRATE_PREFERENCES":
      return {
        ...state,
        preferences: {
          ...state.preferences,
          ...action.payload,
        },
      };

    case "MARKET_TICK": {
      const key = String(action.payload.instrumentKey || "").trim();
      if (!key) return state;

      const nextQuotes = { ...state.market.quotes };
      keyVariants(key).forEach((variant) => {
        nextQuotes[variant] = {
          ...nextQuotes[variant],
          ltp: action.payload.ltp,
          last_price: typeof action.payload.ltp === "number" ? action.payload.ltp : nextQuotes[variant]?.last_price,
          cp: action.payload.cp,
          changePct: action.payload.changePct,
        };
      });

      return {
        ...state,
        market: {
          ...state.market,
          quotes: nextQuotes,
          lastUpdateAt: new Date().toISOString(),
        },
      };
    }

    case "MARKET_QUOTES": {
      const nextQuotes = { ...state.market.quotes };
      for (const q of action.payload || []) {
        const rawKey = String(q.key || q.instrumentKey || "").trim();
        if (!rawKey) continue;

        const ltp = typeof q.last_price === "number" ? q.last_price : q.ltp;
        keyVariants(rawKey).forEach((variant) => {
          nextQuotes[variant] = {
            ...nextQuotes[variant],
            ...q,
            ltp,
            last_price: typeof ltp === "number" ? ltp : nextQuotes[variant]?.last_price,
          };
        });
      }

      return {
        ...state,
        market: {
          ...state.market,
          quotes: nextQuotes,
          lastUpdateAt: new Date().toISOString(),
        },
      };
    }

    case "MARKET_INDICES": {
      const nextIndices = { ...state.market.indices };
      for (const idx of action.payload || []) {
        const rawKey = String(idx.key || "").trim();
        if (!rawKey) continue;

        keyVariants(rawKey).forEach((variant) => {
          nextIndices[variant] = {
            ltp: idx.ltp,
            cp: idx.cp,
            changePct: idx.changePct,
          };
        });
      }

      return {
        ...state,
        market: {
          ...state.market,
          indices: nextIndices,
          lastUpdateAt: new Date().toISOString(),
        },
      };
    }

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
  const hydratedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (!mounted) return;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            dispatch({ type: "HYDRATE_PREFERENCES", payload: parsed });
          }
        }
      } catch (err) {
        console.warn("[Preferences] Failed to hydrate", err);
      } finally {
        hydratedRef.current = true;
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(state.preferences)).catch((err) => {
      console.warn("[Preferences] Failed to persist", err);
    });
  }, [state.preferences]);

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
