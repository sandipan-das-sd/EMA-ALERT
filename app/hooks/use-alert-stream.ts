import { useEffect, useRef } from "react";
import { APP_CONFIG } from "@/lib/config";
import { notifyOnCriticalAlert } from "@/services/notification-service";
import { getAlerts } from "@/lib/api";
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

export function useAlertStream(enabled = true) {
  const { state, dispatch } = useAlertContext();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptRef = useRef(0);
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const known = new Set<string>();
    for (const alert of state.alerts) {
      if (alert?.id) known.add(alert.id);
    }
    notifiedIdsRef.current = known;
  }, [state.alerts]);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "STREAM_DISCONNECTED" });
      return;
    }

    let alive = true;

    const upsertFromServer = async () => {
      try {
        const rows = await getAlerts({ status: "active", limit: 100 });
        dispatch({ type: "STREAM_POLL_SUCCESS" });
        for (const row of rows) {
          const parsed = toAlertPayload({
            userId: row.userId,
            instrumentKey: row.instrumentKey,
            instrumentName: row.instrumentName,
            timeframe: row.timeframe,
            strategy: row.strategy,
            candle: {
              ts: row.candle?.ts,
              close: row.candle?.close,
            },
            ema: row.ema,
            createdAt: row.createdAt,
          });
          if (!parsed) continue;

          const isNew = !notifiedIdsRef.current.has(parsed.id);
          dispatch({ type: "UPSERT_ALERT", payload: parsed });

          if (isNew) {
            notifiedIdsRef.current.add(parsed.id);
            await notifyOnCriticalAlert(parsed, state.preferences);
          }
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "alerts_poll_failed";
        dispatch({ type: "STREAM_POLL_FAILURE", error: reason });
        if (process.env.NODE_ENV !== "production") {
          console.warn("[App] Alerts poll failed", err);
        }
      }
    };

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

            if (data.type === "tick") {
              dispatch({
                type: "MARKET_TICK",
                payload: {
                  instrumentKey: data.instrumentKey,
                  ltp: data.ltp,
                  cp: data.cp,
                  changePct: data.changePct,
                },
              });
              dispatch({ type: "STREAM_HEARTBEAT" });
              return;
            }

            if (data.type === "quotes" && Array.isArray(data.data)) {
              dispatch({ type: "MARKET_QUOTES", payload: data.data });
              dispatch({ type: "STREAM_HEARTBEAT" });
              return;
            }

            if (data.type === "indices" && Array.isArray(data.data)) {
              dispatch({ type: "MARKET_INDICES", payload: data.data });
              dispatch({ type: "STREAM_HEARTBEAT" });
              return;
            }

            if (data.type === "info") {
              dispatch({ type: "STREAM_HEARTBEAT" });
              return;
            }

            if (data.type === "alert") {
              const parsed = toAlertPayload(data.alert);
              if (!parsed) return;
              notifiedIdsRef.current.add(parsed.id);
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

    upsertFromServer();
    pollTimerRef.current = setInterval(upsertFromServer, 15_000);
    connect();

    return () => {
      alive = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [enabled, dispatch, state.preferences]);
}
