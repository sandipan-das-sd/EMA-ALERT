import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  getBrokerageDetails,
  getPnlCharges,
  getPnlData,
  getPnlMeta,
  getPortfolioFunds,
  getPortfolioHoldings,
  getPortfolioOrders,
  getPortfolioPositions,
  getActiveTrades,
  getPortfolioProfile,
  type ActiveTrade,
  type BrokerageResult,
  type PortfolioFunds,
  type PortfolioHolding,
  type PortfolioOrder,
  type PortfolioPosition,
  type PortfolioProfile,
  type PnlTrade,
} from "@/lib/api";
import { APP_CONFIG } from "@/lib/config";
import { showToast } from "@/lib/toast";

type TabKey = "positions" | "orders" | "holdings" | "pnl";

function fmt(n?: number | null, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtCurrency(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MetricCard({
  label,
  value,
  valueColor,
  palette,
}: {
  label: string;
  value: string;
  valueColor?: string;
  palette: (typeof Colors)["light"];
}) {
  return (
    <View style={[styles.metricCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>{label}</ThemedText>
      <ThemedText style={[styles.metricValue, valueColor ? { color: valueColor } : {}]}>{value}</ThemedText>
    </View>
  );
}

function StatusBadge({ status, palette }: { status: string; palette: (typeof Colors)["light"] }) {
  const s = (status || "").toLowerCase();
  let bg = palette.muted + "33";
  let color = palette.muted;
  if (s === "complete" || s === "filled") { bg = "#16a34a33"; color = "#16a34a"; }
  else if (s === "open" || s === "trigger pending") { bg = "#2563eb33"; color = "#2563eb"; }
  else if (s === "rejected" || s === "cancelled") { bg = "#dc262633"; color = "#dc2626"; }
  else if (s === "put order req received" || s === "validation pending" || s === "open pending") {
    bg = "#d9770633"; color = "#d97706";
  }
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <ThemedText style={[styles.badgeText, { color }]}>{status || "—"}</ThemedText>
    </View>
  );
}

function OrderRow({ item, palette }: { item: PortfolioOrder; palette: (typeof Colors)["light"] }) {
  const isBuy = item.transaction_type?.toUpperCase() === "BUY";
  const filled = item.filled_quantity ?? 0;
  const total = item.quantity ?? 0;
  const ts = item.order_timestamp ? new Date(item.order_timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
  return (
    <View style={[styles.rowCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.rowTop}>
        <ThemedText style={styles.rowSymbol}>{item.trading_symbol}</ThemedText>
        <StatusBadge status={item.status} palette={palette} />
      </View>
      <View style={styles.rowMid}>
        <View style={[styles.sidePill, { backgroundColor: isBuy ? "#16a34a22" : "#dc262622" }]}>
          <ThemedText style={[styles.sideText, { color: isBuy ? "#16a34a" : "#dc2626" }]}>
            {item.transaction_type}
          </ThemedText>
        </View>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          {filled}/{total} qty  ·  {item.order_type}  ·  {item.product}
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>{ts}</ThemedText>
      </View>
      <View style={styles.rowBottom}>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Price: <ThemedText style={{ color: palette.text }}>₹{fmt(item.price)}</ThemedText>
        </ThemedText>
        {(item.trigger_price ?? 0) > 0 && (
          <ThemedText style={[styles.rowDetail, { color: "#dc2626" }]}>
            Trigger: <ThemedText style={{ color: "#dc2626", fontWeight: "700" }}>₹{fmt(item.trigger_price)}</ThemedText>
          </ThemedText>
        )}
        {(item.average_price ?? 0) > 0 && (
          <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
            Avg: <ThemedText style={{ color: palette.text }}>₹{fmt(item.average_price)}</ThemedText>
          </ThemedText>
        )}
      </View>
    </View>
  );
}

function PositionRow({ item, trade, palette }: { item: PortfolioPosition; trade?: ActiveTrade; palette: (typeof Colors)["light"] }) {
  const pnl = item.pnl ?? (item.unrealised_profit ?? 0) + (item.realised_profit ?? 0);
  const qty = item.quantity ?? 0;
  const pnlColor = pnl >= 0 ? "#16a34a" : "#dc2626";
  const isShort = qty < 0;
  const isClosed = qty === 0;
  return (
    <View style={[styles.rowCard, { backgroundColor: palette.card, borderColor: palette.border, opacity: isClosed ? 0.5 : 1 }]}>
      <View style={styles.rowTop}>
        <ThemedText style={[styles.rowSymbol, { flex: 1 }]}>{item.trading_symbol}</ThemedText>
        <ThemedText style={[styles.pnlText, { color: pnlColor }]}>
          {pnl >= 0 ? "+" : ""}₹{fmt(Math.abs(pnl))}
        </ThemedText>
      </View>
      <View style={[styles.rowMid, { marginBottom: 2 }]}>
        <View style={[styles.sidePill, { backgroundColor: isClosed ? palette.muted + "22" : isShort ? "#dc262622" : "#16a34a22" }]}>
          <ThemedText style={[styles.sideText, { color: isClosed ? palette.muted : isShort ? "#dc2626" : "#16a34a" }]}>
            {isClosed ? "CLOSED" : isShort ? "SHORT" : "LONG"}
          </ThemedText>
        </View>
      </View>
      <View style={styles.rowMid}>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Qty: <ThemedText style={{ color: palette.text }}>{item.quantity}</ThemedText>
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Buy: <ThemedText style={{ color: palette.text }}>₹{fmt(item.buy_price)}</ThemedText>
        </ThemedText>
        {(item.sell_price ?? 0) > 0 && (
          <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
            Sell: <ThemedText style={{ color: palette.text }}>₹{fmt(item.sell_price)}</ThemedText>
          </ThemedText>
        )}
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>{item.product}</ThemedText>
      </View>
      {trade && (
        <View style={[styles.tradeInfoRow, { borderTopColor: palette.border }]}>
          <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
            Entry: <ThemedText style={{ color: palette.text }}>₹{fmt(trade.entryPrice)}</ThemedText>
          </ThemedText>
          <ThemedText style={[styles.rowDetail, { color: "#dc2626" }]}>
            SL: <ThemedText style={{ color: "#dc2626", fontWeight: "700" }}>₹{fmt(trade.currentTrailSL)}</ThemedText>
          </ThemedText>
          <ThemedText style={[styles.rowDetail, { color: "#16a34a" }]}>
            Target: <ThemedText style={{ color: "#16a34a", fontWeight: "700" }}>₹{fmt(trade.target1)}</ThemedText>
          </ThemedText>
          {trade.status === 'pending_entry' && (
            <ThemedText style={[styles.rowDetail, { color: "#d97706" }]}>⏳ Pending fill</ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

function HoldingRow({ item, palette }: { item: PortfolioHolding; palette: (typeof Colors)["light"] }) {
  const pnl = item.pnl;
  const pnlColor = (pnl ?? 0) >= 0 ? "#16a34a" : "#dc2626";
  return (
    <View style={[styles.rowCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.rowTop}>
        <ThemedText style={styles.rowSymbol}>{item.trading_symbol}</ThemedText>
        {pnl != null && (
          <ThemedText style={[styles.pnlText, { color: pnlColor }]}>
            {pnl >= 0 ? "+" : ""}₹{fmt(Math.abs(pnl))}
          </ThemedText>
        )}
      </View>
      <View style={styles.rowMid}>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Qty: <ThemedText style={{ color: palette.text }}>{item.quantity}</ThemedText>
          {(item.t1_quantity ?? 0) > 0 ? `  T1: ${item.t1_quantity}` : ""}
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Avg: <ThemedText style={{ color: palette.text }}>₹{fmt(item.average_price)}</ThemedText>
        </ThemedText>
        {(item.last_price ?? 0) > 0 && (
          <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
            LTP: <ThemedText style={{ color: palette.text }}>₹{fmt(item.last_price)}</ThemedText>
          </ThemedText>
        )}
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>{item.exchange}</ThemedText>
      </View>
    </View>
  );
}

function PnlRow({ item, palette }: { item: PnlTrade; palette: (typeof Colors)["light"] }) {
  const pnl = (item.sell_amount ?? 0) - (item.buy_amount ?? 0);
  const pnlColor = pnl >= 0 ? "#16a34a" : "#dc2626";
  return (
    <View style={[styles.rowCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.rowTop}>
        <ThemedText style={styles.rowSymbol}>{item.scrip_name}</ThemedText>
        <ThemedText style={[styles.pnlText, { color: pnlColor }]}>
          {pnl >= 0 ? "+" : ""}₹{fmt(Math.abs(pnl))}
        </ThemedText>
      </View>
      <View style={styles.rowMid}>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Qty: <ThemedText style={{ color: palette.text }}>{item.quantity}</ThemedText>
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Buy: <ThemedText style={{ color: palette.text }}>₹{fmt(item.buy_average)}</ThemedText>
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          Sell: <ThemedText style={{ color: palette.text }}>₹{fmt(item.sell_average)}</ThemedText>
        </ThemedText>
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>{item.trade_type}</ThemedText>
      </View>
      {item.sell_date && (
        <ThemedText style={[styles.rowDetail, { color: palette.muted }]}>
          {item.buy_date} → {item.sell_date}
        </ThemedText>
      )}
    </View>
  );
}

export default function PortfolioScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  const [activeTab, setActiveTab] = useState<TabKey>("positions");
  const [funds, setFunds] = useState<PortfolioFunds | null>(null);
  const [profile, setProfile] = useState<PortfolioProfile | null>(null);
  const [orders, setOrders] = useState<PortfolioOrder[]>([]);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [pnlTrades, setPnlTrades] = useState<PnlTrade[]>([]);
  const [pnlCharges, setPnlCharges] = useState<{ charges_breakdown?: any } | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlSegment, setPnlSegment] = useState<'EQ' | 'FO'>('EQ');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Compute current financial year string e.g. "2526" for April 2025–March 2026
  const financialYear = useMemo(() => {
    const now = new Date();
    const yr = now.getFullYear();
    const month = now.getMonth() + 1; // 1-based
    const fyStart = month >= 4 ? yr : yr - 1;
    const fyEnd = fyStart + 1;
    return `${String(fyStart).slice(-2)}${String(fyEnd).slice(-2)}`;
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deduplicate orders by order_id (keep latest)
  const dedupeOrders = useCallback((raw: PortfolioOrder[]) => {
    const map = new Map<string, PortfolioOrder>();
    for (const o of raw) {
      const existing = map.get(o.order_id);
      if (!existing || (o.order_timestamp ?? "") > (existing.order_timestamp ?? "")) {
        map.set(o.order_id, o);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.order_timestamp ?? "") > (a.order_timestamp ?? "") ? 1 : -1
    );
  }, []);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [f, prof, o, p, h, at] = await Promise.all([
        getPortfolioFunds(),
        getPortfolioProfile(),
        getPortfolioOrders(),
        getPortfolioPositions(),
        getPortfolioHoldings(),
        getActiveTrades(),
      ]);
      setFunds(f);
      setProfile(prof);
      setOrders(dedupeOrders(o));
      setPositions(p);
      setHoldings(h);
      setActiveTrades(at);
      setLastUpdated(new Date());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load portfolio";
      setError(msg);
      if (!silent) showToast(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dedupeOrders]);

  const fetchPnl = useCallback(async (segment: 'EQ' | 'FO') => {
    setPnlLoading(true);
    try {
      const meta = await getPnlMeta(segment, financialYear);
      const pageSize = Math.min(meta?.page_size_limit ?? 100, 500);
      const [trades, charges] = await Promise.all([
        getPnlData(segment, financialYear, 1, pageSize),
        getPnlCharges(segment, financialYear),
      ]);
      setPnlTrades(trades);
      setPnlCharges(charges);
    } catch {
      setPnlTrades([]);
      setPnlCharges(null);
    } finally {
      setPnlLoading(false);
    }
  }, [financialYear]);

  // WebSocket for real-time portfolio updates
  const connectWs = useCallback(() => {
    if (!user?.id) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(APP_CONFIG.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "identify", userId: user.id }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "portfolio_update" && msg.userId === user.id) {
            const update = msg.data;
            if (update?.update_type === "order" && update.orders) {
              setOrders((prev) => dedupeOrders([...prev, ...update.orders]));
            } else if (update?.update_type === "position" && update.positions) {
              setPositions(update.positions);
            } else if (update?.update_type === "holding" && update.holdings) {
              setHoldings(update.holdings);
            }
            setLastUpdated(new Date());
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
        wsReconnectTimer.current = setTimeout(connectWs, 8000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // ignore ws init errors
    }
  }, [user?.id, dedupeOrders]);

  useEffect(() => {
    fetchAll();
    connectWs();
    return () => {
      if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [fetchAll, connectWs]);

  // Load P&L when switching to pnl tab or changing segment
  useEffect(() => {
    if (activeTab === 'pnl') fetchPnl(pnlSegment);
  }, [activeTab, pnlSegment, fetchPnl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll(true);
  }, [fetchAll]);

  const eq = funds?.equity;
  const available = eq?.available_margin ?? 0;
  const used = eq?.used_margin ?? 0;
  const payin = eq?.payin_amount ?? 0;
  const exposure = eq?.exposure_margin ?? 0;
  const totalDayPnl = positions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);

  const openPositions = positions.filter(p => (p.quantity ?? 0) !== 0);
  const closedPositions = positions.filter(p => (p.quantity ?? 0) === 0);
  const sortedPositions = [...openPositions, ...closedPositions];

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "positions", label: "Positions", count: openPositions.length },
    { key: "orders", label: "Orders", count: orders.length },
    { key: "holdings", label: "Holdings", count: holdings.length },
    { key: "pnl", label: "P&L", count: 0 },
  ];

  if (loading) {
    return (
      <ThemedView style={[styles.container, { backgroundColor: palette.background }]}>
        <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
          <ActivityIndicator size="large" color={palette.tint} />
          <ThemedText style={[styles.loadingText, { color: palette.muted }]}>Loading portfolio…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const renderItem =
    activeTab === "orders"
      ? ({ item }: { item: PortfolioOrder }) => <OrderRow item={item} palette={palette} />
      : activeTab === "positions"
      ? ({ item }: { item: PortfolioPosition }) => {
          const trade = activeTrades.find(
            t => item.instrument_token
              ? t.instrumentKey === item.instrument_token
              : t.instrumentKey.endsWith(`|${item.trading_symbol}`) ||
                item.trading_symbol === t.instrumentKey.split('|')[1]
          );
          return <PositionRow item={item} trade={trade} palette={palette} />;
        }
      : activeTab === "pnl"
      ? ({ item }: { item: PnlTrade }) => <PnlRow item={item} palette={palette} />
      : ({ item }: { item: PortfolioHolding }) => <HoldingRow item={item} palette={palette} />;

  const data =
    activeTab === "orders" ? orders
    : activeTab === "positions" ? sortedPositions
    : activeTab === "pnl" ? pnlTrades
    : holdings;

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}>
      <FlatList
        data={data as any[]}
        keyExtractor={(item, i) =>
          activeTab === "orders"
            ? (item as PortfolioOrder).order_id ?? String(i)
            : activeTab === "positions"
            ? `${(item as PortfolioPosition).trading_symbol}_${(item as PortfolioPosition).product}_${i}`
            : `${(item as PortfolioHolding).trading_symbol}_${i}`
        }
        renderItem={renderItem as any}
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 10),
          paddingBottom: insets.bottom + 90,
          paddingHorizontal: 16,
          gap: 8,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.tint}
          />
        }
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.header}>
              <View>
                <ThemedText type="title" style={styles.title}>Portfolio</ThemedText>
                {profile?.user_name && (
                  <ThemedText style={[styles.profileName, { color: palette.muted }]}>
                    {profile.user_name}{profile.user_id ? ` · ${profile.user_id}` : ''}
                  </ThemedText>
                )}
              </View>
              <View style={styles.headerRight}>
                {lastUpdated && (
                  <ThemedText style={[styles.updatedText, { color: palette.muted }]}>
                    {lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </ThemedText>
                )}
                <Pressable
                  onPress={() => fetchAll(true)}
                  style={[styles.refreshBtn, { borderColor: palette.border }]}>
                  <ThemedText style={{ color: palette.tint, fontSize: 13, fontWeight: "600" }}>Refresh</ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Error banner */}
            {error && (
              <View style={[styles.errorBanner, { backgroundColor: "#dc262622", borderColor: "#dc2626" }]}>
                <ThemedText style={{ color: "#dc2626", fontSize: 13 }}>{error}</ThemedText>
                {!user?.hasUpstoxToken && (
                  <ThemedText style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>
                    Connect your Upstox account in Settings → Upstox Token.
                  </ThemedText>
                )}
              </View>
            )}

            {/* Day P&L summary */}
            {!error && positions.length > 0 && (
              <View style={[styles.pnlSummary, { backgroundColor: totalDayPnl >= 0 ? "#16a34a18" : "#dc262618", borderColor: totalDayPnl >= 0 ? "#16a34a" : "#dc2626" }]}>
                <ThemedText style={[styles.pnlSummaryLabel, { color: palette.muted }]}>Day P&L</ThemedText>
                <ThemedText style={[styles.pnlSummaryValue, { color: totalDayPnl >= 0 ? "#16a34a" : "#dc2626" }]}>
                  {totalDayPnl >= 0 ? "+" : ""}₹{fmt(Math.abs(totalDayPnl))}
                </ThemedText>
              </View>
            )}

            {/* Funds cards */}
            {!error && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.metricsRow} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                <MetricCard label="Available" value={fmtCurrency(available)} palette={palette} />
                <MetricCard label="Used Margin" value={fmtCurrency(used)} palette={palette} />
                <MetricCard label="Today Payin" value={fmtCurrency(payin)} palette={palette} />
                <MetricCard label="Exposure" value={fmtCurrency(exposure)} palette={palette} />
                {(funds?.equity?.span_margin ?? 0) > 0 && (
                  <MetricCard label="SPAN" value={fmtCurrency(funds?.equity?.span_margin)} palette={palette} />
                )}
              </ScrollView>
            )}

            {/* P&L segment selector (shown only on P&L tab) */}
            {activeTab === 'pnl' && (
              <View style={[styles.segmentRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
                {(['EQ', 'FO'] as const).map(seg => (
                  <Pressable
                    key={seg}
                    style={[styles.segBtn, pnlSegment === seg && { backgroundColor: palette.tint }]}
                    onPress={() => setPnlSegment(seg)}>
                    <ThemedText style={[
                      styles.segBtnText,
                      { color: pnlSegment === seg ? '#fff' : palette.muted },
                    ]}>{seg === 'EQ' ? 'Equity' : 'F&O'}</ThemedText>
                  </Pressable>
                ))}
                {pnlCharges?.charges_breakdown && (
                  <ThemedText style={[styles.chargesText, { color: palette.muted }]}>
                    Charges: ₹{fmt(pnlCharges.charges_breakdown.total)}
                  </ThemedText>
                )}
              </View>
            )}

            {/* Tabs */}
            <View style={[styles.tabBar, { borderColor: palette.border }]}>
              {tabs.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    style={[
                      styles.tabBtn,
                      active && [styles.tabBtnActive, { borderBottomColor: palette.tint }],
                    ]}
                    onPress={() => setActiveTab(tab.key)}>
                    <ThemedText
                      style={[
                        styles.tabLabel,
                        { color: active ? palette.tint : palette.muted },
                      ]}>
                      {tab.label}
                      {tab.count > 0 ? ` (${tab.count})` : ""}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {activeTab === 'pnl' && pnlLoading
              ? <ActivityIndicator size="large" color={palette.tint} />
              : <ThemedText style={[styles.emptyText, { color: palette.muted }]}>
                  {error
                    ? "Could not load data"
                    : activeTab === "orders"
                    ? "No orders today"
                    : activeTab === "positions"
                    ? "No open positions"
                    : activeTab === "pnl"
                    ? "No P&L data for this financial year"
                    : "No holdings found"}
                </ThemedText>
            }
          </View>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 24, fontWeight: "700" },
  updatedText: { fontSize: 11 },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },

  errorBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },

  pnlSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 10,
  },
  pnlSummaryLabel: { fontSize: 13 },
  pnlSummaryValue: { fontSize: 18, fontWeight: "700" },

  metricsRow: { marginBottom: 14 },
  metricCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minWidth: 110,
    alignItems: "flex-start",
  },
  metricLabel: { fontSize: 11, marginBottom: 4 },
  metricValue: { fontSize: 16, fontWeight: "700" },

  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: 10,
  },
  tabBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomWidth: 2 },
  tabLabel: { fontSize: 13, fontWeight: "600" },

  rowCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 2,
    gap: 6,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowMid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  rowBottom: { flexDirection: "row", gap: 12 },
  rowSymbol: { fontSize: 15, fontWeight: "700", flex: 1 },
  rowDetail: { fontSize: 12 },
  pnlText: { fontSize: 15, fontWeight: "700" },

  sidePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sideText: { fontSize: 11, fontWeight: "700" },
  tradeInfoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
  },

  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: { fontSize: 10, fontWeight: "600" },

  empty: { paddingTop: 40, alignItems: "center" },
  emptyText: { fontSize: 15 },

  profileName: { fontSize: 12, marginTop: 2 },

  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 4,
    marginBottom: 10,
    gap: 4,
  },
  segBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 7,
  },
  segBtnText: { fontSize: 12, fontWeight: "600" },
  chargesText: { fontSize: 12, marginLeft: "auto", paddingRight: 6 },
});
