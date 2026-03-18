import * as Haptics from "expo-haptics";
import { Vibration } from "react-native";
import type { AlertPreferences, EmaAlert } from "@/types/alert";

export async function notifyOnCriticalAlert(alert: EmaAlert, preferences: AlertPreferences) {
  if (preferences.hapticsEnabled) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  if (preferences.vibrationEnabled) {
    Vibration.vibrate([0, 80, 40, 120]);
  }

  if (preferences.inAppSoundEnabled) {
    // Placeholder for future push/local notification sound integration.
    console.log(`[Notifications] Sound placeholder for ${alert.instrumentName}`);
  }
}
