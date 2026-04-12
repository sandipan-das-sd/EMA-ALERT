import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { getUpstoxOAuthStatus, logoutUpstox, startUpstoxOAuth } from "@/lib/api";

export default function UpstoxTokenScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { updateUpstoxToken, refreshMe, logout } = useAuthContext();
  const insets = useSafeAreaInsets();

  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthState, setOauthState] = useState("");
  const [oauthExpiry, setOauthExpiry] = useState<number | null>(null);

  const oauthActive = useMemo(() => {
    if (!oauthState) return false;
    if (!oauthExpiry) return true;
    return Date.now() < oauthExpiry;
  }, [oauthState, oauthExpiry]);

  useEffect(() => {
    if (!oauthState) return;

    const interval = setInterval(async () => {
      try {
        const statusResp = await getUpstoxOAuthStatus(oauthState);
        if (statusResp.status === "success") {
          clearInterval(interval);
          setOauthState("");
          setOauthExpiry(null);
          setMessage("Upstox connected. Redirecting to dashboard...");
          await refreshMe();
          router.replace("/(tabs)");
          return;
        }

        if (statusResp.status === "error" || statusResp.status === "expired") {
          clearInterval(interval);
          setOauthState("");
          setOauthExpiry(null);
          setError(statusResp.message || "Upstox authorization failed. Please retry.");
        }
      } catch (pollError) {
        const text = pollError instanceof Error ? pollError.message : "Failed to check OAuth status";
        if (!/pending/i.test(text)) {
          clearInterval(interval);
          setOauthState("");
          setOauthExpiry(null);
          setError(text);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [oauthState, refreshMe]);

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

  async function handleConnectUpstox() {
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const start = await startUpstoxOAuth();
      setOauthState(start.state);
      setOauthExpiry(start.expiresAt);
      setMessage("Browser opened. Complete Upstox login and return to app.");
      await WebBrowser.openBrowserAsync(start.authorizeUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Upstox authorization");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckStatusNow() {
    if (!oauthState) {
      setError("No active authorization request. Tap Connect Upstox first.");
      return;
    }

    setError("");
    setMessage("");
    setLoading(true);
    try {
      const statusResp = await getUpstoxOAuthStatus(oauthState);
      if (statusResp.status === "success") {
        setOauthState("");
        setOauthExpiry(null);
        setMessage("Upstox connected. Redirecting to dashboard...");
        await refreshMe();
        router.replace("/(tabs)");
        return;
      }
      if (statusResp.status === "pending") {
        setMessage("Authorization still pending. Approve in browser, then check again.");
        return;
      }

      setOauthState("");
      setOauthExpiry(null);
      setError(statusResp.message || "Upstox authorization failed. Please retry.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check authorization status");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpstoxLogout() {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await logoutUpstox();
      await refreshMe();
      setOauthState("");
      setOauthExpiry(null);
      setToken("");
      setMessage("Disconnected from Upstox. Connect again to continue.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to logout from Upstox");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.safe, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
      <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
        <ThemedText style={[styles.eyebrow, { color: palette.accent }]}>EMA ALERT</ThemedText>
        <ThemedText type="title" style={styles.title}>Upstox Token</ThemedText>
        <ThemedText style={[styles.subtitle, { color: palette.muted }]}>Connect your Upstox account using OAuth. Manual token paste is kept as fallback.</ThemedText>

        {message ? <ThemedText style={[styles.ok, { color: palette.success }]}>{message}</ThemedText> : null}
        {error ? <ThemedText style={[styles.error, { color: palette.danger }]}>{error}</ThemedText> : null}

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <Pressable onPress={handleConnectUpstox} disabled={loading} style={[styles.button, { backgroundColor: palette.accent }]}> 
            <ThemedText style={styles.buttonText}>{loading ? "Working..." : "Connect Upstox (Auto)"}</ThemedText>
          </Pressable>

          <Pressable onPress={handleCheckStatusNow} disabled={loading || !oauthState} style={[styles.secondaryBtn, { borderColor: palette.border }]}> 
            <ThemedText style={{ color: palette.text, fontWeight: "700" }}>
              {oauthActive ? "I have approved, check status" : "Authorization expired, reconnect"}
            </ThemedText>
          </Pressable>

          <Pressable onPress={handleUpstoxLogout} disabled={loading} style={[styles.secondaryBtn, { borderColor: palette.border }]}> 
            <ThemedText style={{ color: palette.text, fontWeight: "700" }}>Disconnect Upstox</ThemedText>
          </Pressable>

          <View style={[styles.separator, { borderColor: palette.border }]} />

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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 18,
  },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 28, lineHeight: 34 },
  subtitle: { marginTop: 6, marginBottom: 18 },
  ok: { marginBottom: 8, fontWeight: "600" },
  error: { marginBottom: 8, fontWeight: "600" },
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  separator: {
    borderBottomWidth: 1,
    marginVertical: 2,
  },
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
