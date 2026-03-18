import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();

  const latest = state.alerts[0];

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ThemedView style={[styles.hero, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="title" style={styles.heroTitle}>EMA Alert Control</ThemedText>
        <ThemedText style={{ color: palette.muted, marginTop: 6 }}>
          Monitor crossover signals with live websocket feed and mobile notification control.
        </ThemedText>
      </ThemedView>

      <View style={styles.statsRow}>
        <ThemedView style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <ThemedText style={{ color: palette.muted }}>Live Alerts</ThemedText>
          <ThemedText type="title" style={styles.metric}>{state.alerts.length}</ThemedText>
        </ThemedView>
        <ThemedView style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <ThemedText style={{ color: palette.muted }}>Unread</ThemedText>
          <ThemedText type="title" style={styles.metric}>{state.unreadCount}</ThemedText>
        </ThemedView>
      </View>

      <ThemedView style={[styles.statusCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="subtitle">Connection Status</ThemedText>
        <ThemedText style={styles.statusText}>
          WebSocket: {state.stream.connected ? 'Connected' : 'Disconnected'}
        </ThemedText>
        <ThemedText style={styles.statusText}>
          Last Message: {state.stream.lastMessageAt ? new Date(state.stream.lastMessageAt).toLocaleTimeString() : 'No data'}
        </ThemedText>
        <ThemedText style={styles.statusText}>
          Reconnect Attempts: {state.stream.reconnectAttempt}
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.latestCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="subtitle">Latest Signal</ThemedText>
        {latest ? (
          <>
            <ThemedText style={{ marginTop: 8 }}>
              {latest.instrumentName} · {latest.strategy}
            </ThemedText>
            <ThemedText style={styles.statusText}>
              Close {latest.close.toFixed(2)} crossed EMA {latest.ema.toFixed(2)}
            </ThemedText>
            <ThemedText style={styles.statusText}>
              {new Date(latest.createdAt).toLocaleString()}
            </ThemedText>
          </>
        ) : (
          <ThemedText style={styles.statusText}>No signal received yet.</ThemedText>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  hero: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  metric: {
    fontSize: 30,
    lineHeight: 34,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  latestCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  statusText: {
    opacity: 0.75,
    fontSize: 13,
    lineHeight: 20,
  },
});
