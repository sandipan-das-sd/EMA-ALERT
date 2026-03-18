import { useState } from "react";
import { Pressable, SafeAreaView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";

export default function SignupScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { signup } = useAuthContext();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      await signup(name.trim(), email.trim(), password);
      router.replace("/upstox-token");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <ThemedView style={[styles.container, { backgroundColor: palette.background }]}> 
        <ThemedText style={[styles.eyebrow, { color: palette.accent }]}>EMA ALERT</ThemedText>
        <ThemedText type="title" style={styles.title}>Create Account</ThemedText>
        <ThemedText style={[styles.subtitle, { color: palette.muted }]}>Sign up first, then set Upstox token</ThemedText>

        {error ? <ThemedText style={[styles.error, { color: palette.danger }]}>{error}</ThemedText> : null}

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}> 
          <TextInput
            placeholder="Name"
            placeholderTextColor={palette.muted}
            value={name}
            onChangeText={setName}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />
          <TextInput
            placeholder="Email"
            placeholderTextColor={palette.muted}
            value={email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />
          <TextInput
            placeholder="Password (min 8 chars)"
            placeholderTextColor={palette.muted}
            value={password}
            secureTextEntry
            onChangeText={setPassword}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />

          <Pressable onPress={handleSubmit} disabled={loading} style={[styles.button, { backgroundColor: palette.accent }]}> 
            <ThemedText style={styles.buttonText}>{loading ? "Creating..." : "Sign Up"}</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.push("/login")}>
            <ThemedText style={[styles.link, { color: palette.accent }]}>Already have account? Log in</ThemedText>
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
  error: { marginBottom: 10, fontWeight: "600" },
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
