import { useState } from "react";
import { ImageBackground, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useAuthContext } from "@/contexts/auth-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { showToast } from "@/lib/toast";

const STOCK_BG_IMAGE = {
  uri: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1600&q=80",
};

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const palette = Colors[colorScheme];
  const { login } = useAuthContext();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
      showToast("Login successful");
      router.replace("/upstox-token");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      showToast("Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ImageBackground source={STOCK_BG_IMAGE} style={styles.bg}>
      <View style={styles.bgOverlay} />
      <SafeAreaView edges={["top", "bottom"]} style={[styles.safe, { backgroundColor: "transparent" }]}> 
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
        <ThemedView style={[styles.container, { backgroundColor: "transparent" }]}> 
          <ImageBackground
            source={require('../assets/images/splash-icon.png')}
            imageStyle={{ opacity: 0.14, borderRadius: 16 }}
            style={[styles.brandCard, { borderColor: palette.border, backgroundColor: "rgba(15, 29, 54, 0.88)" }]}
          >
            <ThemedText style={[styles.eyebrow, { color: palette.accent }]}>EMA ALERT SYSTEM</ThemedText>
            <ThemedText type="title" style={[styles.title, { color: "#F8FBFF" }]}>Welcome Back</ThemedText>
            <ThemedText style={[styles.subtitle, { color: "#C7D5EF" }]}>Log in to continue live market monitoring</ThemedText>
          </ImageBackground>

          {error ? <ThemedText style={[styles.error, { color: "#FF9BA6" }]}>{error}</ThemedText> : null}

          <View style={[styles.card, { backgroundColor: "rgba(15, 29, 54, 0.88)", borderColor: "#2D4672" }]}> 
            <TextInput
              placeholder="Email"
              placeholderTextColor="#AFC3E6"
              value={email}
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setEmail}
              style={[styles.input, { color: "#F3F7FF", borderColor: "#2D4672" }]}
            />
            <View style={[styles.passwordWrap, { borderColor: "#2D4672" }]}> 
              <TextInput
                placeholder="Password"
                placeholderTextColor="#AFC3E6"
                value={password}
                secureTextEntry={!showPassword}
                onChangeText={setPassword}
                style={[styles.passwordInput, { color: "#F3F7FF" }]}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color="#AFC3E6"
                />
              </Pressable>
            </View>

            <Pressable onPress={handleSubmit} disabled={loading} style={[styles.button, { backgroundColor: palette.accent }]}> 
              <ThemedText style={styles.buttonText}>{loading ? "Logging in..." : "Log In"}</ThemedText>
            </Pressable>

            <Pressable onPress={() => router.push("/signup")}>
              <ThemedText style={[styles.link, { color: palette.accent }]}>New user? Create account</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
  },
  bgOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4, 12, 28, 0.72)",
  },
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 18,
  },
  eyebrow: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginBottom: 6 },
  brandCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
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
  passwordWrap: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
    paddingRight: 8,
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
