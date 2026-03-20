import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAlertContext } from "@/contexts/alert-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { dismissAlertById, dismissAllAlerts, getWatchlist, type WatchlistItem } from "@/lib/api";
import { showToast } from "@/lib/toast";

function keyVariants(key: string): string[] {
  const out = [key];
  if (key.includes("|")) out.push(key.replace("|", ":"));
  if (key.includes(":")) out.push(key.replace(":", "|"));
  return out;
}

function prettifyKey(key: string) {
  if (!key) return key;
  const parts = key.split(/[|:]/);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1];
    if (/^\d+$/.test(tail)) {
      return key;
    }
    return tail.replace(/_/g, " ");
  }
  return key.replace(/_/g, " ");
}

export default function NotificationsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { state, dispatch } = useAlertContext();
  const insets = useSafeAreaInsets();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  const items = useMemo(() => state.alerts.filter((a) => a.status !== "dismissed").slice(0, 100), [state.alerts]);

  const watchlistNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of watchlist) {
      const label = item.tradingSymbol || item.name || "";
      if (!label) continue;
      for (const variant of keyVariants(String(item.key || ""))) {
        map.set(variant, label);
      }
    }
    return map;
  }, [watchlist]);

  const getReadableName = (instrumentKey: string, currentName: string) => {
    const mapped = watchlistNameMap.get(instrumentKey);
    if (mapped) return mapped;

    if (currentName && currentName !== instrumentKey) return currentName;

    return prettifyKey(instrumentKey);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const items = await getWatchlist();
        if (mounted) setWatchlist(items || []);
      } catch {
        // Keep UI functional even if watchlist name lookup fails.
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleDeleteOne(alertId: string) {
    setBusyId(alertId);
    try {
      await dismissAlertById(alertId);
      dispatch({ type: "REMOVE_ALERT", id: alertId });
      showToast("Alert deleted");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete alert");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteAll() {
    setClearingAll(true);
    try {
      await dismissAllAlerts();
      dispatch({ type: "CLEAR_ALERTS" });
      showToast("All alerts deleted");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete all alerts");
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background, paddingTop: Math.max(insets.top, 10) }]}> 
      <View style={styles.headerRow}>
        <View>
          <ThemedText type="title" style={styles.title}>Alerts</ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            {state.unreadCount} unread · {items.length} in timeline
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.markReadBtn, { borderColor: palette.accent }]}
          onPress={() => dispatch({ type: "MARK_ALL_READ" })}>
          <ThemedText style={{ color: palette.accent, fontWeight: "700" }}>Mark Read</ThemedText>
        </TouchableOpacity>
      </View>

      {items.length > 0 ? (
        <TouchableOpacity
          style={[styles.clearAllBtn, { borderColor: palette.border, backgroundColor: palette.card }]}
          onPress={handleDeleteAll}
          disabled={clearingAll}>
          <ThemedText style={{ color: palette.text, fontWeight: "700" }}>
            {clearingAll ? "Deleting..." : "Delete All"}
          </ThemedText>
        </TouchableOpacity>
      ) : null}

      <ScrollView contentContainerStyle={[styles.listWrap, { paddingBottom: insets.bottom + 90 }]}>
        {items.length === 0 ? (
          <ThemedView style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
            <ThemedText type="subtitle">No Alerts Yet</ThemedText>
            <ThemedText style={{ color: palette.muted }}>Live EMA crossover events will appear here.</ThemedText>
          </ThemedView>
        ) : (
          items.map((a) => (
            <ThemedView
              key={a.id}
              style={[styles.alertCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <View style={styles.alertTop}>
                <ThemedText type="defaultSemiBold">{getReadableName(a.instrumentKey, a.instrumentName)}</ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  {new Date(a.createdAt).toLocaleTimeString()}
                </ThemedText>
              </View>
              <ThemedText style={{ color: palette.muted, marginTop: 4 }}>
                {a.strategy} · {a.timeframe}
              </ThemedText>
              <ThemedText style={{ marginTop: 8 }}>
                Close {a.close.toFixed(2)} crossed EMA {a.ema.toFixed(2)}
              </ThemedText>
              <ThemedText style={{ color: palette.muted, marginTop: 4, fontSize: 12 }}>
                Instrument: {a.instrumentKey}
              </ThemedText>
              <View style={styles.alertActions}>
                <TouchableOpacity
                  style={[styles.deleteBtn, { borderColor: palette.border }]}
                  onPress={() => handleDeleteOne(a.id)}
                  disabled={busyId === a.id}>
                  <ThemedText style={{ color: palette.text, fontWeight: "700" }}>
                    {busyId === a.id ? "Deleting..." : "Delete"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </ThemedView>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 18 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: { fontSize: 28, lineHeight: 34 },
  markReadBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearAllBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    alignItems: "center",
  },
  listWrap: { gap: 10 },
  alertCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  alertTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  alertActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  deleteBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
});
