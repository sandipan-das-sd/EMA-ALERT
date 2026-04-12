// Shared market state to be read by routes and updated by feed/poller
export const marketState = {
  lastTicks: {},      // instrumentKey -> { instrumentKey, ltp, ts }
  latestQuotes: {},   // instrumentKey -> { key, ltp, cp, changePct, ts }
  getSnapshot(keys = []) {
    const res = {};
    keys.forEach((k) => {
      res[k] = this.latestQuotes[k] || this.lastTicks[k] || null;
    });
    return res;
  },
};
