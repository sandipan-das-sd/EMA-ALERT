import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useAlertContext } from '@/contexts/alert-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addToWatchlist,
  getOptionFilterMeta,
  getOptionUnderlyings,
  getWatchlist,
  removeFromWatchlist,
  searchOptionContracts,
  type InstrumentSearchItem,
  type OptionFilterMeta,
  type OptionUnderlyingMeta,
  type WatchlistItem,
} from '@/lib/api';

const FO_SEGMENTS = ['NSE_FO', 'BSE_FO'];
const OPTION_TYPES = ['ALL', 'CE', 'PE'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function WatchlistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { state } = useAlertContext();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InstrumentSearchItem[]>([]);
  const [segment, setSegment] = useState<(typeof FO_SEGMENTS)[number]>('NSE_FO');
  const [underlying, setUnderlying] = useState('NIFTY');
  const [underlyings, setUnderlyings] = useState<OptionUnderlyingMeta['underlyings']>([]);
  const [optionType, setOptionType] = useState<(typeof OPTION_TYPES)[number]>('ALL');
  const [meta, setMeta] = useState<OptionFilterMeta | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [underlyingLoading, setUnderlyingLoading] = useState(false);
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
    const timer = setTimeout(async () => {
      try {
        setUnderlyingLoading(true);
        const response = await getOptionUnderlyings({ segment, debug: true });
        console.log('[Explore] underlyings response:', response);
        const list = response.underlyings || [];
        setUnderlyings(list);

        setUnderlying((prev) => {
          const next = prev.trim().toUpperCase();
          if (next && list.includes(next)) return next;
          if (list.includes('NIFTY')) return 'NIFTY';
          return list[0] || '';
        });
      } catch (e) {
        setUnderlyings([]);
        setError(e instanceof Error ? e.message : 'Failed to load underlyings');
      } finally {
        setUnderlyingLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [segment]);

  useEffect(() => {
    const cleanedUnderlying = underlying.trim().toUpperCase();
    if (!cleanedUnderlying) {
      setMeta(null);
      setSelectedYear(null);
      setSelectedMonth(null);
      setSelectedDay(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setMetaLoading(true);
        const response = await getOptionFilterMeta(cleanedUnderlying, {
          segment,
          debug: true,
        });
        console.log('[Explore] options/meta response:', response);
        setMeta(response);

        const years = response.years || [];
        const preferredYear = years.includes(new Date().getFullYear())
          ? new Date().getFullYear()
          : years[0] || null;

        setSelectedYear((prev) => {
          if (prev && years.includes(prev)) return prev;
          return preferredYear;
        });
      } catch (e) {
        setMeta(null);
        setSelectedYear(null);
        setSelectedMonth(null);
        setSelectedDay(null);
        setError(e instanceof Error ? e.message : 'Failed to load option expiries');
      } finally {
        setMetaLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [underlying, segment]);

  const months = useMemo(() => {
    if (!meta || !selectedYear) return [] as number[];
    return meta.monthsByYear?.[String(selectedYear)] || [];
  }, [meta, selectedYear]);

  const days = useMemo(() => {
    if (!meta || !selectedYear || !selectedMonth) return [] as number[];
    const ym = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
    return meta.daysByYearMonth?.[ym] || [];
  }, [meta, selectedYear, selectedMonth]);

  useEffect(() => {
    if (!months.length) {
      setSelectedMonth(null);
      return;
    }
    if (!selectedMonth || !months.includes(selectedMonth)) {
      setSelectedMonth(months[0]);
    }
  }, [months, selectedMonth]);

  useEffect(() => {
    if (!days.length) {
      setSelectedDay(null);
      return;
    }
    if (!selectedDay || !days.includes(selectedDay)) {
      setSelectedDay(days[0]);
    }
  }, [days, selectedDay]);

  useEffect(() => {
    if (!underlying.trim() || !selectedYear || !selectedMonth) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        setError('');
        const found = await searchOptionContracts({
          query: query.trim() || undefined,
          segments: [segment],
          limit: 40,
          underlying: underlying.trim().toUpperCase(),
          expiryYear: selectedYear,
          expiryMonth: selectedMonth,
          expiryDay: selectedDay || undefined,
          optionType,
          debug: true,
        });
        console.log('[Explore] search response:', {
          count: found.length,
          sample: found.slice(0, 5).map((x) => ({
            key: x.key,
            tradingSymbol: x.tradingSymbol,
            expiry: x.expiry,
            strike: x.strike,
            optionType: x.optionType,
          })),
        });
        setResults(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Instrument search failed');
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [query, segment, underlying, selectedYear, selectedMonth, selectedDay, optionType]);

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
        <View style={styles.inlineRowWrap}>
          {FO_SEGMENTS.map((seg) => (
            <Pressable
              key={seg}
              onPress={() => setSegment(seg)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: segment === seg ? palette.accent : palette.card,
                },
              ]}>
              <ThemedText style={{ color: segment === seg ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {seg}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {underlyingLoading ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <ThemedText style={{ color: palette.muted }}>Loading underlyings...</ThemedText>
          </View>
        ) : null}

        <View style={styles.inlineRowWrap}>
          {underlyings.slice(0, 16).map((u) => (
            <Pressable
              key={`u-${u}`}
              onPress={() => setUnderlying(u)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: underlying.trim().toUpperCase() === u ? palette.success : palette.card,
                },
              ]}>
              <ThemedText style={{ color: underlying.trim().toUpperCase() === u ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {u}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <TextInput
          placeholder="Or type another underlying"
          placeholderTextColor={palette.muted}
          value={underlying}
          onChangeText={setUnderlying}
          autoCapitalize="characters"
          style={[styles.searchInput, { color: palette.text, borderColor: palette.border }]}
        />

        <View style={styles.inlineRowWrap}>
          {OPTION_TYPES.map((ot) => (
            <Pressable
              key={ot}
              onPress={() => setOptionType(ot)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: optionType === ot ? palette.accent : palette.card,
                },
              ]}>
              <ThemedText style={{ color: optionType === ot ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {ot}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.inlineRowWrap}>
          {(meta?.years || []).map((y) => (
            <Pressable
              key={`y-${y}`}
              onPress={() => setSelectedYear(y)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: selectedYear === y ? palette.success : palette.card,
                },
              ]}>
              <ThemedText style={{ color: selectedYear === y ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {y}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.inlineRowWrap}>
          {months.map((m) => (
            <Pressable
              key={`m-${m}`}
              onPress={() => setSelectedMonth(m)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: selectedMonth === m ? palette.success : palette.card,
                },
              ]}>
              <ThemedText style={{ color: selectedMonth === m ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {MONTH_NAMES[m - 1] || m}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.inlineRowWrap}>
          {days.map((d) => (
            <Pressable
              key={`d-${d}`}
              onPress={() => setSelectedDay(d)}
              style={[
                styles.filterChip,
                {
                  borderColor: palette.border,
                  backgroundColor: selectedDay === d ? palette.success : palette.card,
                },
              ]}>
              <ThemedText style={{ color: selectedDay === d ? '#0B1220' : palette.text, fontWeight: '700' }}>
                {String(d).padStart(2, '0')}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <TextInput
          placeholder="Optional strike/query filter (e.g., 23700)"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          style={[styles.searchInput, { color: palette.text, borderColor: palette.border }]}
        />

        {metaLoading ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <ThemedText style={{ color: palette.muted }}>Loading expiry filters...</ThemedText>
          </View>
        ) : null}

        {searching ? (
          <View style={styles.inlineRow}>
            <ActivityIndicator size="small" color={palette.accent} />
            <ThemedText style={{ color: palette.muted }}>
              Searching {underlying.trim().toUpperCase()} contracts...
            </ThemedText>
          </View>
        ) : null}

        {results.slice(0, 8).map((r) => {
          const inWatchlist = watchlistKeys.has(r.key);
          const busy = mutatingKey === r.key;
          return (
            <View key={r.key} style={styles.resultRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="defaultSemiBold">{r.tradingSymbol}</ThemedText>
                <ThemedText style={{ color: palette.muted, fontSize: 12 }}>
                  {r.segment} · {r.key}
                </ThemedText>
                <ThemedText style={{ color: palette.muted, fontSize: 12 }}>
                  Exp {String(r.expiry || '-')}
                  {typeof r.strike === 'number' ? ` · Strike ${r.strike}` : ''}
                  {r.optionType ? ` · ${r.optionType}` : ''}
                </ThemedText>
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
  inlineRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
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
