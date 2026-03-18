import axios from 'axios';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send push notification via Expo Push Service
 * @param {string} pushToken - Recipient's Expo push token
 * @param {object} message - Message object { title, body, data }
 */
export async function sendExpoPushNotification(pushToken, message) {
  if (!pushToken) {
    return { success: false, skipped: true, reason: 'Missing push token' };
  }

  const payload = {
    to: pushToken,
    sound: 'default',
    title: message.title || 'EMA Alert',
    body: message.body || 'New alert received',
    data: message.data || {},
    badge: 1,
    priority: 'high',
  };

  try {
    const response = await axios.post(EXPO_PUSH_URL, payload, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (response.status === 200) {
      const data = response.data;
      if (data.data && data.data.length > 0) {
        const ticket = data.data[0];
        if (ticket.status === 'ok') {
          return {
            success: true,
            ticket: ticket.id,
            message: `Push sent to ${pushToken.substring(0, 20)}...`,
          };
        } else {
          return {
            success: false,
            error: ticket.message || 'Unknown error',
          };
        }
      }
    }

    return {
      success: false,
      status: response.status,
      error: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Request failed',
    };
  }
}

/**
 * Send push to a user if they have token and preference enabled
 */
export async function sendPushAlertToUser(user, alertData, preferences) {
  if (!user?.pushToken) {
    return { sent: false, reason: 'user_no_token' };
  }

  if (preferences && !preferences.pushNotificationsEnabled) {
    return { sent: false, reason: 'user_disabled_push' };
  }

  const message = {
    title: `${alertData.instrumentName} Alert`,
    body: `EMA Crossover | Close: ${alertData.close?.toFixed(2) || 'NA'}, EMA: ${alertData.ema?.toFixed(2) || 'NA'}`,
    data: {
      instrumentKey: alertData.instrumentKey || '',
      strategy: alertData.strategy || 'ema20_cross_up',
      timestamp: new Date().toISOString(),
    },
  };

  return sendExpoPushNotification(user.pushToken, message);
}
