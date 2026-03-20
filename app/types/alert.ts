export type AlertStatus = "active" | "dismissed";

export interface EmaAlert {
  id: string;
  userId?: string;
  instrumentKey: string;
  instrumentName: string;
  timeframe: string;
  strategy: string;
  candleTs: number;
  close: number;
  ema: number;
  createdAt: string;
  status: AlertStatus;
  source: "ws" | "api";
}

export interface StreamStatus {
  connected: boolean;
  reconnectAttempt: number;
  lastHeartbeatAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
  lastAlertsPollAt: string | null;
  lastAlertsPollError: string | null;
  pushRegistration: {
    status: "idle" | "registering" | "registered" | "failed" | "expo_go";
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: string | null;
  };
}

export interface AlertPreferences {
  vibrationEnabled: boolean;
  hapticsEnabled: boolean;
  inAppSoundEnabled: boolean;
  pushNotificationsEnabled: boolean;
}

export interface AlertState {
  alerts: EmaAlert[];
  unreadCount: number;
  stream: StreamStatus;
  preferences: AlertPreferences;
  market: {
    indices: Record<string, { ltp?: number | null; cp?: number | null; changePct?: number | null }>;
    quotes: Record<string, { last_price?: number; cp?: number | null; ltp?: number | null; changePct?: number | null }>;
    lastUpdateAt: string | null;
  };
}

export type AlertAction =
  | { type: "STREAM_CONNECTED" }
  | { type: "STREAM_DISCONNECTED"; error?: string }
  | { type: "STREAM_MESSAGE" }
  | { type: "STREAM_HEARTBEAT" }
  | { type: "STREAM_RECONNECT_ATTEMPT"; attempt: number }
  | { type: "STREAM_POLL_SUCCESS" }
  | { type: "STREAM_POLL_FAILURE"; error: string }
  | {
      type: "PUSH_REGISTRATION_STATUS";
      payload: {
        status: "idle" | "registering" | "registered" | "failed" | "expo_go";
        error?: string | null;
      };
    }
  | { type: "UPSERT_ALERT"; payload: EmaAlert }
  | { type: "MARK_ALL_READ" }
  | { type: "SET_PREFERENCES"; payload: Partial<AlertPreferences> }
  | { type: "HYDRATE_PREFERENCES"; payload: AlertPreferences }
  | { type: "MARKET_TICK"; payload: { instrumentKey?: string; ltp?: number | null; cp?: number | null; changePct?: number | null } }
  | {
      type: "MARKET_QUOTES";
      payload: Array<{
        key?: string;
        instrumentKey?: string;
        ltp?: number | null;
        last_price?: number;
        cp?: number | null;
        changePct?: number | null;
      }>;
    }
  | {
      type: "MARKET_INDICES";
      payload: Array<{ key?: string; ltp?: number | null; cp?: number | null; changePct?: number | null }>;
    };
