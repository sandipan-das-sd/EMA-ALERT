import User from "../models/User.js";

class DynamicSubscriptionManager {
  constructor() {
    this.subscribedKeys = new Set();
    this.userWatchlists = new Map(); // userId -> Set of instrument keys
    this.userTimeframes = new Map(); // userId -> Map<instrumentKey, '5m'|'15m'>
    this.subscriptionCallbacks = []; // Functions to call when subscription changes
  }

  // Add callback function that gets called when subscription list changes
  onSubscriptionChange(callback) {
    this.subscriptionCallbacks.push(callback);
  }

  // Get all unique instrument keys that need to be subscribed
  getAllSubscriptionKeys() {
    const allKeys = new Set(this.subscribedKeys);

    // Add all user watchlist items
    for (const watchlist of this.userWatchlists.values()) {
      for (const key of watchlist) {
        allKeys.add(key);
      }
    }

    return Array.from(allKeys);
  }

  // Set base subscription keys (universe + indices)
  setBaseSubscription(keys) {
    this.subscribedKeys = new Set(keys);
    this._notifyChange();
  }

  // Update user's watchlist
  async updateUserWatchlist(userId) {
    try {
      const user = await User.findById(userId);
      if (user) {
        const oldWatchlist = this.userWatchlists.get(userId);
        const newWatchlist = new Set(user.watchlist || []);

        this.userWatchlists.set(userId, newWatchlist);

        // Track per-instrument timeframe
        const tfMap = new Map();
        for (const key of newWatchlist) {
          tfMap.set(key, user.watchlistTimeframe?.get(key) || '15m');
        }
        this.userTimeframes.set(userId, tfMap);

        // Check if subscription needs to change
        const hasNewKeys =
          !oldWatchlist ||
          Array.from(newWatchlist).some((key) => !oldWatchlist.has(key));

        if (hasNewKeys) {
          console.log(
            `[DynamicSub] Updated watchlist for user ${userId}: ${newWatchlist.size} items`
          );
          this._notifyChange();
        }
      }
    } catch (error) {
      console.error(`[DynamicSub] Error updating user watchlist:`, error);
    }
  }

  // Load all user watchlists
  async initializeAllWatchlists() {
    try {
      const users = await User.find({}, { _id: 1, watchlist: 1, watchlistTimeframe: 1 });
      let totalWatchlistItems = 0;

      for (const user of users) {
        if (user.watchlist && user.watchlist.length > 0) {
          const userId = user._id.toString();
          this.userWatchlists.set(userId, new Set(user.watchlist));
          totalWatchlistItems += user.watchlist.length;

          const tfMap = new Map();
          for (const key of user.watchlist) {
            tfMap.set(key, user.watchlistTimeframe?.get(key) || '15m');
          }
          this.userTimeframes.set(userId, tfMap);
        }
      }

      console.log(
        `[DynamicSub] Initialized ${users.length} user watchlists with ${totalWatchlistItems} total items`
      );
      this._notifyChange();
    } catch (error) {
      console.error("[DynamicSub] Error initializing watchlists:", error);
    }
  }

  // Remove user (on logout/cleanup)
  removeUser(userId) {
    if (this.userWatchlists.has(userId)) {
      this.userWatchlists.delete(userId);
      this.userTimeframes.delete(userId);
      this._notifyChange();
    }
  }

  // Get timeframe for a specific user + instrument (default '15m')
  getUserTimeframe(userId, instrumentKey) {
    return this.userTimeframes.get(userId)?.get(instrumentKey) || '15m';
  }

  // Get all unique (instrumentKey, timeframe) pairs across all users
  // Only returns user watchlist instruments — base subscription keys (indices) are excluded
  getAllKeyTimeframePairs() {
    const pairs = new Map(); // "key::tf" -> { key, timeframe }
    for (const [userId, tfMap] of this.userTimeframes) {
      for (const [key, tf] of tfMap) {
        const pairKey = `${key}::${tf}`;
        if (!pairs.has(pairKey)) {
          pairs.set(pairKey, { key, timeframe: tf });
        }
      }
    }
    return Array.from(pairs.values());
  }

  _notifyChange() {
    const allKeys = this.getAllSubscriptionKeys();
    console.log(
      `[DynamicSub] Subscription changed: ${allKeys.length} total keys`
    );

    for (const callback of this.subscriptionCallbacks) {
      try {
        callback(allKeys);
      } catch (error) {
        console.error("[DynamicSub] Error in subscription callback:", error);
      }
    }
  }

  getStats() {
    return {
      baseSubscriptions: this.subscribedKeys.size,
      userWatchlists: this.userWatchlists.size,
      totalUniqueKeys: this.getAllSubscriptionKeys().length,
      users: Array.from(this.userWatchlists.entries()).map(
        ([userId, watchlist]) => ({
          userId,
          itemCount: watchlist.size,
        })
      ),
    };
  }
}

export const dynamicSubscriptionManager = new DynamicSubscriptionManager();
