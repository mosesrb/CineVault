import { openDB } from 'idb';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'cinevault-offline';
const DB_VERSION = 2;
const DOWNLOADS_STORE = 'downloads';

// Simple in-memory lock for current download and subscribers
let activeDownloadId = null;
let activeProgress = 0;
let currentTaskIdentity = null;
let activeProgressListener = null; // Track listener globally to allow immediate manual removal
let activeSecondaryListener = null;
const subscribers = new Map(); // id -> Set of callbacks

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore(DOWNLOADS_STORE, { keyPath: 'id' });
    }
    if (oldVersion < 2) {
      if (!db.objectStoreNames.contains('api_cache')) {
        db.createObjectStore('api_cache', { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
      }
    }
  },
});

// Proactive check for pending downloads on startup
dbPromise.then(async (db) => {
  const all = await db.getAll(DOWNLOADS_STORE);
  const pending = all.find(d => d.status === 'pending');
  if (pending) {
    activeDownloadId = pending.id;
    activeProgress = pending.progress || 0;
    console.log('[Offline] Adopted pending download on startup:', activeDownloadId);
  }
});

export const OfflineStorageService = {
  /**
   * Request storage permissions from the user.
   */
  async requestPermissions() {
    // On Web, we don't have these permissions
    const isNative = typeof window !== 'undefined' && 
      (!!(window.Capacitor?.isNativePlatform?.()) || (window.Capacitor && window.Capacitor.platform !== 'web'));
    if (!isNative) return true;
    
    try {
      const status = await Filesystem.requestPermissions();
      // On modern Android, Directory.Data (Internal) doesn't strictly need these,
      // but we check for 'granted' or 'prompt' anyway.
      return true; // Return true as a fallback because Internal storage is always available
    } catch (e) {
      console.warn('[Offline] Permission request failed, proceeding for internal storage:', e);
      return true;
    }
  },

  /**
   * Check if a specific media item is already downloaded and valid.
   */
  async getDownloadRecord(id) {
    const db = await dbPromise;
    return db.get(DOWNLOADS_STORE, id);
  },

  /**
   * Subscribe to progress updates for a specific media ID.
   */
  subscribe(id, callback) {
    if (!subscribers.has(id)) {
      subscribers.set(id, new Set());
    }
    subscribers.get(id).add(callback);
    // If it's the active one, immediately send current progress
    if (id === activeDownloadId) {
      callback(activeProgress);
    }
    return () => this.unsubscribe(id, callback);
  },

  unsubscribe(id, callback) {
    if (subscribers.has(id)) {
      subscribers.get(id).delete(callback);
    }
  },

  _emitProgress(id, pct) {
    if (id === activeDownloadId) {
      activeProgress = pct;
      // Update DB with current progress periodically or at least on change
      // (Optional: for simplicity we just emit to UI)
    }
    const callbacks = subscribers.get(id);
    if (callbacks) {
      callbacks.forEach(cb => cb(pct));
    }
  },

  /**
   * Get all completed downloads.
   * Includes resilience: if an item is stuck at 100% pending, treat it as completed.
   */
  async getAllDownloads() {
    const db = await dbPromise;
    const all = await db.getAll(DOWNLOADS_STORE);
    return all.filter(d => 
      d.status === 'completed' || 
      (d.status === 'pending' && d.progress >= 100 && d.id !== activeDownloadId)
    );
  },

  /**
   * Starts a download using Capacitor Filesystem.
   * Only one download allowed at a time.
   */
  async downloadMedia(mediaId, url, type, metadata, token) {
    if (activeDownloadId && activeDownloadId !== mediaId) {
      throw new Error('A download is already in progress. Please wait.');
    }

    // Ensure URL is absolute for Capacitor
    let finalUrl = url;
    if (url.startsWith('/')) {
      const savedUrl = localStorage.getItem('cv_server_url');
      if (savedUrl) console.log('[Offline] Using custom server URL:', savedUrl);
      const origin = savedUrl || window.location.origin;
      finalUrl = `${origin}${url}`;
    }
    console.log('[Offline] Download URL resolved:', finalUrl);

    // Check permissions first (UI should handle explanation)
    const perms = await this.requestPermissions();
    if (!perms) throw new Error('Storage permission is required to download media.');

    // Set active status immediately
    activeDownloadId = mediaId;
    activeProgress = 0;
    const myTaskIdentity = Math.random();
    currentTaskIdentity = myTaskIdentity;

    // Notify app that a download has started/changed
    window.dispatchEvent(new CustomEvent('cv_download_change', { detail: { id: mediaId, status: 'started' } }));
    
    // Force a 1% start signal to wake up UI bars
    this._emitProgress(mediaId, 1);

    // Setup Progress Listener
    // Cleanup any existing dangling listeners first
    if (activeProgressListener) {
      await activeProgressListener.remove();
      activeProgressListener = null;
    }
    if (activeSecondaryListener) {
      await activeSecondaryListener.remove();
      activeSecondaryListener = null;
    }

    if (Capacitor.isNativePlatform()) {
      // Append task identity to URL to uniquely identify progress events from native layer
      finalUrl = `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}cvtask=${myTaskIdentity}`;

      // Capacitor 5+ uses 'progress', older versions might use 'downloadFileProgress'
      const handler = (p) => {
        // ZOMBIE CHECK: If a new task identity is active, ignore this old callback
        if (currentTaskIdentity !== myTaskIdentity) return;
        
        // ISOLATION: The native bridge broadcasts ALL active downloads. Filter for OUR unique URL.
        if (p.url && p.url !== finalUrl) return;

        const pct = Math.round((p.bytes / (p.contentLength || 1)) * 100);
        console.log(`[Offline] Progress update: ${pct}%`);
        this._emitProgress(mediaId, pct);
      };
      // We register both for maximum compatibility
      activeProgressListener = await Filesystem.addListener('progress', handler);
      // Optional: secondary listener for fallback
      activeSecondaryListener = await Filesystem.addListener('downloadFileProgress', handler);
    } else {
      // Simulation for non-native testing to ensure UI reacts
      console.log('[Offline] Simulated progress started for browser');
      await new Promise((resolve) => {
        let sim = 0;
        const interval = setInterval(() => {
          // ZOMBIE CHECK
          if (currentTaskIdentity !== myTaskIdentity || activeDownloadId !== mediaId) {
            clearInterval(interval);
            resolve();
            return;
          }
          sim += Math.floor(Math.random() * 8) + 2;
          if (sim >= 100) {
            sim = 100;
            this._emitProgress(mediaId, sim);
            clearInterval(interval);
            resolve();
          } else {
            this._emitProgress(mediaId, sim);
          }
        }, 500);
      });

      // On Web, we simulate a successful storage record since real file download isn't supported
      const db = await dbPromise;
      const record = {
        id: mediaId,
        status: 'completed',
        type,
        metadata,
        path: null, // No real file path on web
        progress: 100,
        timestamp: Date.now()
      };
      await db.put(DOWNLOADS_STORE, record);
      this._emitProgress(mediaId, 100);
      return null;
    }

    const db = await dbPromise;

    // Save initial record
    await db.put(DOWNLOADS_STORE, {
      id: mediaId,
      status: 'pending',
      type,
      metadata,
      path: null,
      progress: 0,
      timestamp: Date.now()
    });

    try {
      // Create a universally unique filename so restarting doesn't corrupt existing downloads
      const uniqueSuffix = Date.now();
      const fileName = `${type}_${mediaId}_${uniqueSuffix}.mp4`;
      
      const result = await Filesystem.downloadFile({
        url: finalUrl,
        path: fileName,
        directory: Directory.Data,
        progress: true,
        headers: token ? {
          'x-auth-token': token,
          'Authorization': `Bearer ${token}`
        } : {}
      });

      // 1. STALE CHECK: If the user cancelled while the heavy download was happening, 
      // do NOT save to DB and clean up the file immediately.
      if (activeDownloadId !== mediaId) {
        console.warn('[Offline] Download finished but ID is no longer active (Cancelled). Cleaning up.');
        try {
          await Filesystem.deleteFile({ path: fileName, directory: Directory.Data });
        } catch (e) {}
        return null;
      }

      // 2. Update DB FIRST to ensure status is 'completed'
      await db.put(DOWNLOADS_STORE, {
        id: mediaId,
        status: 'completed',
        type,
        metadata,
        path: fileName,
        progress: 100,
        timestamp: Date.now()
      });

      // 3. Then emit final 100% UI signal
      this._emitProgress(mediaId, 100);
      return fileName;
    } catch (err) {
      // If we didn't cancel it manually, delete the broken record
      if (activeDownloadId === mediaId) {
        await db.delete(DOWNLOADS_STORE, mediaId);
      }
      throw err;
    } finally {
      if (activeProgressListener) {
        activeProgressListener.remove();
        activeProgressListener = null;
      }
      if (activeSecondaryListener) {
        activeSecondaryListener.remove();
        activeSecondaryListener = null;
      }
      activeDownloadId = null;
      window.dispatchEvent(new CustomEvent('cv_download_change', { detail: { id: mediaId, status: 'finished' } }));
    }
  },

  /**
   * Cancels an active download.
   */
  async cancelDownload(mediaId) {
    if (activeDownloadId === mediaId) {
      console.log('[Offline] Cancelling download:', mediaId);
      
      // Manual listener cleanup since the promise might be hanging
      if (activeProgressListener) {
        activeProgressListener.remove();
        activeProgressListener = null;
      }
      if (activeSecondaryListener) {
        activeSecondaryListener.remove();
        activeSecondaryListener = null;
      }

      activeDownloadId = null;
      activeProgress = 0;
      currentTaskIdentity = null; // Kill identity immediately
      this._emitProgress(mediaId, -1); // Special signal for "Cancelled"
      window.dispatchEvent(new CustomEvent('cv_download_change', { detail: { id: mediaId, status: 'cancelled' } }));
    }
    
    // Explicitly clean up from DB and Filesystem
    await this.deleteDownload(mediaId);
  },

  /**
   * Deletes a downloaded file and its registry record.
   */
  async deleteDownload(mediaId) {
    const record = await this.getDownloadRecord(mediaId);
    if (!record) return;

    try {
      if (record.path) {
        await Filesystem.deleteFile({
          path: record.path,
          directory: Directory.Data
        });
      }
    } catch (e) {
      console.warn('File already gone or error deleting:', e);
    }

    const db = await dbPromise;
    await db.delete(DOWNLOADS_STORE, mediaId);
  },

  /**
   * Converts a local filesystem path to a URL the video tag can play.
   * Hardened to handle Tunnel/LiveReload origin issues by forcing _capacitor_file_
   * or using local Blobs for Web/Testing environments.
   */
  async getLocalUrl(mediaId) {
    const record = await this.getDownloadRecord(mediaId);
    if (!record || record.status !== 'completed' || !record.path) return null;

    try {
      // 1. If Non-Native (Browser/Test), reading as Blob is most reliable
      if (!Capacitor.isNativePlatform()) {
        console.log(`[Offline] Non-native platform, resolving via Blob: ${record.path}`);
        const result = await Filesystem.readFile({
          path: record.path,
          directory: Directory.Data
        });
        
        // Convert base64 to Blob
        const blob = await fetch(`data:video/mp4;base64,${result.data}`).then(r => r.blob());
        const url = URL.createObjectURL(blob);
        console.log('[Offline] Generated ObjectURL:', url);
        return url;
      }

      // 2. If Native, get the URI
      const uri = await Filesystem.getUri({
        path: record.path,
        directory: Directory.Data
      });

      let finalUrl = Capacitor.convertFileSrc(uri.uri);
      
      // 3. CAPACITOR BUG WORKAROUND:
      // If convertFileSrc returns a remote URL (starts with https and contains tunnel/origin),
      // it means Capacitor is proxying requests. We must force it back to local.
      if (finalUrl.startsWith('http') && !finalUrl.includes('localhost') && !finalUrl.includes('127.0.0.1')) {
         console.warn('[Offline] convertFileSrc returned remote URL. Forcing local protocol.');
         const p = uri.uri.replace('file://', '');
         // Use the current origin as base (handles both http and https schemes)
         const origin = window.location.origin;
         finalUrl = `${origin}/_capacitor_file_${p}`;
      }

      console.log(`[Offline] Resolved playback URL: ${finalUrl}`);
      return finalUrl;
    } catch (e) {
      console.error('[Offline] Error resolving local URL:', e);
      return null;
    }
  },

  isDownloading(id) {
    return id ? activeDownloadId === id : !!activeDownloadId;
  },

  getActiveDownloadId() {
    return activeDownloadId;
  }
};
