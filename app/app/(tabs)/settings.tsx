import { StyleSheet, Switch, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAlertContext } from "@/contexts/alert-context";
import { APP_CONFIG } from "@/lib/config";
import { useColorScheme } from "@/hooks/use-color-scheme";

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

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
      <ThemedText type="title" style={styles.title}>Settings</ThemedText>

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
          hint="Prepare for push/local notification sound"
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
        <ThemedText type="defaultSemiBold">Connection</ThemedText>
        <ThemedText style={styles.rowText}>API: {APP_CONFIG.apiBase}</ThemedText>
        <ThemedText style={styles.rowText}>WS: {APP_CONFIG.wsUrl}</ThemedText>
        <ThemedText style={styles.rowText}>
          Stream: {state.stream.connected ? "Connected" : "Disconnected"}
        </ThemedText>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 14 },
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
  rowText: { opacity: 0.75, fontSize: 13, lineHeight: 18 },
});
