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
      // Get price data
      const price =
        marketState.latestQuotes[key]?.ltp ||
        marketState.lastTicks[key]?.ltp ||
        null;
      const changePct = marketState.latestQuotes[key]?.changePct || null;
      const change = marketState.latestQuotes[key]?.change || null;
      const ts =
        marketState.latestQuotes[key]?.ts ||
        marketState.lastTicks[key]?.ts ||
        null;

      console.log(`[Watchlist] ${key}: price=${price}, changePct=${changePct}`);

      // Get instrument details from search service
      const instrument = instrumentsSearchService.getInstrument(key);

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
    const { instrumentKey } = req.body;
    if (!instrumentKey)
      return res.status(400).json({ message: "instrumentKey required" });
    if (allowedSet.size && !allowedSet.has(instrumentKey)) {
      return res.status(400).json({ message: "Instrument not allowed" });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.watchlist.includes(instrumentKey)) {
      user.watchlist.push(instrumentKey);
      await user.save();
      // Trigger dynamic subscription update
      await dynamicSubscriptionManager.updateUserWatchlist(req.user.id);
    }
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
    await user.save();
    // Trigger dynamic subscription update
    await dynamicSubscriptionManager.updateUserWatchlist(req.user.id);
    res.json({ watchlist: user.watchlist });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
