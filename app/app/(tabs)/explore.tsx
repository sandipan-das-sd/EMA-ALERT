import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  addToWatchlist,
  getOptionFilterMeta,
  getOptionUnderlyings,
  getWatchlist,
  removeFromWatchlist,
  searchInstruments,
  searchOptionContracts,
  updateWatchlistLots,
  updateWatchlistProduct,
  type InstrumentSearchItem,
  type OptionFilterMeta,
  type WatchlistItem,
} from '@/lib/api';
import { APP_CONFIG } from '@/lib/config';
import { showToast } from '@/lib/toast';

type SearchMode = 'stocks' | 'futures' | 'options';
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPTION_TYPES = ['ALL', 'CE', 'PE'] as const;

export default function WatchlistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  // Watchlist state
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>('stocks');
  const [error, setError] = useState('');

  // WebSocket for live prices
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lots picker state: when user taps "+ Add", we ask how many lots + product before confirming
  const [lotsPending, setLotsPending] = useState<{ key: string; lots: number; product: 'I' | 'D' } | null>(null);

  // Stock search state
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState<InstrumentSearchItem[]>([]);
  const [stockSearching, setStockSearching] = useState(false);

  // Futures search state
  const [futQuery, setFutQuery] = useState('');
  const [futResults, setFutResults] = useState<InstrumentSearchItem[]>([]);
  const [futSearching, setFutSearching] = useState(false);

  // Options search state
  const [optSegment, setOptSegment] = useState('NSE_FO');
  const [optUnderlying, setOptUnderlying] = useState('NIFTY');
  const [optUnderlyings, setOptUnderlyings] = useState<string[]>([]);
  const [optOptionType, setOptOptionType] = useState<(typeof OPTION_TYPES)[number]>('ALL');
  const [optMeta, setOptMeta] = useState<OptionFilterMeta | null>(null);
  const [optYear, setOptYear] = useState<number | null>(null);
  const [optMonth, setOptMonth] = useState<number | null>(null);
  const [optDay, setOptDay] = useState<number | null>(null);
  const [optStrikeQuery, setOptStrikeQuery] = useState('');
  const [optResults, setOptResults] = useState<InstrumentSearchItem[]>([]);
  const [optSearching, setOptSearching] = useState(false);
  const [optMetaLoading, setOptMetaLoading] = useState(false);

  const watchlistKeys = useMemo(() => new Set(items.map((i) => i.key)), [items]);

  // ── Watchlist load ──────────────────────────────────────────────
  const loadWatchlist = useCallback(async () => {
    try {
      const wl = await getWatchlist();
      setItems(wl);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);
  useFocusEffect(useCallback(() => { loadWatchlist(); }, [loadWatchlist]));

  // ── WebSocket live prices ───────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    try {
      const ws = new WebSocket(APP_CONFIG.wsUrl);
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'tick') {
            setItems((prev) => prev.map((it) =>
              it.key === msg.instrumentKey || it.key.replace(/\|/g, ':') === msg.instrumentKey
                ? { ...it, price: msg.ltp, changePct: msg.changePct, change: msg.change }
                : it
            ));
          } else if (msg.type === 'quotes') {
            setItems((prev) => prev.map((it) => {
              const q = msg.data?.find((d: any) =>
                d.key === it.key || d.key?.replace(/\|/g, ':') === it.key || d.key?.replace(/:/g, '|') === it.key
              );
              return q && typeof q.ltp === 'number'
                ? { ...it, price: q.ltp, changePct: q.changePct, change: q.change }
                : it;
            }));
          }
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
        wsReconnectRef.current = setTimeout(connectWs, 8000);
      };
      ws.onerror = () => ws.close();
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connectWs]);

  // ── Stock search ────────────────────────────────────────────────
  useEffect(() => {
    if (!showSearch || searchMode !== 'stocks') return;
    if (!stockQuery.trim()) { setStockResults([]); return; }
    const t = setTimeout(async () => {
      setStockSearching(true);
      try {
        const r = await searchInstruments(stockQuery.trim(), { segments: ['NSE_EQ', 'BSE_EQ'], limit: 20 });
        setStockResults(r);
      } catch { setStockResults([]); }
      finally { setStockSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [stockQuery, showSearch, searchMode]);

  // ── Futures search ──────────────────────────────────────────────
  useEffect(() => {
    if (!showSearch || searchMode !== 'futures') return;
    if (!futQuery.trim()) { setFutResults([]); return; }
    const t = setTimeout(async () => {
      setFutSearching(true);
      try {
        const r = await searchInstruments(futQuery.trim(), { segments: ['NSE_FO', 'BSE_FO'], limit: 30 });
        // Keep only futures (instrument names containing FUT or no optionType)
        setFutResults(r.filter((x) => !x.optionType && !/^(CE|PE)$/.test(String(x.optionType))));
      } catch { setFutResults([]); }
      finally { setFutSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [futQuery, showSearch, searchMode]);

  // ── Option underlyings ──────────────────────────────────────────
  useEffect(() => {
    if (!showSearch || searchMode !== 'options') return;
    const t = setTimeout(async () => {
      try {
        const res = await getOptionUnderlyings({ segment: optSegment });
        const list = res.underlyings || [];
        setOptUnderlyings(list);
        setOptUnderlying((prev) => {
          const up = prev.trim().toUpperCase();
          if (list.includes(up)) return up;
          return list.includes('NIFTY') ? 'NIFTY' : list[0] || '';
        });
      } catch { setOptUnderlyings([]); }
    }, 150);
    return () => clearTimeout(t);
  }, [optSegment, showSearch, searchMode]);

  // ── Option meta ─────────────────────────────────────────────────
  const normOptUnderlying = optUnderlying.trim().toUpperCase();
  const hasValidUnderlying = normOptUnderlying.length >= 2 && optUnderlyings.includes(normOptUnderlying);

  useEffect(() => {
    if (!showSearch || searchMode !== 'options' || !hasValidUnderlying) { setOptMeta(null); return; }
    const t = setTimeout(async () => {
      setOptMetaLoading(true);
      try {
        const res = await getOptionFilterMeta(normOptUnderlying, { segment: optSegment });
        setOptMeta(res);
        const years = res.years || [];
        setOptYear((prev) => (prev && years.includes(prev) ? prev : years.includes(new Date().getFullYear()) ? new Date().getFullYear() : years[0] ?? null));
      } catch { setOptMeta(null); }
      finally { setOptMetaLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [normOptUnderlying, optSegment, showSearch, searchMode, hasValidUnderlying]);

  const optMonths = useMemo(() => (optMeta && optYear ? optMeta.monthsByYear?.[String(optYear)] || [] : []), [optMeta, optYear]);
  const optDays = useMemo(() => {
    if (!optMeta || !optYear || !optMonth) return [] as number[];
    return optMeta.daysByYearMonth?.[`${optYear}-${String(optMonth).padStart(2, '0')}`] || [];
  }, [optMeta, optYear, optMonth]);

  useEffect(() => {
    if (!optMonths.length) { setOptMonth(null); return; }
    setOptMonth((p) => (p && optMonths.includes(p) ? p : optMonths[0]));
  }, [optMonths]);

  useEffect(() => {
    if (!optDays.length) { setOptDay(null); return; }
    setOptDay((p) => (p && optDays.includes(p) ? p : optDays[0]));
  }, [optDays]);

  // ── Options search ──────────────────────────────────────────────
  useEffect(() => {
    if (!showSearch || searchMode !== 'options' || !hasValidUnderlying || !optYear || !optMonth) {
      setOptResults([]); return;
    }
    const t = setTimeout(async () => {
      setOptSearching(true);
      try {
        const r = await searchOptionContracts({
          query: optStrikeQuery.trim() || undefined,
          segments: [optSegment],
          underlying: normOptUnderlying,
          expiryYear: optYear,
          expiryMonth: optMonth,
          expiryDay: optDay || undefined,
          optionType: optOptionType,
          limit: 40,
        });
        setOptResults(r);
      } catch { setOptResults([]); }
      finally { setOptSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [optStrikeQuery, optSegment, normOptUnderlying, hasValidUnderlying, optYear, optMonth, optDay, optOptionType, showSearch, searchMode]);

  // ── Mutations ───────────────────────────────────────────────────
  async function onAdd(item: InstrumentSearchItem, lots: number, product: 'I' | 'D') {
    try {
      setMutatingKey(item.key);
      setLotsPending(null);
      await addToWatchlist(item.key, lots, product);
      await loadWatchlist();
      const lotSize = item.lotSize ?? 1;
      const qty = lots * lotSize;
      showToast(`${item.tradingSymbol} added · ${lots} lot${lots !== 1 ? 's' : ''} (${qty} qty) · ${product === 'I' ? 'Intraday' : 'Delivery'}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add');
    } finally { setMutatingKey(null); }
  }

  async function onUpdateLots(key: string, newLots: number) {
    if (!Number.isInteger(newLots) || newLots < 1) return;
    try {
      await updateWatchlistLots(key, newLots);
      setItems((prev) => prev.map((it) => it.key === key ? { ...it, lots: newLots } : it));
    } catch { showToast('Could not update lots'); }
  }

  async function onUpdateProduct(key: string, newProduct: 'I' | 'D') {
    try {
      await updateWatchlistProduct(key, newProduct);
      setItems((prev) => prev.map((it) => it.key === key ? { ...it, product: newProduct } : it));
    } catch { showToast('Could not update product'); }
  }

  async function onRemove(key: string) {
    try {
      setMutatingKey(key);
      await removeFromWatchlist(key);
      await loadWatchlist();
      showToast('Removed from watchlist');
    } catch { showToast('Could not remove'); }
    finally { setMutatingKey(null); }
  }

  // ── Result row ──────────────────────────────────────────────────
  function ResultRow({ item }: { item: InstrumentSearchItem }) {
    const inWL = watchlistKeys.has(item.key);
    const busy = mutatingKey === item.key;
    const expStr = item.expiry ? String(item.expiry).slice(0, 10) : null;
    const isPickingLots = lotsPending?.key === item.key;
    const pendingLots = isPickingLots ? lotsPending!.lots : 1;
    const pendingProduct = isPickingLots ? lotsPending!.product : 'I';
    const lotSize = item.lotSize ?? 1;
    const effectiveQty = pendingLots * lotSize;
    return (
      <View style={[styles.resultRow, { borderColor: palette.border }]}>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.resultSymbol}>{item.tradingSymbol}</ThemedText>
          <ThemedText style={[styles.resultSub, { color: palette.muted }]}>
            {item.segment}{expStr ? ` · Exp ${expStr}` : ''}{typeof item.strike === 'number' ? ` · ₹${item.strike}` : ''}{item.optionType ? ` · ${item.optionType}` : ''}
          </ThemedText>
          {isPickingLots && (
            <ThemedText style={[styles.resultSub, { color: palette.tint }]}>
              {pendingLots} lot{pendingLots !== 1 ? 's' : ''} × {lotSize} = {effectiveQty} qty · {pendingProduct === 'I' ? 'Intraday' : 'Delivery'}
            </ThemedText>
          )}
        </View>
        {inWL ? (
          <View style={[styles.addBtn, { backgroundColor: '#16a34a' }]}>
            <ThemedText style={styles.addBtnText}>✓</ThemedText>
          </View>
        ) : isPickingLots ? (
          <View style={{ gap: 6 }}>
            {/* Lots row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Pressable
                onPress={() => setLotsPending((p) => p ? { ...p, lots: Math.max(1, p.lots - 1) } : p)}
                style={[styles.lotsStepBtn, { borderColor: palette.border }]}>
                <ThemedText style={{ fontWeight: '700', fontSize: 16 }}>−</ThemedText>
              </Pressable>
              <ThemedText style={{ minWidth: 24, textAlign: 'center', fontWeight: '700' }}>{pendingLots}</ThemedText>
              <Pressable
                onPress={() => setLotsPending((p) => p ? { ...p, lots: p.lots + 1 } : p)}
                style={[styles.lotsStepBtn, { borderColor: palette.border }]}>
                <ThemedText style={{ fontWeight: '700', fontSize: 16 }}>+</ThemedText>
              </Pressable>
            </View>
            {/* Intraday / Delivery row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Pressable
                onPress={() => setLotsPending((p) => p ? { ...p, product: 'I' } : p)}
                style={[styles.productBtn, { backgroundColor: pendingProduct === 'I' ? '#2563eb' : palette.card, borderColor: '#2563eb' }]}>
                <ThemedText style={[styles.productBtnText, { color: pendingProduct === 'I' ? '#fff' : '#2563eb' }]}>Intraday</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setLotsPending((p) => p ? { ...p, product: 'D' } : p)}
                style={[styles.productBtn, { backgroundColor: pendingProduct === 'D' ? '#16a34a' : palette.card, borderColor: '#16a34a' }]}>
                <ThemedText style={[styles.productBtnText, { color: pendingProduct === 'D' ? '#fff' : '#16a34a' }]}>Delivery</ThemedText>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => onAdd(item, pendingLots, pendingProduct)}
                style={[styles.addBtn, { backgroundColor: '#16a34a', opacity: busy ? 0.6 : 1 }]}>
                <ThemedText style={styles.addBtnText}>{busy ? '…' : '✓'}</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            disabled={busy}
            onPress={() => setLotsPending({ key: item.key, lots: 1, product: 'I' })}
            style={[styles.addBtn, { backgroundColor: palette.tint, opacity: busy ? 0.6 : 1 }]}>
            <ThemedText style={styles.addBtnText}>{busy ? '…' : '+ Add'}</ThemedText>
          </Pressable>
        )}
      </View>
    );
  }

  // ── Watchlist item ──────────────────────────────────────────────
  function WatchItem({ item }: { item: WatchlistItem }) {
    const label = item.tradingSymbol || item.name || item.key;
    const busy = mutatingKey === item.key;
    const hasPrice = typeof item.price === 'number';
    const up = (item.changePct ?? 0) >= 0;
    const isFO = item.key?.startsWith('NSE_FO') || item.key?.startsWith('BSE_FO');
    const isIndex = item.key?.startsWith('NSE_INDEX') || item.key?.startsWith('BSE_INDEX');
    const segTag = isIndex ? 'INDEX' : isFO ? 'F&O' : 'EQ';
    const segColor = isFO ? '#d97706' : isIndex ? '#7c3aed' : '#2563eb';
    const lots = item.lots ?? 1;
    const lotSize = item.lotSize ?? 1;
    const totalQty = lots * lotSize;
    const showLotsBadge = lotSize > 1 || lots > 1;
    const product = item.product ?? 'I';
    return (
      <View style={[styles.watchItem, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.watchTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.watchLabelRow}>
              <ThemedText style={styles.watchSymbol}>{label}</ThemedText>
              <View style={[styles.segTag, { backgroundColor: segColor + '22' }]}>
                <ThemedText style={[styles.segTagText, { color: segColor }]}>{segTag}</ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.watchKey, { color: palette.muted }]}>{item.key}</ThemedText>
          </View>
          <Pressable
            disabled={busy}
            onPress={() => onRemove(item.key)}
            style={[styles.removeBtn, { borderColor: '#dc2626' + '55' }]}>
            <ThemedText style={{ color: '#dc2626', fontWeight: '700', fontSize: 12 }}>{busy ? '…' : 'Remove'}</ThemedText>
          </Pressable>
        </View>
        {hasPrice ? (
          <View style={styles.priceRow}>
            <ThemedText style={[styles.priceText, { color: up ? '#16a34a' : '#dc2626' }]}>
              ₹{item.price!.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </ThemedText>
            {typeof item.changePct === 'number' && (
              <View style={[styles.changePill, { backgroundColor: (up ? '#16a34a' : '#dc2626') + '18' }]}>
                <ThemedText style={[styles.changeText, { color: up ? '#16a34a' : '#dc2626' }]}>
                  {up ? '+' : ''}{item.changePct.toFixed(2)}%
                </ThemedText>
              </View>
            )}
            {typeof item.change === 'number' && (
              <ThemedText style={[styles.absChange, { color: palette.muted }]}>
                {up ? '+' : ''}₹{Math.abs(item.change).toFixed(2)}
              </ThemedText>
            )}
          </View>
        ) : (
          <ThemedText style={[styles.noPrice, { color: palette.muted }]}>Waiting for price data…</ThemedText>
        )}
        {/* Lots / qty row with inline +/- edit */}
        {showLotsBadge && (
          <View style={styles.lotsRow}>
            <ThemedText style={[styles.lotsText, { color: palette.muted }]}>Lots:</ThemedText>
            <Pressable
              onPress={() => onUpdateLots(item.key, lots - 1)}
              disabled={lots <= 1}
              style={[styles.lotsStepBtn, { borderColor: palette.border, opacity: lots <= 1 ? 0.4 : 1 }]}>
              <ThemedText style={{ fontWeight: '700' }}>−</ThemedText>
            </Pressable>
            <ThemedText style={{ fontWeight: '700', minWidth: 20, textAlign: 'center' }}>{lots}</ThemedText>
            <Pressable
              onPress={() => onUpdateLots(item.key, lots + 1)}
              style={[styles.lotsStepBtn, { borderColor: palette.border }]}>
              <ThemedText style={{ fontWeight: '700' }}>+</ThemedText>
            </Pressable>
            <ThemedText style={[styles.lotsText, { color: palette.muted }]}>
              × {lotSize} = {totalQty} qty
            </ThemedText>
          </View>
        )}
        {/* Intraday / Delivery toggle */}
        <View style={styles.lotsRow}>
          <Pressable
            onPress={() => onUpdateProduct(item.key, 'I')}
            style={[styles.productBtn, { backgroundColor: product === 'I' ? '#2563eb' : palette.card, borderColor: '#2563eb' }]}>
            <ThemedText style={[styles.productBtnText, { color: product === 'I' ? '#fff' : '#2563eb' }]}>Intraday</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => onUpdateProduct(item.key, 'D')}
            style={[styles.productBtn, { backgroundColor: product === 'D' ? '#16a34a' : palette.card, borderColor: '#16a34a' }]}>
            <ThemedText style={[styles.productBtnText, { color: product === 'D' ? '#fff' : '#16a34a' }]}>Delivery</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────
  const searchResults =
    searchMode === 'stocks' ? stockResults :
    searchMode === 'futures' ? futResults : optResults;
  const isSearching = searchMode === 'stocks' ? stockSearching :
    searchMode === 'futures' ? futSearching : optSearching;

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.key}
        renderItem={({ item }) => <WatchItem item={item} />}
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 10), paddingBottom: insets.bottom + 90, paddingHorizontal: 16, gap: 10 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>Watchlist</ThemedText>
              <Pressable
                onPress={() => setShowSearch((v) => !v)}
                style={[styles.addSymbolBtn, { backgroundColor: palette.tint }]}>
                <ThemedText style={styles.addSymbolText}>{showSearch ? '✕ Close' : '+ Add'}</ThemedText>
              </Pressable>
            </View>

            {/* Search panel */}
            {showSearch && (
              <View style={[styles.searchPanel, { backgroundColor: palette.card, borderColor: palette.border }]}>
                {/* Mode tabs */}
                <View style={styles.modeTabs}>
                  {(['stocks', 'futures', 'options'] as SearchMode[]).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setSearchMode(m)}
                      style={[styles.modeTab, { borderBottomColor: searchMode === m ? palette.tint : 'transparent' }]}>
                      <ThemedText style={[styles.modeTabText, { color: searchMode === m ? palette.tint : palette.muted }]}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>

                {/* Stocks */}
                {searchMode === 'stocks' && (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      placeholder="Search stocks (e.g. RELIANCE, TCS)"
                      placeholderTextColor={palette.muted}
                      value={stockQuery}
                      onChangeText={setStockQuery}
                      autoCapitalize="characters"
                      style={[styles.input, { color: palette.text, borderColor: palette.border }]}
                    />
                  </View>
                )}

                {/* Futures */}
                {searchMode === 'futures' && (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      placeholder="Search futures (e.g. NIFTY, BANKNIFTY, RELIANCE)"
                      placeholderTextColor={palette.muted}
                      value={futQuery}
                      onChangeText={setFutQuery}
                      autoCapitalize="characters"
                      style={[styles.input, { color: palette.text, borderColor: palette.border }]}
                    />
                    <ThemedText style={[styles.hint, { color: palette.muted }]}>Shows FUT contracts only</ThemedText>
                  </View>
                )}

                {/* Options */}
                {searchMode === 'options' && (
                  <View style={{ gap: 8 }}>
                    {/* Segment */}
                    <View style={styles.chipRow}>
                      {['NSE_FO', 'BSE_FO'].map((seg) => (
                        <Pressable key={seg} onPress={() => setOptSegment(seg)}
                          style={[styles.chip, { borderColor: palette.border, backgroundColor: optSegment === seg ? palette.tint : palette.card }]}>
                          <ThemedText style={{ color: optSegment === seg ? '#fff' : palette.text, fontWeight: '700', fontSize: 12 }}>{seg}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    {/* Underlyings */}
                    <View style={styles.chipRow}>
                      {optUnderlyings.slice(0, 14).map((u) => (
                        <Pressable key={u} onPress={() => setOptUnderlying(u)}
                          style={[styles.chip, { borderColor: palette.border, backgroundColor: normOptUnderlying === u ? '#16a34a' : palette.card }]}>
                          <ThemedText style={{ color: normOptUnderlying === u ? '#fff' : palette.text, fontWeight: '700', fontSize: 11 }}>{u}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    {/* CE/PE */}
                    <View style={styles.chipRow}>
                      {OPTION_TYPES.map((ot) => (
                        <Pressable key={ot} onPress={() => setOptOptionType(ot)}
                          style={[styles.chip, { borderColor: palette.border, backgroundColor: optOptionType === ot ? palette.tint : palette.card }]}>
                          <ThemedText style={{ color: optOptionType === ot ? '#fff' : palette.text, fontWeight: '700', fontSize: 12 }}>{ot}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    {/* Year */}
                    {!optMetaLoading && (optMeta?.years || []).length > 0 && (
                      <View style={styles.chipRow}>
                        {(optMeta!.years || []).map((y) => (
                          <Pressable key={y} onPress={() => setOptYear(y)}
                            style={[styles.chip, { borderColor: palette.border, backgroundColor: optYear === y ? '#16a34a' : palette.card }]}>
                            <ThemedText style={{ color: optYear === y ? '#fff' : palette.text, fontWeight: '700', fontSize: 12 }}>{y}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {/* Month */}
                    {optMonths.length > 0 && (
                      <View style={styles.chipRow}>
                        {optMonths.map((m) => (
                          <Pressable key={m} onPress={() => setOptMonth(m)}
                            style={[styles.chip, { borderColor: palette.border, backgroundColor: optMonth === m ? '#16a34a' : palette.card }]}>
                            <ThemedText style={{ color: optMonth === m ? '#fff' : palette.text, fontWeight: '700', fontSize: 12 }}>{MONTH_NAMES[m - 1]}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {/* Days */}
                    {optDays.length > 0 && (
                      <View style={styles.chipRow}>
                        {optDays.map((d) => (
                          <Pressable key={d} onPress={() => setOptDay(d)}
                            style={[styles.chip, { borderColor: palette.border, backgroundColor: optDay === d ? '#16a34a' : palette.card }]}>
                            <ThemedText style={{ color: optDay === d ? '#fff' : palette.text, fontWeight: '700', fontSize: 12 }}>{String(d).padStart(2, '0')}</ThemedText>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {/* Strike filter */}
                    <TextInput
                      placeholder="Strike/filter (e.g. 23700)"
                      placeholderTextColor={palette.muted}
                      value={optStrikeQuery}
                      onChangeText={setOptStrikeQuery}
                      keyboardType="numeric"
                      style={[styles.input, { color: palette.text, borderColor: palette.border }]}
                    />
                    {optMetaLoading && (
                      <View style={styles.row}>
                        <ActivityIndicator size="small" color={palette.tint} />
                        <ThemedText style={[styles.hint, { color: palette.muted }]}>Loading expiry dates…</ThemedText>
                      </View>
                    )}
                  </View>
                )}

                {/* Search results */}
                {isSearching && (
                  <View style={styles.row}>
                    <ActivityIndicator size="small" color={palette.tint} />
                    <ThemedText style={[styles.hint, { color: palette.muted }]}>Searching…</ThemedText>
                  </View>
                )}
                {!isSearching && searchResults.length === 0 &&
                  ((searchMode === 'stocks' && stockQuery.trim()) ||
                   (searchMode === 'futures' && futQuery.trim()) ||
                   (searchMode === 'options' && hasValidUnderlying && optYear && optMonth)) && (
                  <ThemedText style={[styles.hint, { color: palette.muted }]}>No results found</ThemedText>
                )}
                {searchResults.slice(0, 10).map((r) => <ResultRow key={r.key} item={r} />)}
              </View>
            )}

            {error ? <ThemedText style={[styles.errorText, { color: '#dc2626' }]}>{error}</ThemedText> : null}

            {!loading && items.length === 0 && (
              <ThemedText style={[styles.empty, { color: palette.muted }]}>
                Watchlist is empty. Tap "+ Add" to search stocks, futures or options.
              </ThemedText>
            )}
          </>
        }
        ListEmptyComponent={null}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '700' },
  addSymbolBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addSymbolText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  searchPanel: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10, marginBottom: 10 },
  modeTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginBottom: 4 },
  modeTab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderBottomWidth: 2 },
  modeTabText: { fontWeight: '700', fontSize: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  hint: { fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  resultSymbol: { fontSize: 14, fontWeight: '700' },
  resultSub: { fontSize: 11, marginTop: 2 },
  addBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  lotsStepBtn: { borderWidth: 1, borderRadius: 6, width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },

  watchItem: { borderWidth: 1, borderRadius: 14, padding: 14 },
  watchTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  watchLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  watchSymbol: { fontSize: 15, fontWeight: '700' },
  watchKey: { fontSize: 11, marginTop: 2 },
  segTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  segTagText: { fontSize: 10, fontWeight: '700' },
  removeBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  priceText: { fontSize: 18, fontWeight: '700' },
  changePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  changeText: { fontSize: 13, fontWeight: '600' },
  absChange: { fontSize: 12 },
  noPrice: { fontSize: 12, marginTop: 6 },

  lotsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  lotsText: { fontSize: 12 },
  productBtn: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  productBtnText: { fontSize: 12, fontWeight: '700' },

  errorText: { fontSize: 13, marginVertical: 6 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
