import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { requestPushPermissions, configureNotifications } from '../services/push-notification-service';
import { useAlertContext } from '@/contexts/alert-context';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';

/**
 * Hook to manage push notification setup and token registration
 */
export function usePushNotifications() {
  const { state } = useAlertContext();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const registeredRef = useRef(false);

  useEffect(() => {
    // Configure notification handler
    configureNotifications();

    // Register for push notifications
    const setupPush = async () => {
      try {
        const token = await requestPushPermissions();
        
        if (token && !registeredRef.current) {
          registeredRef.current = true;
          console.log('[Push Hook] Registering token with backend...');
          
          try {
            const response = await fetch(`${API_BASE}/auth/push-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ pushToken: token }),
            });

            if (response.ok) {
              const data = await response.json();
              console.log('[Push Hook] ✓ Token registered:', data.message);
            } else {
              console.error('[Push Hook] Failed to register token:', response.status);
            }
          } catch (err) {
            console.error('[Push Hook] Error registering token:', err);
          }
        }
      } catch (err) {
        console.error('[Push Hook] Setup failed:', err);
      }
    };

    setupPush();

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Push Hook] Notification received:', notification.request.content.title);
    });

    // Listen for user interactions with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('[Push Hook] User interacted with notification:', response.notification.request.content.title);
      // You can navigate or dispatch actions here based on notification data
      if (response.notification.request.content.data) {
        console.log('[Push Hook] Notification data:', response.notification.request.content.data);
      }
    });

    // Cleanup
    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, []);
}
