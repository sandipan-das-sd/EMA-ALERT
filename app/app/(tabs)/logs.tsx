import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { fetchAlertLogs, type AlertLog } from "@/lib/api";
import { showToast } from "@/lib/toast";

function formatIst(dateVal: string | number | undefined | null): string {
  if (!dateVal) return "—";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDelay(
  crossDetectedAt: string | number | undefined | null,
  notificationSentAt: string | number | undefined | null
): string {
  if (!crossDetectedAt || !notificationSentAt) return "—";
  const diff = new Date(notificationSentAt).getTime() - new Date(crossDetectedAt).getTime();
  if (isNaN(diff)) return "—";
  const s = Math.round(diff / 1000);
  if (s < 1) return "<1s";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function prettifyKey(key: string): string {
  if (!key) return key;
  const parts = key.split(/[|:]/);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1];
    if (/^\d+$/.test(tail)) return key;
    return tail.replace(/_/g, " ");
  }
  return key.replace(/_/g, " ");
}

type FilterType = "all" | "active" | "dismissed";

export default function LogsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const status = filter === "all" ? undefined : filter;
        const data = await fetchAlertLogs({ status, limit: 200 });
        setLogs(data);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Failed to load logs");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter]
  );

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.trim().toLowerCase();
    return logs.filter(
      (l) =>
        (l.instrumentKey ?? "").toLowerCase().includes(q) ||
        prettifyKey(l.instrumentKey ?? "")
          .toLowerCase()
          .includes(q) ||
        (l.strategy ?? "").toLowerCase().includes(q)
    );
  }, [logs, search]);

  const delayColor = (log: AlertLog) => {
    if (!log.crossDetectedAt || !log.notificationSentAt) return palette.muted;
    const s = Math.round(
      (new Date(log.notificationSentAt).getTime() -
        new Date(log.crossDetectedAt).getTime()) /
        1000
    );
    if (s <= 20) return palette.success;
    if (s <= 60) return palette.warning;
    return palette.danger;
  };

  const renderItem = ({ item: log }: { item: AlertLog }) => (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <ThemedText style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {prettifyKey(log.instrumentKey ?? "")}
        </ThemedText>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                log.status === "active" ? palette.success + "22" : palette.muted + "22",
            },
          ]}>
          <ThemedText
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: log.status === "active" ? palette.success : palette.muted,
            }}>
            {(log.status ?? "active").toUpperCase()}
          </ThemedText>
        </View>
      </View>

      {/* Candle info */}
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>Candle</ThemedText>
        <ThemedText style={[styles.val, { color: palette.text }]}>
          {formatIst(log.candle?.ts)}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>O/H/L/C</ThemedText>
        <ThemedText style={[styles.val, { color: palette.text }]}>
          {[log.candle?.open, log.candle?.high, log.candle?.low, log.candle?.close]
            .map((v) => (v != null ? Number(v).toFixed(2) : "—"))
            .join(" / ")}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>EMA 20</ThemedText>
        <ThemedText style={[styles.val, { color: palette.accent }]}>
          {log.ema != null ? Number(log.ema).toFixed(2) : "—"}
        </ThemedText>
      </View>

      {/* Timing */}
      <View style={[styles.divider, { backgroundColor: palette.border }]} />
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>Detected</ThemedText>
        <ThemedText style={[styles.val, { color: palette.text }]}>
          {formatIst(log.crossDetectedAt)}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>Notified</ThemedText>
        <ThemedText style={[styles.val, { color: palette.text }]}>
          {formatIst(log.notificationSentAt)}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <ThemedText style={[styles.label, { color: palette.muted }]}>Delay</ThemedText>
        <ThemedText style={[styles.val, { color: delayColor(log), fontWeight: "700" }]}>
          {formatDelay(log.crossDetectedAt, log.notificationSentAt)}
        </ThemedText>
      </View>
    </View>
  );

  return (
    <ThemedView
      style={[
        styles.container,
        { backgroundColor: palette.background, paddingTop: Math.max(insets.top, 10) },
      ]}>
      {/* Title */}
      <View style={styles.titleRow}>
        <View>
          <ThemedText type="title" style={styles.title}>
            Alert Logs
          </ThemedText>
          <ThemedText style={{ color: palette.muted, fontSize: 13 }}>
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.refreshBtn, { borderColor: palette.border, backgroundColor: palette.card }]}
          onPress={() => load(true)}
          disabled={refreshing}>
          <ThemedText style={{ color: palette.accent, fontWeight: "700" }}>
            {refreshing ? "..." : "↻ Refresh"}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchBox, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <ThemedText style={{ color: palette.muted, marginRight: 6 }}>🔍</ThemedText>
        <TextInput
          style={[styles.searchInput, { color: palette.text }]}
          placeholder="Search instrument…"
          placeholderTextColor={palette.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <ThemedText style={{ color: palette.muted, fontSize: 16 }}>✕</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills */}
      <View style={styles.filters}>
        {(["all", "active", "dismissed"] as FilterType[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.pill,
              {
                backgroundColor: filter === f ? palette.accent : palette.card,
                borderColor: filter === f ? palette.accent : palette.border,
              },
            ]}
            onPress={() => setFilter(f)}>
            <ThemedText
              style={{
                color: filter === f ? "#fff" : palette.muted,
                fontWeight: "700",
                fontSize: 13,
              }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.accent} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <ThemedText style={{ color: palette.muted, fontSize: 15 }}>No logs found</ThemedText>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) =>
            item._id ?? `${item.instrumentKey}::${item.candle?.ts}`
          }
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onRefresh={() => load(true)}
          refreshing={refreshing}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  title: { fontSize: 22, fontWeight: "800" },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  filters: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  name: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  label: { fontSize: 12, flex: 1 },
  val: { fontSize: 12, flex: 2, textAlign: "right" },
  divider: { height: 1, marginVertical: 8 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});
