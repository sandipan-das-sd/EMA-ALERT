import fetch from "node-fetch";
import { createGunzip } from "zlib";
import { Readable } from "stream";

class InstrumentsSearchService {
  constructor() {
    this.instruments = new Map(); // key -> instrument data
    this.searchIndex = new Map(); // searchable text -> Set of keys
    this.lastUpdated = null;
    this.isLoading = false;
    this.updatePromise = null;
  }

  async initialize() {
    console.log(
      "[InstrumentsSearch] Initializing instrument search service..."
    );
    await this.updateInstruments();
  }

  async updateInstruments() {
    if (this.isLoading) {
      return this.updatePromise;
    }

    this.isLoading = true;
    this.updatePromise = this._doUpdate();

    try {
      await this.updatePromise;
    } finally {
      this.isLoading = false;
      this.updatePromise = null;
    }
  }

  async _doUpdate() {
    const startTime = Date.now();
    console.log("[InstrumentsSearch] Starting instruments update...");

    try {
      // Download NSE and BSE instruments in parallel
      const [nseData, bseData] = await Promise.all([
        this._downloadAndDecompress(
          "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
        ),
        this._downloadAndDecompress(
          "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz"
        ),
      ]);

      // Clear existing data
      this.instruments.clear();
      this.searchIndex.clear();

      // Process NSE instruments
      const nseInstruments = JSON.parse(nseData);
      console.log(
        `[InstrumentsSearch] Processing ${nseInstruments.length} NSE instruments`
      );
      nseInstruments.forEach((instrument) => this._addInstrument(instrument));

      // Process BSE instruments
      const bseInstruments = JSON.parse(bseData);
      console.log(
        `[InstrumentsSearch] Processing ${bseInstruments.length} BSE instruments`
      );
      bseInstruments.forEach((instrument) => this._addInstrument(instrument));

      this.lastUpdated = new Date();
      const duration = Date.now() - startTime;
      console.log(
        `[InstrumentsSearch] Update completed in ${duration}ms. Total instruments: ${this.instruments.size}`
      );
    } catch (error) {
      console.error("[InstrumentsSearch] Update failed:", error);
      throw error;
    }
  }

  async _downloadAndDecompress(url) {
    console.log(`[InstrumentsSearch] Downloading from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`
      );
    }

    const gunzip = createGunzip();
    const chunks = [];

    return new Promise((resolve, reject) => {
      gunzip.on("data", (chunk) => chunks.push(chunk));
      gunzip.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve(data);
      });
      gunzip.on("error", reject);

      // Convert response.body to Buffer first, then to Node.js stream
      response
        .arrayBuffer()
        .then((arrayBuffer) => {
          const buffer = Buffer.from(arrayBuffer);
          const readable = Readable.from(buffer);
          readable.pipe(gunzip);
        })
        .catch(reject);
    });
  }

  _addInstrument(instrument) {
    // Skip instruments without required fields
    if (
      !instrument.instrument_key ||
      !instrument.trading_symbol ||
      !instrument.name
    ) {
      return;
    }

    // Filter for specific segments we support
    const supportedSegments = [
      "NSE_EQ",
      "NSE_FO",
      "NSE_INDEX",
      "BSE_EQ",
      "BSE_FO",
      "BSE_INDEX",
    ];

    if (!supportedSegments.includes(instrument.segment)) {
      return;
    }

    // Store the instrument
    const instrumentData = {
      key: instrument.instrument_key,
      name: instrument.name,
      tradingSymbol: instrument.trading_symbol,
      shortName: instrument.short_name || instrument.trading_symbol,
      segment: instrument.segment,
      exchange: instrument.exchange,
      instrumentType: instrument.instrument_type,
      isin: instrument.isin,
      lotSize: instrument.lot_size || 1,
      tickSize: instrument.tick_size,
      expiry: instrument.expiry,
      strike: instrument.strike,
      optionType: instrument.option_type,
    };

    this.instruments.set(instrument.instrument_key, instrumentData);

    // Create search index entries (lowercase for case-insensitive search)
    const searchTerms = [
      instrument.trading_symbol?.toLowerCase(),
      instrument.name?.toLowerCase(),
      instrument.short_name?.toLowerCase(),
      instrument.isin?.toLowerCase(),
    ].filter(Boolean);

    // For FO instruments, also index by underlying symbol
    if (instrument.segment === "NSE_FO" || instrument.segment === "BSE_FO") {
      const underlying = instrument.name?.split(" ")[0]?.toLowerCase();
      if (underlying) searchTerms.push(underlying);
    }

    searchTerms.forEach((term) => {
      if (!this.searchIndex.has(term)) {
        this.searchIndex.set(term, new Set());
      }
      this.searchIndex.get(term).add(instrument.instrument_key);

      // Also index partial matches for the trading symbol and name
      for (let i = 1; i <= term.length; i++) {
        const prefix = term.substring(0, i);
        if (!this.searchIndex.has(prefix)) {
          this.searchIndex.set(prefix, new Set());
        }
        this.searchIndex.get(prefix).add(instrument.instrument_key);
      }
    });
  }

  search(query, options = {}) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const {
      segments = [
        "NSE_EQ",
        "NSE_FO",
        "NSE_INDEX",
        "BSE_EQ",
        "BSE_FO",
        "BSE_INDEX",
      ],
      limit = 50,
    } = options;

    const searchQuery = query.toLowerCase().trim();
    const matchingKeys = new Set();

    // Find all instruments that match the search query
    for (const [term, keys] of this.searchIndex) {
      if (term.includes(searchQuery)) {
        keys.forEach((key) => matchingKeys.add(key));
      }
    }

    // Get instrument details and filter by segments
    const results = [];
    for (const key of matchingKeys) {
      const instrument = this.instruments.get(key);
      if (instrument && segments.includes(instrument.segment)) {
        results.push(instrument);
      }

      if (results.length >= limit) {
        break;
      }
    }

    // Sort results by relevance (exact matches first, then partial matches)
    results.sort((a, b) => {
      const aExact =
        a.tradingSymbol.toLowerCase() === searchQuery ||
        a.shortName.toLowerCase() === searchQuery;
      const bExact =
        b.tradingSymbol.toLowerCase() === searchQuery ||
        b.shortName.toLowerCase() === searchQuery;

      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts =
        a.tradingSymbol.toLowerCase().startsWith(searchQuery) ||
        a.name.toLowerCase().startsWith(searchQuery);
      const bStarts =
        b.tradingSymbol.toLowerCase().startsWith(searchQuery) ||
        b.name.toLowerCase().startsWith(searchQuery);

      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return a.tradingSymbol.localeCompare(b.tradingSymbol);
    });

    return results;
  }

  getInstrument(instrumentKey) {
    return this.instruments.get(instrumentKey);
  }

  getStats() {
    const segmentCounts = {};
    for (const instrument of this.instruments.values()) {
      segmentCounts[instrument.segment] =
        (segmentCounts[instrument.segment] || 0) + 1;
    }

    return {
      totalInstruments: this.instruments.size,
      lastUpdated: this.lastUpdated,
      segmentCounts,
      isLoading: this.isLoading,
    };
  }

  // Auto-update instruments daily at 6 AM (as per Upstox documentation)
  startAutoUpdate() {
    const scheduleNext = () => {
      const now = new Date();
      const next6AM = new Date(now);
      next6AM.setHours(6, 0, 0, 0);

      if (next6AM <= now) {
        next6AM.setDate(next6AM.getDate() + 1);
      }

      const timeToNext = next6AM.getTime() - now.getTime();
      console.log(
        `[InstrumentsSearch] Next update scheduled for ${next6AM.toISOString()}`
      );

      setTimeout(() => {
        this.updateInstruments()
          .then(scheduleNext)
          .catch((error) => {
            console.error("[InstrumentsSearch] Auto-update failed:", error);
            // Retry in 1 hour if failed
            setTimeout(scheduleNext, 60 * 60 * 1000);
          });
      }, timeToNext);
    };

    scheduleNext();
  }
}

export const instrumentsSearchService = new InstrumentsSearchService();
