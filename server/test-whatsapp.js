/**
 * Test script for WhatsApp notifications
 * This script sends a test WhatsApp message to verify the integration
 */

import dotenv from 'dotenv';
import { sendWhatsAppAlert, getWhatsAppPhoneNumbers } from './src/services/whatsappNotification.js';

// Load environment variables
dotenv.config();

async function testWhatsAppNotification() {
  console.log('=== WhatsApp Notification Test ===\n');
  
  // Check environment variables
  console.log('Environment Configuration:');
  console.log('- MSG91_AUTH_KEY:', process.env.MSG91_AUTH_KEY ? '✓ Set' : '✗ Missing');
  console.log('- MSG91_INTEGRATED_NUMBER:', process.env.MSG91_INTEGRATED_NUMBER || '✗ Missing');
  console.log('- MSG91_TEMPLATE_NAME:', process.env.MSG91_TEMPLATE_NAME || '✗ Missing');
  console.log('- MSG91_TEMPLATE_NAMESPACE:', process.env.MSG91_TEMPLATE_NAMESPACE || '✗ Missing');
  console.log('- WHATSAPP_ENABLED:', process.env.WHATSAPP_ENABLED || '✗ Missing');
  console.log('- WHATSAPP_PHONE_NUMBERS:', process.env.WHATSAPP_PHONE_NUMBERS || '✗ Missing');
  console.log('');
  
  // Get phone numbers
  const phoneNumbers = getWhatsAppPhoneNumbers();
  console.log(`Phone numbers to notify: ${phoneNumbers.length}`);
  phoneNumbers.forEach((num, idx) => {
    console.log(`  ${idx + 1}. ${num}`);
  });
  console.log('');
  
  if (phoneNumbers.length === 0) {
    console.error('✗ No phone numbers configured. Please set WHATSAPP_PHONE_NUMBERS in .env');
    process.exit(1);
  }
  
  // Test scenarios
  const testCases = [
    {
      name: 'NIFTY Call Option',
      instrumentName: 'NIFTY13SEP2020CE',
      close: 23456.75,
      ema: 23450.20
    },
    {
      name: 'NIFTY Put Option',
      instrumentName: 'NIFTY13SEP2020PE',
      close: 150.50,
      ema: 148.30
    },
    {
      name: 'BANKNIFTY Call Option',
      instrumentName: 'BANKNIFTY20JAN2026CE',
      close: 52345.25,
      ema: 52300.10
    }
  ];
  
  console.log('Starting test notifications...\n');
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`Test ${i + 1}/${testCases.length}: ${testCase.name}`);
    console.log(`  Instrument: ${testCase.instrumentName}`);
    console.log(`  Close: ${testCase.close}`);
    console.log(`  EMA: ${testCase.ema}`);
    
    try {
      const result = await sendWhatsAppAlert({
        instrumentName: testCase.instrumentName,
        close: testCase.close,
        ema: testCase.ema,
        phoneNumbers: phoneNumbers
      });
      
      if (result.success) {
        console.log(`  ✓ Success: ${result.message}`);
        if (result.response) {
          console.log(`  Response: ${result.response}`);
        }
      } else {
        console.log(`  ✗ Failed: ${result.message}`);
        if (result.error) {
          console.log(`  Error: ${result.error}`);
        }
      }
    } catch (error) {
      console.error(`  ✗ Exception: ${error.message}`);
    }
    
    console.log('');
    
    // Wait 2 seconds between messages to avoid rate limiting
    if (i < testCases.length - 1) {
      console.log('Waiting 2 seconds before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log('=== Test Complete ===');
  console.log('\nIf you received WhatsApp messages, the integration is working correctly!');
  console.log('Check your phone at:', phoneNumbers.join(', '));
}

// Run the test
testWhatsAppNotification()
  .then(() => {
    console.log('\n✓ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Test script failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  });
