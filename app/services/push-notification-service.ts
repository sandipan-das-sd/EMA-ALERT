import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

async function loadNotifications() {
  return import('expo-notifications');
}

export type PushTokenResult = {
  token: string | null;
  reason:
    | 'ok'
    | 'expo_go'
    | 'not_physical_device'
    | 'permission_denied'
    | 'missing_project_id'
    | 'token_fetch_error';
  detail?: string;
};

function isExpoGoClient() {
  return Constants.executionEnvironment === 'storeClient';
}

/**
 * Configure notification handler
 */
export function configureNotifications() {
  if (isExpoGoClient()) {
    console.log('[Push] Expo Go detected. Remote push is disabled in Expo Go SDK 53+.');
    return;
  }

  loadNotifications()
    .then(async (Notifications) => {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('alerts', {
          name: 'EMA Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 200, 100, 250],
          lightColor: '#2D6A4F',
          sound: 'default',
          enableVibrate: true,
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
    })
    .catch((error) => {
      console.warn('[Push] Failed to initialize notification handler:', error);
    });
}

/**
 * Request notification permissions and get push token
 */
export async function requestPushPermissions(): Promise<PushTokenResult> {
  try {
    if (isExpoGoClient()) {
      console.log('[Push] Skipping remote push token in Expo Go. Use a development build.');
      return { token: null, reason: 'expo_go' };
    }

    // Check if device is physical (not emulator/simulator)
    if (!Device.isDevice) {
      console.log('[Push] Not a physical device, skipping push token request');
      return { token: null, reason: 'not_physical_device' };
    }

    const Notifications = await loadNotifications();

    // Get current permission status
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission denied by user');
      return { token: null, reason: 'permission_denied' };
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    if (!projectId) {
      console.warn('[Push] Missing EAS projectId for getExpoPushTokenAsync');
      return { token: null, reason: 'missing_project_id' };
    }

    // Get the push token
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log(`[Push] ✓ Token acquired: ${token.data.substring(0, 20)}...`);
    return { token: token.data, reason: 'ok' };
  } catch (error) {
    console.error('[Push] Error requesting permissions:', error);
    return {
      token: null,
      reason: 'token_fetch_error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications() {
  try {
    const Notifications = await loadNotifications();
    await Notifications.dismissAllNotificationsAsync();
    console.log('[Push] Cleared all notifications');
  } catch (error) {
    console.error('[Push] Error clearing notifications:', error);
  }
}

/**
 * Send local notification for testing
 */
export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, string>
) {
  try {
    const Notifications = await loadNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: true,
        badge: 1,
        ...(Platform.OS === 'android' ? { channelId: 'alerts' } : {}),
      },
      trigger: { type: 'timeInterval', seconds: 1 } as any,
    });
  } catch (error) {
    console.error('[Push] Error sending local notification:', error);
  }
}
