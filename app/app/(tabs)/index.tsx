import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getMarketSnapshot, getWatchlist, type MarketIndexItem, type WatchlistItem } from '@/lib/api';

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();
  const insets = useSafeAreaInsets();
  const [indices, setIndices] = useState<MarketIndexItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');

  const latest = state.alerts[0];

  const loadDashboardMarketData = useCallback(async () => {
    setMarketError('');

    const [indicesResult, watchlistResult] = await Promise.allSettled([
      getMarketSnapshot(),
      getWatchlist(),
    ]);

    const errorParts: string[] = [];

    if (indicesResult.status === 'fulfilled') {
      setIndices(indicesResult.value || []);
    } else {
      setIndices([]);
      errorParts.push(indicesResult.reason instanceof Error ? indicesResult.reason.message : 'Failed to load market indices');
    }

    if (watchlistResult.status === 'fulfilled') {
      setWatchlist(watchlistResult.value || []);
    } else {
      setWatchlist([]);
      errorParts.push(watchlistResult.reason instanceof Error ? watchlistResult.reason.message : 'Failed to load watchlist prices');
    }

    if (errorParts.length) {
      setMarketError(errorParts.join(' | '));
    }

    setMarketLoading(false);
  }, []);

  useEffect(() => {
    loadDashboardMarketData();
    const timer = setInterval(loadDashboardMarketData, 12_000);
    return () => clearInterval(timer);
  }, [loadDashboardMarketData]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardMarketData();
    }, [loadDashboardMarketData])
  );

  const topIndices = (() => {
    const keyNorm = (k?: string | null) => String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const n50 = indices.find((x) => {
      const k = keyNorm(x.key);
      return k.includes('nifty 50') || k.endsWith('|nifty50') || k.includes('nifty50');
    });
    const nb = indices.find((x) => {
      const k = keyNorm(x.key);
      return k.includes('nifty bank') || k.includes('banknifty') || k.endsWith('|nifty bank');
    });

    const preferred = [n50, nb].filter(Boolean) as MarketIndexItem[];
    if (preferred.length > 0) return preferred;
    return indices.slice(0, 2);
  })();
  const watchlistWithPrice = watchlist.filter((item) => typeof item.price === 'number').slice(0, 8);

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ScrollView
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 10), paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}>
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
        <ThemedText type="subtitle">Market Snapshot</ThemedText>
        {marketError ? (
          <ThemedText style={{ color: palette.danger, marginTop: 6 }}>{marketError}</ThemedText>
        ) : null}
        {marketLoading ? (
          <ThemedText style={styles.statusText}>Loading market data...</ThemedText>
        ) : topIndices.length ? (
          topIndices.map((idx) => {
            const name = String(idx.key || '').split('|')[1] || idx.key;
            const ltp = typeof idx.ltp === 'number' ? idx.ltp.toFixed(2) : '—';
            const cp = typeof idx.changePct === 'number'
              ? `${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%`
              : '—';
            const cpColor = typeof idx.changePct === 'number'
              ? idx.changePct >= 0
                ? palette.success
                : palette.danger
              : palette.muted;

            return (
              <View key={idx.key} style={styles.marketRow}>
                <ThemedText style={{ flex: 1 }}>{name}</ThemedText>
                <ThemedText style={{ fontWeight: '700' }}>{ltp}</ThemedText>
                <ThemedText style={{ color: cpColor, minWidth: 62, textAlign: 'right' }}>{cp}</ThemedText>
              </View>
            );
          })
        ) : (
          <ThemedText style={styles.statusText}>No index data yet.</ThemedText>
        )}
      </ThemedView>

      <ThemedView style={[styles.latestCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="subtitle">Watchlist Live Prices</ThemedText>
        {marketLoading ? (
          <ThemedText style={styles.statusText}>Loading watchlist prices...</ThemedText>
        ) : watchlist.length === 0 ? (
          <ThemedText style={styles.statusText}>No instruments in watchlist. Add from Watchlist tab.</ThemedText>
        ) : (
          <>
            {watchlist.slice(0, 8).map((item) => {
              const changePct = typeof item.changePct === 'number' ? item.changePct : null;
              const cpColor = changePct === null
                ? palette.muted
                : changePct >= 0
                  ? palette.success
                  : palette.danger;
              return (
                <View key={item.key} style={styles.marketRow}>
                  <ThemedText style={{ flex: 1 }} numberOfLines={1}>
                    {item.tradingSymbol || item.name || item.key}
                  </ThemedText>
                  <ThemedText style={{ fontWeight: '700' }}>
                    {typeof item.price === 'number' ? item.price.toFixed(2) : '—'}
                  </ThemedText>
                  <ThemedText style={{ color: cpColor, minWidth: 62, textAlign: 'right' }}>
                    {changePct === null ? '—' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
                  </ThemedText>
                </View>
              );
            })}
            {watchlistWithPrice.length === 0 ? (
              <ThemedText style={[styles.statusText, { marginTop: 6 }]}>Prices are syncing. Please wait for live feed.</ThemedText>
            ) : null}
          </>
        )}
      </ThemedView>

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
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
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
  marketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
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
