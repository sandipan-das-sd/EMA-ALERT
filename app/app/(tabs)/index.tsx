import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageBackground, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { APP_CONFIG } from '@/lib/config';
import {
  getBatchLtp,
  getMarketSnapshot,
  getMarketStatus,
  getWatchlist,
  type MarketIndexItem,
  type MarketStatus,
  type WatchlistItem,
} from '@/lib/api';

export default function HomeScreen() {
  const DASHBOARD_DEBUG = __DEV__;
  const logDashboard = useMemo(
    () =>
      (...args: any[]) => {
        if (!DASHBOARD_DEBUG) return;
        console.log('[Dashboard Debug]', ...args);
      },
    [DASHBOARD_DEBUG]
  );

  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();
  const insets = useSafeAreaInsets();
  const [indices, setIndices] = useState<MarketIndexItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');

  const latest = state.alerts[0];

  const getWatchlistQuote = useCallback(
    (item: WatchlistItem) => {
      const key = String(item.key || '');
      const segment = String(item.segment || key.split(/[|:]/)[0] || '');
      const ts = String(item.tradingSymbol || '').trim();
      const tsNoSpace = ts.replace(/\s+/g, '').toUpperCase();
      const variants = new Set<string>([key]);

      if (key.includes('|')) variants.add(key.replace('|', ':'));
      if (key.includes(':')) variants.add(key.replace(':', '|'));
      if (segment && tsNoSpace) {
        variants.add(`${segment}:${tsNoSpace}`);
        variants.add(`${segment}|${tsNoSpace}`);
      }

      for (const variant of variants) {
        const hit = state.market.quotes[variant];
        if (hit && (typeof hit.last_price === 'number' || typeof hit.ltp === 'number')) {
          return { quote: hit, matchedKey: variant };
        }
      }

      return { quote: null, matchedKey: null };
    },
    [state.market.quotes]
  );

  const loadDashboardMarketData = useCallback(async () => {
    logDashboard('Fetching market data', {
      apiBase: APP_CONFIG.apiBase,
      ts: new Date().toISOString(),
    });
    setMarketError('');

    const [indicesResult, watchlistResult] = await Promise.allSettled([
      getMarketSnapshot(),
      getWatchlist(),
    ]);

    const statusResult = await Promise.allSettled([getMarketStatus()]);
    let finalIndicesCount = 0;
    let finalWatchlistCount = 0;
    let finalWatchlistWithPrice = 0;
    let finalStatusOpen: boolean | null = null;

    const errorParts: string[] = [];

    if (indicesResult.status === 'fulfilled') {
      setIndices(indicesResult.value || []);
      finalIndicesCount = (indicesResult.value || []).length;
      logDashboard('Market snapshot success', {
        totalIndices: (indicesResult.value || []).length,
        withLtp: (indicesResult.value || []).filter((x) => typeof x.ltp === 'number').length,
        sample: (indicesResult.value || []).slice(0, 3),
      });
    } else {
      setIndices([]);
      logDashboard('Market snapshot failed', indicesResult.reason);
      errorParts.push(indicesResult.reason instanceof Error ? indicesResult.reason.message : 'Failed to load market indices');
    }

    if (watchlistResult.status === 'fulfilled') {
      let wl = watchlistResult.value || [];
      finalWatchlistCount = wl.length;
      logDashboard('Watchlist API success', {
        totalWatchlist: wl.length,
        withPrice: wl.filter((w) => typeof w.price === 'number').length,
        sample: wl.slice(0, 5).map((w) => ({ key: w.key, price: w.price, changePct: w.changePct })),
      });

      // Fallback: fetch direct LTP if watchlist has items but no cached prices yet.
      const missingPriceKeys = wl.filter((w) => typeof w.price !== 'number').map((w) => w.key).filter(Boolean);
      logDashboard('Watchlist missing-price keys', missingPriceKeys);
      if (missingPriceKeys.length > 0) {
        try {
          const ltpMap = await getBatchLtp(missingPriceKeys);
          logDashboard('Batch LTP fallback success', {
            returnedKeys: Object.keys(ltpMap || {}),
            sample: Object.entries(ltpMap || {}).slice(0, 3),
          });
          wl = wl.map((item) => {
            const key = String(item.key || '');
            const segment = String(item.segment || key.split(/[|:]/)[0] || '');
            const ts = String(item.tradingSymbol || '').trim();
            const tsNoSpace = ts.replace(/\s+/g, '').toUpperCase();
            const variants = new Set<string>([key]);
            if (key.includes('|')) variants.add(key.replace('|', ':'));
            if (key.includes(':')) variants.add(key.replace(':', '|'));
            if (segment && tsNoSpace) {
              variants.add(`${segment}:${tsNoSpace}`);
              variants.add(`${segment}|${tsNoSpace}`);
            }

            let quote: any = null;
            let matchedKey: string | null = null;
            for (const variant of variants) {
              const q = (ltpMap as any)?.[variant];
              const lastPrice = q?.last_price ?? q?.ltp;
              if (q && typeof lastPrice === 'number') {
                quote = q;
                matchedKey = variant;
                break;
              }
            }

            const lastPrice = quote?.last_price ?? quote?.ltp;
            if (!quote || typeof lastPrice !== 'number') return item;
            const cp = typeof quote.cp === 'number' ? quote.cp : null;
            const changePct = cp && cp > 0 ? ((lastPrice - cp) / cp) * 100 : null;
            if (matchedKey && matchedKey !== item.key) {
              logDashboard('Watchlist LTP alias matched', { key: item.key, matchedKey });
            }
            return {
              ...item,
              price: lastPrice,
              changePct,
              change: cp ? lastPrice - cp : null,
            };
          });
        } catch {
          logDashboard('Batch LTP fallback failed');
          // Keep base watchlist snapshot if direct LTP fallback fails.
        }
      }

      logDashboard('Watchlist final mapped', {
        totalWatchlist: wl.length,
        withPrice: wl.filter((w) => typeof w.price === 'number').length,
        sample: wl.slice(0, 5).map((w) => ({ key: w.key, price: w.price, changePct: w.changePct })),
      });
      finalWatchlistCount = wl.length;
      finalWatchlistWithPrice = wl.filter((w) => typeof w.price === 'number').length;
      setWatchlist(wl);
    } else {
      setWatchlist([]);
      logDashboard('Watchlist API failed', watchlistResult.reason);
      errorParts.push(watchlistResult.reason instanceof Error ? watchlistResult.reason.message : 'Failed to load watchlist prices');
    }

    if (statusResult[0].status === 'fulfilled') {
      setMarketStatus(statusResult[0].value);
      finalStatusOpen = Boolean(statusResult[0].value?.isOpen);
      logDashboard('Market status success', statusResult[0].value);
    } else {
      logDashboard('Market status failed', statusResult[0].reason);
    }

    if (errorParts.length) {
      setMarketError(errorParts.join(' | '));
    }

    logDashboard('Fetch complete', {
      errors: errorParts,
      indexCards: finalIndicesCount,
      watchlistItems: finalWatchlistCount,
      watchlistWithPrice: finalWatchlistWithPrice,
      statusOpen: finalStatusOpen,
    });

    setMarketLoading(false);
  }, [logDashboard]);

  useEffect(() => {
    loadDashboardMarketData();
    const intervalMs = state.stream.connected ? 20_000 : 8_000;
    const timer = setInterval(loadDashboardMarketData, intervalMs);
    return () => clearInterval(timer);
  }, [loadDashboardMarketData, state.stream.connected]);

  useFocusEffect(
    useCallback(() => {
      loadDashboardMarketData();
    }, [loadDashboardMarketData])
  );

  useEffect(() => {
    if (!state.market.lastUpdateAt) return;

    setIndices((prev) =>
      prev.map((item) => {
        const key = String(item.key || '');
        const live = state.market.indices[key] || state.market.indices[key.replace('|', ':')] || state.market.indices[key.replace(':', '|')];
        if (!live) return item;
        return {
          ...item,
          ltp: typeof live.ltp === 'number' ? live.ltp : item.ltp,
          cp: typeof live.cp === 'number' ? live.cp : item.cp,
          changePct: typeof live.changePct === 'number' ? live.changePct : item.changePct,
        };
      })
    );

    setWatchlist((prev) =>
      prev.map((item) => {
        const { quote } = getWatchlistQuote(item);
        if (!quote) return item;

        const lastPrice = quote.last_price ?? quote.ltp;
        if (typeof lastPrice !== 'number') return item;

        const cp = typeof quote.cp === 'number' ? quote.cp : null;
        const changePct = cp && cp > 0
          ? ((lastPrice - cp) / cp) * 100
          : typeof quote.changePct === 'number'
            ? quote.changePct
            : item.changePct;

        return {
          ...item,
          price: lastPrice,
          changePct,
          change: cp ? lastPrice - cp : item.change,
        };
      })
    );
  }, [getWatchlistQuote, state.market.indices, state.market.lastUpdateAt]);

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
      <ImageBackground
        source={require('../../assets/images/splash-icon.png')}
        imageStyle={{ opacity: 0.12, resizeMode: 'cover' }}
        style={[styles.hero, { backgroundColor: palette.card, borderColor: palette.border }]}
      >
        <ThemedText type="title" style={styles.heroTitle}>EMA ALERT SYSTEM</ThemedText>
        <ThemedText style={{ color: palette.muted, marginTop: 6 }}>
          Smart market monitoring with live indices, watchlist prices, and EMA crossover alerts.
        </ThemedText>
      </ImageBackground>

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
        {marketStatus ? (
          <ThemedText style={{ color: marketStatus.isOpen ? palette.success : palette.warning, marginTop: 4 }}>
            {marketStatus.isOpen ? 'Market Open' : 'Market Closed'} · {marketStatus.openTime} - {marketStatus.closeTime} IST
          </ThemedText>
        ) : null}
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
