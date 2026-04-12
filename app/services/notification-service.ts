import * as Haptics from "expo-haptics";
import { Vibration } from "react-native";
import type { AlertPreferences, EmaAlert } from "@/types/alert";
import { sendLocalNotification } from "@/services/push-notification-service";

export async function notifyOnCriticalAlert(alert: EmaAlert, preferences: AlertPreferences) {
  if (preferences.hapticsEnabled) {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  if (preferences.vibrationEnabled) {
    Vibration.vibrate([0, 80, 40, 120]);
  }

  if (preferences.inAppSoundEnabled) {
    const close = Number.isFinite(alert.close) ? alert.close.toFixed(2) : 'NA';
    const ema = Number.isFinite(alert.ema) ? alert.ema.toFixed(2) : 'NA';
    await sendLocalNotification(
      `${alert.instrumentName} Alert`,
      `EMA Crossover | Close: ${close}, EMA: ${ema}`,
      {
        instrumentKey: alert.instrumentKey,
        strategy: alert.strategy,
      }
    );
  }
}
