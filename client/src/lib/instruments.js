// Scalable instrument universe for client UI (first 10 shown; extend to 200+)
export const INSTRUMENT_UNIVERSE = [
  { underlying: '360 ONE WAM LIMITED', symbol: '360ONE', segment: 'NSE_EQ' },
  { underlying: 'ABB India Limited', symbol: 'ABB', segment: 'NSE_EQ' },
  { underlying: 'APL Apollo Tubes Limited', symbol: 'APLAPOLLO', segment: 'NSE_EQ' },
  { underlying: 'AU Small Finance Bank Limited', symbol: 'AUBANK', segment: 'NSE_EQ' },
  { underlying: 'Adani Energy Solutions Limited', symbol: 'ADANIENSOL', segment: 'NSE_EQ' },
  { underlying: 'Adani Enterprises Limited', symbol: 'ADANIENT', segment: 'NSE_EQ' },
  { underlying: 'Adani Green Energy Limited', symbol: 'ADANIGREEN', segment: 'NSE_EQ' },
  { underlying: 'Adani Ports and Special Economic Zone Limited', symbol: 'ADANIPORTS', segment: 'NSE_EQ' },
  { underlying: 'Aditya Birla Capital Limited', symbol: 'ABCAPITAL', segment: 'NSE_EQ' },
  { underlying: 'Alkem Laboratories Limited', symbol: 'ALKEM', segment: 'NSE_EQ' },
];

export function toInstrumentKey(item) {
  return `${item.segment}|${item.symbol}`;
}
