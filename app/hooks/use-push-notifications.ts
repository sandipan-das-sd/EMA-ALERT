import { useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { requestPushPermissions, configureNotifications } from '../services/push-notification-service';
import { APP_CONFIG } from '@/lib/config';

const API_BASE = APP_CONFIG.apiBase;
const PUSH_TOKEN_ENDPOINT = `${API_BASE.replace(/\/$/, '')}/auth/push-token`;

type NotificationSubscription = { remove: () => void };

async function loadNotifications() {
  return import('expo-notifications');
}

function isExpoGoClient() {
  return Constants.executionEnvironment === 'storeClient';
}

/**
 * Hook to manage push notification setup and token registration
 */
export function usePushNotifications(enabled = true) {
  const notificationListener = useRef<NotificationSubscription | null>(null);
  const responseListener = useRef<NotificationSubscription | null>(null);
  const registeredRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (isExpoGoClient()) {
      console.log('[Push Hook] Expo Go detected. Skipping remote push setup.');
      return;
    }

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
            const response = await fetch(PUSH_TOKEN_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ pushToken: token }),
            });

            if (response.ok) {
              const data = await response.json();
              console.log('[Push Hook] ✓ Token registered:', data.message);
            } else {
              const text = await response.text();
              console.error('[Push Hook] Failed to register token:', response.status, text || 'no response body');
              registeredRef.current = false;
            }
          } catch (err) {
            console.error('[Push Hook] Error registering token:', err);
            registeredRef.current = false;
          }
        }
      } catch (err) {
        console.error('[Push Hook] Setup failed:', err);
      } finally {
        if (!registeredRef.current) {
          // Retry registration periodically to survive transient auth/network races.
          retryTimerRef.current = setTimeout(setupPush, 45_000);
        }
      }
    };

    setupPush();

    loadNotifications()
      .then((Notifications) => {
        // Listen for incoming notifications
        notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
          console.log('[Push Hook] Notification received:', notification.request.content.title);
        });

        // Listen for user interactions with notifications
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
          console.log('[Push Hook] User interacted with notification:', response.notification.request.content.title);
          if (response.notification.request.content.data) {
            console.log('[Push Hook] Notification data:', response.notification.request.content.data);
          }
        });
      })
      .catch((error) => {
        console.warn('[Push Hook] Failed to attach notification listeners:', error);
      });

    // Cleanup
    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [enabled]);
}
