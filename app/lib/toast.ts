import { Alert, Platform, ToastAndroid } from "react-native";

export function showToast(message: string) {
  const text = String(message || "").trim();
  if (!text) return;

  if (Platform.OS === "android") {
    ToastAndroid.show(text, ToastAndroid.SHORT);
    return;
  }

  Alert.alert("Info", text);
}
