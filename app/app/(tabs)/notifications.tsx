import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useMemo } from "react";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAlertContext } from "@/contexts/alert-context";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function NotificationsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { state, dispatch } = useAlertContext();

  const items = useMemo(() => state.alerts.slice(0, 100), [state.alerts]);

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <View style={styles.headerRow}>
        <View>
          <ThemedText type="title" style={styles.title}>Alerts</ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            {state.unreadCount} unread · {items.length} total
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.markReadBtn, { borderColor: palette.accent }]}
          onPress={() => dispatch({ type: "MARK_ALL_READ" })}>
          <ThemedText style={{ color: palette.accent, fontWeight: "700" }}>Mark Read</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.listWrap}>
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
                <ThemedText type="defaultSemiBold">{a.instrumentName}</ThemedText>
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
  listWrap: { paddingBottom: 36, gap: 10 },
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
});
