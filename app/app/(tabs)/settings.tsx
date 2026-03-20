import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAlertContext } from "@/contexts/alert-context";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { registerPushToken } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { requestPushPermissions } from "@/services/push-notification-service";

function formatIso(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.debugRow}>
      <ThemedText style={styles.debugLabel}>{label}</ThemedText>
      <ThemedText style={styles.debugValue}>{value}</ThemedText>
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleLeft}>
        <ThemedText type="defaultSemiBold">{label}</ThemedText>
        <ThemedText style={styles.hintText}>{hint}</ThemedText>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { state, dispatch } = useAlertContext();
  const { user, updateUpstoxToken, refreshMe, logout } = useAuthContext();
  const insets = useSafeAreaInsets();

  const [upstoxToken, setUpstoxToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  async function handleTokenUpdate() {
    if (!upstoxToken.trim()) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await updateUpstoxToken(upstoxToken.trim());
      await refreshMe();
      setUpstoxToken("");
      setMessage("Upstox token updated successfully.");
      showToast("Token updated. Market data will reconnect automatically.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update token");
      showToast("Token update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      showToast("Logged out successfully.");
    } catch {
      showToast("Logout failed. Please try again.");
    }
  }

  async function handleEnableNotifications() {
    setPushLoading(true);
    try {
      const result = await requestPushPermissions();
      if (!result.token) {
        if (result.reason === "permission_denied") {
          showToast("Notification permission denied. Open app settings and allow notifications.");
          await Linking.openSettings();
          return;
        }

        if (result.reason === "expo_go") {
          showToast("Use APK/dev build. Expo Go does not support remote push here.");
          return;
        }

        if (result.reason === "fcm_not_configured") {
          showToast("FCM not configured in Android build. Add google-services.json and rebuild APK.");
          return;
        }

        showToast(`Push token failed: ${result.detail || result.reason}`);
        return;
      }

      await registerPushToken(result.token);
      showToast("Notifications enabled successfully.");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to enable notifications.");
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ScrollView
        contentContainerStyle={{ paddingTop: Math.max(insets.top, 10), paddingBottom: insets.bottom + 90, gap: 14 }}
        showsVerticalScrollIndicator={false}>
      <ThemedText type="title" style={styles.title}>Settings</ThemedText>
      <ThemedText style={{ color: palette.muted }}>Signed in as {user?.email || "Unknown user"}</ThemedText>

      <ThemedView style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ToggleRow
          label="Vibration"
          hint="Vibrate phone on critical EMA signals"
          value={state.preferences.vibrationEnabled}
          onValueChange={(value) =>
            dispatch({ type: "SET_PREFERENCES", payload: { vibrationEnabled: value } })
          }
        />
        <ToggleRow
          label="Haptics"
          hint="Use tap-feedback for incoming alerts"
          value={state.preferences.hapticsEnabled}
          onValueChange={(value) =>
            dispatch({ type: "SET_PREFERENCES", payload: { hapticsEnabled: value } })
          }
        />
        <ToggleRow
          label="In-App Sound"
          hint="Play an in-app cue for new alerts"
          value={state.preferences.inAppSoundEnabled}
          onValueChange={(value) =>
            dispatch({ type: "SET_PREFERENCES", payload: { inAppSoundEnabled: value } })
          }
        />
        <ToggleRow
          label="Push Notifications"
          hint="Receive real-time alerts via Expo push"
          value={state.preferences.pushNotificationsEnabled}
          onValueChange={(value) =>
            dispatch({ type: "SET_PREFERENCES", payload: { pushNotificationsEnabled: value } })
          }
        />
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="defaultSemiBold">Upstox Token</ThemedText>
        {message ? <ThemedText style={{ color: palette.success, fontWeight: "700" }}>{message}</ThemedText> : null}
        {error ? <ThemedText style={{ color: palette.danger, fontWeight: "700" }}>{error}</ThemedText> : null}
        <TextInput
          value={upstoxToken}
          onChangeText={setUpstoxToken}
          autoCapitalize="none"
          placeholder="Paste new Upstox access token"
          placeholderTextColor={palette.muted}
          style={[styles.input, { color: palette.text, borderColor: palette.border }]}
        />
        <Pressable
          onPress={handleTokenUpdate}
          disabled={loading || !upstoxToken.trim()}
          style={[styles.primaryBtn, { backgroundColor: palette.accent }]}> 
          <ThemedText style={styles.primaryBtnText}>{loading ? "Updating..." : "Update Token"}</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
        <ThemedText type="defaultSemiBold">Debug Push Status</ThemedText>
        <DebugRow label="Stream" value={state.stream.connected ? "Connected" : "Disconnected"} />
        <DebugRow label="Reconnect Attempt" value={String(state.stream.reconnectAttempt)} />
        <DebugRow label="Last Stream Msg" value={formatIso(state.stream.lastMessageAt)} />
        <DebugRow label="Last Poll" value={formatIso(state.stream.lastAlertsPollAt)} />
        <DebugRow label="Poll Error" value={state.stream.lastAlertsPollError || "None"} />
        <DebugRow label="Push Status" value={state.stream.pushRegistration.status} />
        <DebugRow label="Push Last Attempt" value={formatIso(state.stream.pushRegistration.lastAttemptAt)} />
        <DebugRow label="Push Last Success" value={formatIso(state.stream.pushRegistration.lastSuccessAt)} />
        <DebugRow label="Push Error" value={state.stream.pushRegistration.error || "None"} />
        <Pressable
          onPress={handleEnableNotifications}
          disabled={pushLoading}
          style={[styles.secondaryBtn, { borderColor: palette.border, backgroundColor: palette.background, marginTop: 6 }]}>
          <ThemedText style={{ color: palette.text, fontWeight: "700" }}>
            {pushLoading ? "Requesting..." : "Allow Notifications"}
          </ThemedText>
        </Pressable>
      </ThemedView>

      <Pressable onPress={handleLogout} style={[styles.secondaryBtn, { borderColor: palette.border, backgroundColor: palette.card }]}> 
        <ThemedText style={{ color: palette.text, fontWeight: "700" }}>Log Out</ThemedText>
      </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  title: { fontSize: 28, lineHeight: 34 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  toggleLeft: { flex: 1, gap: 2 },
  hintText: { opacity: 0.7, fontSize: 12, lineHeight: 18 },
  debugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  debugLabel: {
    opacity: 0.75,
    fontSize: 12,
  },
  debugValue: {
    fontSize: 12,
    fontWeight: "700",
    maxWidth: "58%",
    textAlign: "right",
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#0B1220",
    fontWeight: "700",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: -2,
  },
});
