import express from "express";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { marketState } from "../services/marketState.js";
import { dynamicSubscriptionManager } from "../services/dynamicSubscription.js";
import { instrumentsSearchService } from "../services/instrumentsSearch.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// Load universe for validation
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let universe = [];
try {
  const raw = fs.readFileSync(
    path.join(__dirname, "..", "data", "universe.json"),
    "utf-8"
  );
  universe = JSON.parse(raw);
} catch {}
const allowedSet = new Set(universe.map((u) => `${u.segment}|${u.symbol}`));

router.use(protect);

function buildKeyVariants(key, instrument) {
  const variants = new Set([key]);
  if (key.includes('|')) variants.add(key.replace('|', ':'));
  if (key.includes(':')) variants.add(key.replace(':', '|'));

  const segment = instrument?.segment || key.split(/[|:]/)[0];
  const tradingSymbol = instrument?.tradingSymbol;
  if (segment && tradingSymbol) {
    variants.add(`${segment}|${tradingSymbol}`);
    variants.add(`${segment}:${tradingSymbol}`);
  }

  return Array.from(variants);
}

function findQuoteByVariants(variants = []) {
  for (const k of variants) {
    const quote = marketState.latestQuotes[k] || marketState.lastTicks[k];
    if (quote) return { key: k, quote };
  }
  return null;
}

// GET watchlist (with latest prices)
router.get("/", async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const items = user.watchlist || [];

    console.log("[Watchlist] Processing items:", items);
    console.log(
      "[Watchlist] Available market quotes keys:",
      Object.keys(marketState.latestQuotes).slice(0, 5)
    );
    console.log(
      "[Watchlist] Available market ticks keys:",
      Object.keys(marketState.lastTicks).slice(0, 5)
    );

    const snapshot = items.map((key) => {
      // Get instrument details from search service
      const instrument = instrumentsSearchService.getInstrument(key);
      const variants = buildKeyVariants(key, instrument);
      const found = findQuoteByVariants(variants);
      const matchedQuote = found?.quote || null;

      const price = typeof matchedQuote?.ltp === 'number' ? matchedQuote.ltp : null;
      const changePct = typeof matchedQuote?.changePct === 'number' ? matchedQuote.changePct : null;
      const change = typeof matchedQuote?.change === 'number' ? matchedQuote.change : null;
      const ts = matchedQuote?.ts || null;

      console.log(`[Watchlist] ${key}: price=${price}, changePct=${changePct}, matchedKey=${found?.key || 'none'}`);

      const lots = user.watchlistLots?.get(key) ?? 1;
      const lotSize = instrument?.lotSize ?? 1;
      const product = user.watchlistProduct?.get(key) ?? 'I';
      const direction = user.watchlistDirection?.get(key) ?? 'BUY';
      const targetPoints = user.watchlistTargetPoints?.get(key) ?? 0;

      return {
        key,
        name: instrument?.name || key.split("|")[1] || key,
        tradingSymbol: instrument?.tradingSymbol || key.split("|")[1] || key,
        segment: instrument?.segment || key.split("|")[0] || "Unknown",
        expiry: instrument?.expiry || null,
        price,
        changePct,
        change,
        ts,
        lots,
        lotSize,
        product,
        direction,
        targetPoints,
      };
    });

    console.log(
      "[Watchlist] Returning snapshot with prices:",
      snapshot.map((s) => `${s.key}: ${s.price}`)
    );
    res.json({ watchlist: snapshot });
  } catch (e) {
    console.error("Watchlist fetch error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// POST add instrument
router.post("/", async (req, res) => {
  try {
    const { instrumentKey, lots, product, direction } = req.body;
    if (!instrumentKey)
      return res.status(400).json({ message: "instrumentKey required" });
    if (allowedSet.size && !allowedSet.has(instrumentKey)) {
      return res.status(400).json({ message: "Instrument not allowed" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      user.watchlist.push(instrumentKey);
    }
    // Store lots preference (default 1)
    const safeLots = Number.isInteger(Number(lots)) && Number(lots) >= 1 ? Math.round(Number(lots)) : 1;
    user.watchlistLots = user.watchlistLots ?? new Map();
    user.watchlistLots.set(instrumentKey, safeLots);
    user.markModified('watchlistLots');
    // Store product preference: 'I' = Intraday, 'D' = Delivery, 'MTF' = Margin Trading
    const safeProduct = ['D', 'MTF'].includes(product) ? product : 'I';
    user.watchlistProduct = user.watchlistProduct ?? new Map();
    user.watchlistProduct.set(instrumentKey, safeProduct);
    user.markModified('watchlistProduct');
    // Store direction: 'BUY' or 'SELL' (SELL only meaningful for Intraday)
    const safeDirection = direction === 'SELL' ? 'SELL' : 'BUY';
    user.watchlistDirection = user.watchlistDirection ?? new Map();
    user.watchlistDirection.set(instrumentKey, safeDirection);
    user.markModified('watchlistDirection');
    // Store fixed target points (0 = use 1:1 R/R default)
    const safeTargetPoints = Number(req.body.targetPoints) > 0 ? Number(req.body.targetPoints) : 0;
    user.watchlistTargetPoints = user.watchlistTargetPoints ?? new Map();
    user.watchlistTargetPoints.set(instrumentKey, safeTargetPoints);
    user.markModified('watchlistTargetPoints');
    await user.save();
    // Trigger dynamic subscription update
    await dynamicSubscriptionManager.updateUserWatchlist(req.user.id);
    res.status(201).json({ watchlist: user.watchlist });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE remove instrument
router.delete("/:instrumentKey", async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.watchlist = user.watchlist.filter((k) => k !== instrumentKey);
    if (user.watchlistLots) {
      user.watchlistLots.delete(instrumentKey);
      user.markModified('watchlistLots');
    }
    if (user.watchlistProduct) {
      user.watchlistProduct.delete(instrumentKey);
      user.markModified('watchlistProduct');
    }
    if (user.watchlistDirection) {
      user.watchlistDirection.delete(instrumentKey);
      user.markModified('watchlistDirection');
    }
    if (user.watchlistTargetPoints) {
      user.watchlistTargetPoints.delete(instrumentKey);
      user.markModified('watchlistTargetPoints');
    }
    await user.save();
    // Trigger dynamic subscription update
    await dynamicSubscriptionManager.updateUserWatchlist(req.user.id);
    res.json({ watchlist: user.watchlist });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH update lots for an existing watchlist item
router.patch("/:instrumentKey/lots", async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const lots = Number(req.body.lots);
    if (!Number.isInteger(lots) || lots < 1) {
      return res.status(400).json({ message: "lots must be a positive integer" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      return res.status(404).json({ message: "Instrument not in watchlist" });
    }
    user.watchlistLots = user.watchlistLots ?? new Map();
    user.watchlistLots.set(instrumentKey, lots);
    user.markModified('watchlistLots');
    await user.save();
    res.json({ instrumentKey, lots });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH update product for an existing watchlist item
router.patch("/:instrumentKey/product", async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const product = ['D', 'MTF'].includes(req.body.product) ? req.body.product : 'I';
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      return res.status(404).json({ message: "Instrument not in watchlist" });
    }
    user.watchlistProduct = user.watchlistProduct ?? new Map();
    user.watchlistProduct.set(instrumentKey, product);
    user.markModified('watchlistProduct');
    await user.save();
    res.json({ instrumentKey, product });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH update direction for an existing watchlist item
router.patch("/:instrumentKey/direction", async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const direction = req.body.direction === 'SELL' ? 'SELL' : 'BUY';
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      return res.status(404).json({ message: "Instrument not in watchlist" });
    }
    user.watchlistDirection = user.watchlistDirection ?? new Map();
    user.watchlistDirection.set(instrumentKey, direction);
    user.markModified('watchlistDirection');
    await user.save();
    res.json({ instrumentKey, direction });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH update target points for an existing watchlist item (0 = 1:1 R/R default)
router.patch("/:instrumentKey/target-points", async (req, res) => {
  try {
    const { instrumentKey } = req.params;
    const targetPoints = Number(req.body.targetPoints);
    if (isNaN(targetPoints) || targetPoints < 0) {
      return res.status(400).json({ message: "targetPoints must be a non-negative number" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      return res.status(404).json({ message: "Instrument not in watchlist" });
    }
    user.watchlistTargetPoints = user.watchlistTargetPoints ?? new Map();
    user.watchlistTargetPoints.set(instrumentKey, targetPoints);
    user.markModified('watchlistTargetPoints');
    await user.save();
    res.json({ instrumentKey, targetPoints });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
