import { openDB } from 'idb';
import api from '../api';

const DB_NAME = 'cinevault-offline';
const DB_VERSION = 2; // Bumped version for new stores
const CACHE_STORE = 'api_cache';
const SYNC_STORE = 'sync_queue';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('downloads', { keyPath: 'id' });
    }
    if (oldVersion < 2) {
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
      }
    }
  },
});

export const OfflineCacheService = {
  /**
   * Cache an API response
   */
  async setCache(url, data) {
    const db = await dbPromise;
    await db.put(CACHE_STORE, {
      url,
      data,
      timestamp: Date.now()
    });
  },

  /**
   * Retrieve cached data if valid
   */
  async getCache(url) {
    const db = await dbPromise;
    const record = await db.get(CACHE_STORE, url);
    if (!record) return null;

    // Check TTL
    if (Date.now() - record.timestamp > CACHE_TTL) {
      await db.delete(CACHE_STORE, url);
      return null;
    }

    return record.data;
  },

  /**
   * Queue a watch progress sync
   */
  async queueSync(mediaId, type, episodeId, progressSeconds, completed) {
    const db = await dbPromise;
    await db.put(SYNC_STORE, {
      mediaId,
      mediaType: type,
      episodeId,
      progressSeconds,
      completed,
      timestamp: Date.now()
    });
  },

  /**
   * Process all queued sync items
   */
  async processSyncQueue() {
    const db = await dbPromise;
    const queue = await db.getAll(SYNC_STORE);
    if (queue.length === 0) return;

    console.log(`[Sync] Processing queue of ${queue.length} items...`);

    for (const item of queue) {
      try {
        // We use the raw axios instance or the exported api to avoid interceptor recursion if any
        await api.post('/users/me/history', {
          mediaId: item.mediaId,
          mediaType: item.mediaType,
          episodeId: item.episodeId,
          progressSeconds: item.progressSeconds,
          completed: item.completed
        });
        
        // Remove from queue if successful
        await db.delete(SYNC_STORE, item.id);
      } catch (err) {
        console.error('[Sync] Item sync failed, will retry later:', err);
        // Stop processing rest of queue if it's a connection issue
        if (!err.response) break; 
      }
    }
  },

  /**
   * Purge all cached API data
   */
  async clearCache() {
    const db = await dbPromise;
    await db.clear(CACHE_STORE);
  }
};
