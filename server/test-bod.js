// Test BOD loading for debugging
import { loadInstrumentJsonMaster } from './services/instruments.js';

async function testBOD() {
  console.log('Testing BOD loading...');
  try {
    const master = await loadInstrumentJsonMaster({ exchanges: ['NSE'] });
    console.log(`Loaded ${master.byTradingSymbol.size} symbols`);
    
    // Test a few popular symbols
    const testSymbols = ['RELIANCE', 'TCS', 'INFY', 'ABB'];
    for (const symbol of testSymbols) {
      const hit = master.byTradingSymbol.get(symbol);
      if (hit) {
        console.log(`${symbol}: ${hit.instrument_key} (${hit.name})`);
      } else {
        console.log(`${symbol}: NOT FOUND`);
      }
    }
  } catch (e) {
    console.error('BOD test failed:', e.message);
  }
}

testBOD();