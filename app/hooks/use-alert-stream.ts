import { useEffect, useRef } from "react";
import { APP_CONFIG } from "@/lib/config";
import { notifyOnCriticalAlert } from "@/services/notification-service";
import type { EmaAlert } from "@/types/alert";
import { useAlertContext } from "@/contexts/alert-context";

function toAlertPayload(input: any): EmaAlert | null {
  if (!input || typeof input !== "object") return null;
  if (!input.instrumentKey || !input.candle?.ts) return null;

  const id = `${input.userId || "anon"}:${input.instrumentKey}:${input.candle.ts}`;

  return {
    id,
    userId: input.userId,
    instrumentKey: input.instrumentKey,
    instrumentName: input.instrumentName || input.instrumentKey,
    timeframe: input.timeframe || "15m",
    strategy: input.strategy || "ema20_cross_up",
    candleTs: Number(input.candle.ts),
    close: Number(input.candle.close ?? 0),
    ema: Number(input.ema ?? 0),
    createdAt: input.createdAt || new Date().toISOString(),
    status: "active",
    source: "ws",
  };
}

export function useAlertStream() {
  const { state, dispatch } = useAlertContext();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const connect = () => {
      if (!alive) return;

      try {
        const socket = new WebSocket(APP_CONFIG.wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          attemptRef.current = 0;
          dispatch({ type: "STREAM_CONNECTED" });
        };

        socket.onmessage = async (event) => {
          dispatch({ type: "STREAM_MESSAGE" });

          try {
            const data = JSON.parse(event.data);

            if (data.type === "tick" || data.type === "info") {
              dispatch({ type: "STREAM_HEARTBEAT" });
              return;
            }

            if (data.type === "alert") {
              const parsed = toAlertPayload(data.alert);
              if (!parsed) return;
              dispatch({ type: "UPSERT_ALERT", payload: parsed });
              await notifyOnCriticalAlert(parsed, state.preferences);
            }
          } catch (err) {
            console.warn("[App] Stream parse error", err);
          }
        };

        socket.onerror = () => {
          dispatch({ type: "STREAM_DISCONNECTED", error: "Socket error" });
        };

        socket.onclose = () => {
          dispatch({ type: "STREAM_DISCONNECTED", error: "Socket closed" });

          attemptRef.current += 1;
          dispatch({ type: "STREAM_RECONNECT_ATTEMPT", attempt: attemptRef.current });

          const delay = Math.min(1000 * Math.pow(1.6, attemptRef.current), 15_000);
          reconnectTimerRef.current = setTimeout(connect, delay);
        };
      } catch (err) {
        dispatch({ type: "STREAM_DISCONNECTED", error: String(err) });
      }
    };

    connect();

    return () => {
      alive = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [dispatch, state.preferences]);
}
