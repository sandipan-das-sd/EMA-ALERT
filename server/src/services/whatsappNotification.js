import fetch from "node-fetch";

// Track last sent time per instrument to prevent duplicate sends
const lastSentTime = new Map();
const COOLDOWN_MS = 60000; // 1 minute cooldown per instrument

/**
 * Send WhatsApp notification via MSG91 API
 * @param {Object} params - Notification parameters
 * @param {string} params.instrumentName - Full instrument name (e.g., NIFTY13SEP2020CE)
 * @param {number} params.close - Close price
 * @param {number} params.ema - EMA value
 * @param {string[]} params.phoneNumbers - Array of phone numbers to notify
 */
export async function sendWhatsAppAlert({ 
  instrumentName, 
  close, 
  ema, 
  phoneNumbers = [] 
}) {
  // Check cooldown to prevent spam
  const now = Date.now();
  const lastSent = lastSentTime.get(instrumentName);
  if (lastSent && (now - lastSent) < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - (now - lastSent);
    console.log(`[WhatsApp] Cooldown active for ${instrumentName} (${Math.ceil(remainingMs/1000)}s remaining)`);
    return { success: false, message: 'Cooldown active', cooldownRemaining: remainingMs };
  }
  
  // Check if WhatsApp is enabled
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    console.log('[WhatsApp] Notifications disabled');
    return { success: false, message: 'WhatsApp notifications disabled' };
  }

  // Validate required environment variables
  const authKey = process.env.MSG91_AUTH_KEY;
  const integratedNumber = process.env.MSG91_INTEGRATED_NUMBER;
  const templateName = process.env.MSG91_TEMPLATE_NAME;
  const templateNamespace = process.env.MSG91_TEMPLATE_NAMESPACE;

  if (!authKey || !integratedNumber || !templateName || !templateNamespace) {
    console.error('[WhatsApp] Missing MSG91 configuration in .env');
    return { success: false, message: 'Missing MSG91 configuration' };
  }

  // Validate phone numbers
  if (!phoneNumbers || phoneNumbers.length === 0) {
    console.error('[WhatsApp] No phone numbers provided');
    return { success: false, message: 'No phone numbers provided' };
  }

  try {
    const myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");
    myHeaders.append("authkey", authKey);

    // Prepare message with instrument full name
    const message = `EMA Alert: ${instrumentName} - Close: ${close?.toFixed(2)}, EMA: ${ema?.toFixed(2)}`;
    
    // MSG91 template has 15 character limit for body_1 parameter
    const instrumentNameTruncated = instrumentName.substring(0, 15);
    
    const payload = {
      "integrated_number": integratedNumber,
      "content_type": "template",
      "payload": {
        "messaging_product": "whatsapp",
        "type": "template",
        "template": {
          "name": templateName,
          "language": {
            "code": "en",
            "policy": "deterministic"
          },
          "namespace": templateNamespace,
          "to_and_components": [
            {
              "to": phoneNumbers,
              "components": {
                "body_1": {
                  "type": "text",
                  "value": instrumentNameTruncated // Truncated to 15 chars (template limit)
                },
                "button_1": {
                  "subtype": "url",
                  "type": "text",
                  "value": "trade"
                }
              }
            }
          ]
        }
      }
    };

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: JSON.stringify(payload),
      redirect: 'follow'
    };

    console.log(`[WhatsApp] Sending alert for ${instrumentName} to ${phoneNumbers.length} number(s)`);
    
    const response = await fetch(
      "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
      requestOptions
    );

    const result = await response.text();
    
    if (response.ok) {
      console.log(`[WhatsApp] ✓ Message sent successfully:`, result);
      // Update last sent time on success
      lastSentTime.set(instrumentName, now);
      
      // Cleanup old entries (keep only last hour)
      const oneHourAgo = now - 3600000;
      for (const [key, time] of lastSentTime.entries()) {
        if (time < oneHourAgo) {
          lastSentTime.delete(key);
        }
      }
      
      return { 
        success: true, 
        message: 'WhatsApp notification sent',
        response: result 
      };
    } else {
      console.error(`[WhatsApp] ✗ Failed to send message:`, result);
      return { 
        success: false, 
        message: 'Failed to send WhatsApp notification',
        error: result 
      };
    }
  } catch (error) {
    console.error('[WhatsApp] Error sending notification:', error.message);
    return { 
      success: false, 
      message: 'Error sending WhatsApp notification',
      error: error.message 
    };
  }
}

/**
 * Get phone numbers from environment variable
 * @returns {string[]} Array of phone numbers
 */
export function getWhatsAppPhoneNumbers() {
  const phoneNumbers = process.env.WHATSAPP_PHONE_NUMBERS;
  
  if (!phoneNumbers) {
    console.warn('[WhatsApp] No phone numbers configured in WHATSAPP_PHONE_NUMBERS');
    return [];
  }
  
  // Split by comma and trim whitespace
  return phoneNumbers.split(',').map(num => num.trim()).filter(num => num.length > 0);
}
