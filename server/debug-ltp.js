// Quick test to check what's happening with LTP
import dotenv from 'dotenv';
import { loadInstrumentJsonMaster } from './src/services/instruments.js';
import fetch from 'node-fetch';

dotenv.config();

async function quickTest() {
  const accessToken = process.env.UPSTOX_ACCESS_TOKEN;
  const apiBase = process.env.UPSTOX_API_BASE || 'https://api.upstox.com/v3';
  
  console.log('🔍 Quick LTP Debug Test');
  console.log('Token present:', !!accessToken);
  console.log('API Base:', apiBase);
  
  if (!accessToken) {
    console.log('❌ No access token found! Set UPSTOX_ACCESS_TOKEN in .env');
    return;
  }
  
  try {
    // 1. Test BOD loading
    console.log('\n📊 Testing BOD loading...');
    const master = await loadInstrumentJsonMaster({ exchanges: ['NSE'] });
    console.log(`✅ BOD loaded: ${master.byTradingSymbol.size} symbols`);
    
    // 2. Test popular symbols
    const testSymbols = ['RELIANCE', 'TCS', 'INFY'];
    const testInstruments = [];
    
    for (const symbol of testSymbols) {
      const hit = master.byTradingSymbol.get(symbol);
      if (hit && hit.segment === 'NSE_EQ') {
        testInstruments.push({
          symbol,
          instrumentKey: hit.instrument_key,
          name: hit.name
        });
        console.log(`✅ Found ${symbol}: ${hit.instrument_key}`);
      } else {
        console.log(`❌ Missing ${symbol} in BOD data`);
      }
    }
    
    // 3. Test LTP API directly
    console.log('\n💰 Testing LTP API...');
    for (const inst of testInstruments) {
      const url = `${apiBase}/market-quote/ltp?instrument_key=${encodeURIComponent(inst.instrumentKey)}`;
      console.log(`Testing: ${inst.symbol} (${inst.instrumentKey})`);
      
      try {
        const response = await fetch(url, {
          headers: { 
            Authorization: `Bearer ${accessToken}`, 
            Accept: 'application/json' 
          }
        });
        
        const data = await response.json();
        console.log(`Status: ${response.status}`);
        console.log(`Data keys: ${Object.keys(data?.data || {})}`);
        
        if (data?.data) {
          const firstKey = Object.keys(data.data)[0];
          const firstValue = data.data[firstKey];
          if (firstValue?.last_price) {
            console.log(`✅ LTP: ₹${firstValue.last_price}`);
          } else {
            console.log(`❌ No LTP in response:`, JSON.stringify(firstValue, null, 2));
          }
        } else {
          console.log(`❌ No data in response:`, JSON.stringify(data, null, 2));
        }
      } catch (e) {
        console.log(`❌ API Error: ${e.message}`);
      }
      console.log('---');
    }
    
  } catch (e) {
    console.error('❌ Test failed:', e.message);
  }
}

quickTest();