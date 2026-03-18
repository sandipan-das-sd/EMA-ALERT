import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DEFAULT_WATCHLIST = [
  'NSE_EQ|RELIANCE',
  'NSE_EQ|TCS',
  'NSE_EQ|INFY',
  'NSE_EQ|HDFCBANK',
  'NSE_EQ|ICICIBANK',
  'NSE_EQ|SBIN',
];

export default function WatchlistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ScrollView
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 10), paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}>
      <ThemedText type="title" style={styles.title}>Watchlist</ThemedText>
      <ThemedText style={{ color: palette.muted }}>
        Quick monitor for priority instruments and their latest EMA-cross activity.
      </ThemedText>

      <View style={styles.list}>
        {DEFAULT_WATCHLIST.map((symbol) => {
          const hit = state.alerts.find((a) => a.instrumentKey === symbol || a.instrumentName === symbol);
          return (
            <ThemedView
              key={symbol}
              style={[styles.item, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <View style={styles.rowHead}>
                <ThemedText type="defaultSemiBold">{symbol.replace('NSE_EQ|', '')}</ThemedText>
                <ThemedText style={{ color: hit ? palette.success : palette.muted }}>
                  {hit ? 'Signal Seen' : 'Waiting'}
                </ThemedText>
              </View>
              <ThemedText style={{ color: palette.muted, marginTop: 6 }}>
                {hit
                  ? `Latest: Close ${hit.close.toFixed(2)} / EMA ${hit.ema.toFixed(2)}`
                  : 'No crossover received in this session'}
              </ThemedText>
            </ThemedView>
          );
        })}
      </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    marginBottom: 6,
  },
  list: {
    marginTop: 14,
    gap: 10,
  },
  item: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
