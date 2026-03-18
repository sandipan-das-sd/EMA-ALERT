import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { addToWatchlist, getWatchlist, removeFromWatchlist, searchInstruments, type InstrumentSearchItem, type WatchlistItem } from '@/lib/api';

const SEARCH_SEGMENTS = ['NSE_EQ', 'NSE_FO', 'NSE_INDEX', 'BSE_EQ', 'BSE_FO', 'BSE_INDEX'];

export default function WatchlistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InstrumentSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);

  const watchlistKeys = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  const loadWatchlist = useCallback(async () => {
    try {
      setError('');
      const wl = await getWatchlist();
      setItems(wl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  useFocusEffect(
    useCallback(() => {
      loadWatchlist();
    }, [loadWatchlist])
  );

  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        setError('');
        const found = await searchInstruments(query.trim(), { segments: SEARCH_SEGMENTS, limit: 20 });
        setResults(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Instrument search failed');
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query]);

  async function onAdd(item: InstrumentSearchItem) {
    try {
      setMutatingKey(item.key);
      await addToWatchlist(item.key);
      await loadWatchlist();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add instrument');
    } finally {
      setMutatingKey(null);
    }
  }

  async function onRemove(itemKey: string) {
    try {
      setMutatingKey(itemKey);
      await removeFromWatchlist(itemKey);
      await loadWatchlist();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove instrument');
    } finally {
      setMutatingKey(null);
    }
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ScrollView
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 10), paddingBottom: insets.bottom + 90 }}
        showsVerticalScrollIndicator={false}>
      <ThemedText type="title" style={styles.title}>Watchlist</ThemedText>
      <ThemedText style={{ color: palette.muted }}>
        Add/remove instruments and track live EMA-cross activity.
      </ThemedText>

      <ThemedView style={[styles.searchCard, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <TextInput
          placeholder="Search instruments (e.g., RELIANCE, NIFTY)"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          style={[styles.searchInput, { color: palette.text, borderColor: palette.border }]}
        />

        {searching ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <ThemedText style={{ color: palette.muted }}>Searching...</ThemedText>
          </View>
        ) : null}

        {results.slice(0, 8).map((r) => {
          const inWatchlist = watchlistKeys.has(r.key);
          const busy = mutatingKey === r.key;
          return (
            <View key={r.key} style={styles.resultRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="defaultSemiBold">{r.tradingSymbol}</ThemedText>
                <ThemedText style={{ color: palette.muted, fontSize: 12 }}>{r.segment} · {r.key}</ThemedText>
              </View>
              <Pressable
                disabled={busy || inWatchlist}
                onPress={() => onAdd(r)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: inWatchlist ? palette.success : palette.accent,
                    opacity: busy ? 0.7 : 1,
                  },
                ]}>
                <ThemedText style={styles.actionBtnText}>
                  {busy ? '...' : inWatchlist ? 'Added' : 'Add'}
                </ThemedText>
              </Pressable>
            </View>
          );
        })}
      </ThemedView>

      {error ? <ThemedText style={{ color: palette.danger, marginTop: 10 }}>{error}</ThemedText> : null}

      <View style={styles.list}>
        {loading ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <ThemedText style={{ color: palette.muted }}>Loading watchlist...</ThemedText>
          </View>
        ) : null}

        {!loading && items.length === 0 ? (
          <ThemedView style={[styles.item, { backgroundColor: palette.card, borderColor: palette.border }]}> 
            <ThemedText style={{ color: palette.muted }}>
              Watchlist is empty. Search above and tap Add.
            </ThemedText>
          </ThemedView>
        ) : null}

        {items.map((item) => {
          const instrumentKey = item.key;
          const label = item.tradingSymbol || item.name || instrumentKey;
          const hit = state.alerts.find((a) => a.instrumentKey === instrumentKey || a.instrumentName === label);
          const busy = mutatingKey === instrumentKey;
          return (
            <ThemedView
              key={instrumentKey}
              style={[styles.item, { backgroundColor: palette.card, borderColor: palette.border }]}> 
              <View style={styles.rowHead}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="defaultSemiBold">{label}</ThemedText>
                  <ThemedText style={{ color: palette.muted, fontSize: 12 }}>{instrumentKey}</ThemedText>
                </View>
                <Pressable
                  disabled={busy}
                  onPress={() => onRemove(instrumentKey)}
                  style={[styles.removeBtn, { borderColor: palette.danger }]}> 
                  <ThemedText style={{ color: palette.danger, fontWeight: '700' }}>{busy ? '...' : 'Remove'}</ThemedText>
                </Pressable>
              </View>
              <ThemedText style={{ color: palette.muted, marginTop: 6 }}>
                {hit
                  ? `Latest: Close ${hit.close.toFixed(2)} / EMA ${hit.ema.toFixed(2)}`
                  : 'No crossover received in this session'}
              </ThemedText>
              {typeof item.price === 'number' ? (
                <ThemedText style={{ marginTop: 4 }}>
                  LTP {item.price.toFixed(2)}
                  {typeof item.changePct === 'number' ? ` · ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%` : ''}
                </ThemedText>
              ) : null}
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
  searchCard: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionBtnText: {
    color: '#0B1220',
    fontWeight: '700',
  },
  item: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  removeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
