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
}

export type AlertAction =
  | { type: "STREAM_CONNECTED" }
  | { type: "STREAM_DISCONNECTED"; error?: string }
  | { type: "STREAM_MESSAGE" }
  | { type: "STREAM_HEARTBEAT" }
  | { type: "STREAM_RECONNECT_ATTEMPT"; attempt: number }
  | { type: "UPSERT_ALERT"; payload: EmaAlert }
  | { type: "MARK_ALL_READ" }
  | { type: "SET_PREFERENCES"; payload: Partial<AlertPreferences> };
