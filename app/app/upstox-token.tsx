import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function UpstoxTokenScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { updateUpstoxToken, refreshMe, logout } = useAuthContext();

  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      await updateUpstoxToken(token.trim());
      await refreshMe();
      setMessage("Token updated. Redirecting to dashboard...");
      setTimeout(() => {
        router.replace("/(tabs)");
      }, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update token");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
        <ThemedText style={[styles.eyebrow, { color: palette.accent }]}>EMA ALERT</ThemedText>
        <ThemedText type="title" style={styles.title}>Upstox Token</ThemedText>
        <ThemedText style={[styles.subtitle, { color: palette.muted }]}>Paste your Upstox access token before entering dashboard</ThemedText>

        {message ? <ThemedText style={[styles.ok, { color: palette.success }]}>{message}</ThemedText> : null}
        {error ? <ThemedText style={[styles.error, { color: palette.danger }]}>{error}</ThemedText> : null}

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <TextInput
            placeholder="Paste Upstox access token"
            placeholderTextColor={palette.muted}
            value={token}
            autoCapitalize="none"
            onChangeText={setToken}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />

          <Pressable onPress={handleSave} disabled={loading || !token.trim()} style={[styles.button, { backgroundColor: palette.accent }]}> 
            <ThemedText style={styles.buttonText}>{loading ? "Updating..." : "Update Token"}</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.replace("/(tabs)")} style={[styles.secondaryBtn, { borderColor: palette.border }]}> 
            <ThemedText style={{ color: palette.text, fontWeight: "700" }}>Skip for now</ThemedText>
          </Pressable>

          <Pressable onPress={logout}>
            <ThemedText style={[styles.link, { color: palette.accent }]}>Log out</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 18 },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 28, lineHeight: 34 },
  subtitle: { marginTop: 6, marginBottom: 18 },
  ok: { marginBottom: 8, fontWeight: "600" },
  error: { marginBottom: 8, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#0B1220",
    fontWeight: "700",
  },
  link: {
    marginTop: 6,
    textAlign: "center",
    fontWeight: "700",
  },
});
