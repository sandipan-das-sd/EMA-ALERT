import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

/**
 * Configure notification handler
 */
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Request notification permissions and get push token
 */
export async function requestPushPermissions(): Promise<string | null> {
  try {
    // Check if device is physical (not emulator/simulator)
    if (!Device.isDevice) {
      console.log('[Push] Not a physical device, skipping push token request');
      return null;
    }

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
      return null;
    }

    // Get the push token
    const token = await Notifications.getExpoPushTokenAsync();
    console.log(`[Push] ✓ Token acquired: ${token.data.substring(0, 20)}...`);
    return token.data;
  } catch (error) {
    console.error('[Push] Error requesting permissions:', error);
    return null;
  }
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications() {
  try {
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
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: true,
        badge: 1,
      },
      trigger: { type: 'timeInterval', seconds: 1 } as any,
    });
  } catch (error) {
    console.error('[Push] Error sending local notification:', error);
  }
}
