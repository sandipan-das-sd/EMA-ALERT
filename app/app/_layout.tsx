import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AlertProvider } from '@/contexts/alert-context';
import { AuthProvider, useAuthContext } from '@/contexts/auth-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAlertStream } from '@/hooks/use-alert-stream';
import { usePushNotifications } from '@/hooks/use-push-notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

function AppShell() {
  const { user, ready } = useAuthContext();
  const segments = useSegments();

  const inAuthRoute = segments[0] === 'login' || segments[0] === 'signup';
  const inTokenRoute = segments[0] === 'upstox-token';
  const hasUpstoxToken = !!user?.hasUpstoxToken;
  const shouldEnableRealtime = !!user?.id;

  useAlertStream(shouldEnableRealtime);
  usePushNotifications(shouldEnableRealtime);

  useEffect(() => {
    if (!ready) return;

    if (!user && !inAuthRoute) {
      router.replace('/login');
      return;
    }

    if (user && !hasUpstoxToken && !inTokenRoute) {
      router.replace('/upstox-token');
      return;
    }

    if (user && hasUpstoxToken && (inAuthRoute || inTokenRoute)) {
      router.replace('/(tabs)');
    }
  }, [ready, user, hasUpstoxToken, inAuthRoute, inTokenRoute]);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="upstox-token" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Alert Details' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const navTheme =
    colorScheme === 'dark'
      ? {
          ...DarkTheme,
          colors: {
            ...DarkTheme.colors,
            background: Colors.dark.background,
            card: Colors.dark.card,
            text: Colors.dark.text,
            border: Colors.dark.border,
            primary: Colors.dark.accent,
          },
        }
      : {
          ...DefaultTheme,
          colors: {
            ...DefaultTheme.colors,
            background: Colors.light.background,
            card: Colors.light.card,
            text: Colors.light.text,
            border: Colors.light.border,
            primary: Colors.light.accent,
          },
        };

  return (
    <ThemeProvider value={navTheme}>
      <AuthProvider>
        <AlertProvider>
          <AppShell />
        </AlertProvider>
      </AuthProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
