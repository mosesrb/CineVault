import { openDB } from 'idb';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'cinevault-offline';
const DB_VERSION = 2;
const DOWNLOADS_STORE = 'downloads';

// Simple in-memory lock for current download and subscribers
let activeDownloadId = null;
let activeProgress = 0;
let activeTask = null;
// A retired native transfer may still write its file. Allow other items, but
// keep same-ID retry/deletion blocked until its exact-file cleanup settles.
const retiredTasks = new Map();
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

// A persisted record is not a live native operation after a WebView restart.
// Keep its filename for a guarded retry/cleanup; never infer completion from 100%.
const ready = dbPromise.then(async (db) => {
  const all = await db.getAll(DOWNLOADS_STORE);
  for (const record of all) {
    if (record.status === 'pending') {
      await db.put(DOWNLOADS_STORE, { ...record, status: 'interrupted' });
    }
  }
  return db;
});

const isCurrent = task => activeTask === task && !task.cancelled;
const notify = (id, status) => window.dispatchEvent(new CustomEvent('cv_download_change', { detail: { id, status } }));
const ownsPath = record => typeof record.path === 'string' &&
  /^[a-zA-Z0-9-]+$/.test(record.id) && ['movie', 'episode', 'tvshow'].includes(record.type) &&
  record.path.startsWith(`${record.type}_${record.id}_`) &&
  /^(movie|episode|tvshow)_[a-zA-Z0-9-]+_[a-zA-Z0-9-]+\.mp4$/.test(record.path);

async function removeListeners(task) {
  const handles = task.listeners.splice(0);
  await Promise.all(handles.map(async handle => {
    try { await handle.remove(); } catch { /* Already detached; identity still isolates callbacks. */ }
  }));
}

// Compare and mutate in one IndexedDB transaction so an old attempt cannot
// replace/delete a newer same-ID record across awaited native work.
async function mutateRecord(db, id, predicate, replacement) {
  const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
  const record = await tx.store.get(id);
  const matched = predicate(record);
  if (matched) {
    if (replacement) await tx.store.put(replacement);
    else await tx.store.delete(id);
  }
  await tx.done;
  return matched;
}

async function cleanFile(record) {
  if (!record.path) return;
  if (!ownsPath(record)) throw new Error('This download needs manual recovery before retrying.');
  try {
    await Filesystem.deleteFile({ path: record.path, directory: Directory.Data });
  } catch {
    // Distinguish a genuinely absent file from a storage/deletion failure.
    try { await Filesystem.stat({ path: record.path, directory: Directory.Data }); }
    catch (error) {
      if (error?.code === 'OS-PLUG-FILE-0008') return;
    }
    throw new Error('Unable to remove the local download. Please retry.');
  }
}

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
    const db = await ready;
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

  /** Get only committed downloads, never byte-progress guesses. */
  async getAllDownloads() {
    const db = await ready;
    return (await db.getAll(DOWNLOADS_STORE)).filter(record => record.status === 'completed');
  },

  /** One foreground task; cancellation retires identity, not native network I/O. */
  async downloadMedia(mediaId, url, type, metadata, token) {
    if (activeTask) throw new Error('A download is already in progress. Please wait.');
    if (retiredTasks.has(mediaId)) throw new Error('The cancelled transfer is still finishing. Please retry shortly.');
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Offline downloads are supported in the Android app, not this browser.');
    }
    if (!/^[a-zA-Z0-9-]+$/.test(mediaId) || !['movie', 'episode', 'tvshow'].includes(type)) {
      throw new Error('Invalid download item.');
    }
    const task = { kind: 'download', id: mediaId, identity: crypto.randomUUID(), cancelled: false, listeners: [] };
    activeTask = task;
    activeDownloadId = mediaId;
    activeProgress = 0;
    let db, record;
    let nativeStarted = false;
    let completed = false;
    let savedPath = null;
    try {
      db = await ready;
      if (!isCurrent(task)) return null;
      const previous = await db.get(DOWNLOADS_STORE, mediaId);
      if (!isCurrent(task)) return null;
      if (previous?.status === 'completed') throw new Error('This item is already downloaded.');
      if (previous?.path) await cleanFile(previous);
      if (!isCurrent(task)) return null;
      if (!await this.requestPermissions()) throw new Error('Storage permission is required to download media.');
      if (!isCurrent(task)) return null;

      let finalUrl = url.startsWith('/')
        ? `${localStorage.getItem('cv_server_url') || window.location.origin}${url}`
        : url;
      finalUrl = `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}cvtask=${task.identity}`;
      record = {
        id: mediaId, taskId: task.identity, status: 'pending', type, metadata,
        path: `${type}_${mediaId}_${task.identity}.mp4`, progress: 0, timestamp: Date.now(),
      };
      if (!await mutateRecord(db, mediaId, () => isCurrent(task), record)) return null;
      if (!isCurrent(task)) return null;
      notify(mediaId, 'started');
      this._emitProgress(mediaId, 1);

      const handler = progress => {
        if (!isCurrent(task) || progress.url !== finalUrl) return;
        const bytes = Number(progress.bytes), length = Number(progress.contentLength);
        if (!Number.isFinite(bytes) || !Number.isFinite(length) || length <= 0 || bytes < 0) return;
        this._emitProgress(mediaId, Math.max(1, Math.min(99, Math.round(bytes / length * 100))));
      };
      for (const event of ['progress', 'downloadFileProgress']) {
        const handle = await Filesystem.addListener(event, handler);
        task.listeners.push(handle);
        if (!isCurrent(task)) return null;
      }
      nativeStarted = true;
      await Filesystem.downloadFile({
        url: finalUrl, path: record.path, directory: Directory.Data, progress: true,
        headers: token ? { 'x-auth-token': token, Authorization: `Bearer ${token}` } : {},
      });
      if (!isCurrent(task)) return null;
      completed = await mutateRecord(db, mediaId,
        stored => isCurrent(task) && stored?.taskId === task.identity,
        { ...record, status: 'completed', progress: 100 });
      if (!completed || !isCurrent(task)) return null;
      this._emitProgress(mediaId, 100);
      savedPath = record.path;
    } catch {
      if (!task.cancelled) {
        if (record && db) {
          await mutateRecord(db, mediaId, stored => stored?.taskId === task.identity,
            { ...record, status: 'interrupted' });
        }
        throw new Error('Download failed. Please retry when storage and connection are available.');
      }
      return null;
    } finally {
      await removeListeners(task);
      // Filesystem has no abort API: late completion only cleans its unique file.
      if (record && (task.cancelled || (nativeStarted && !completed))) {
        try { await cleanFile(record); } catch { /* Retained interrupted record permits retry. */ }
      }
      if (retiredTasks.get(mediaId) === task) retiredTasks.delete(mediaId);
      if (activeTask === task) {
        activeTask = null;
        activeDownloadId = null;
        activeProgress = 0;
        notify(mediaId, 'finished');
      }
    }
    // A cancel confirmation can arrive while listener removal is awaiting.
    return task.cancelled ? null : savedPath;
  },

  async cancelDownload(mediaId) {
    const task = activeTask;
    if (!task || task.kind !== 'download' || task.id !== mediaId) return;
    task.cancelled = true;
    retiredTasks.set(mediaId, task);
    try {
      const db = await ready;
      const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
      const stored = await tx.store.get(mediaId);
      if (stored?.taskId === task.identity) {
        await tx.store.put({ ...stored, status: 'interrupted' });
      }
      await tx.done;
    } finally {
      await removeListeners(task);
      if (activeTask === task) {
        activeTask = null;
        activeDownloadId = null;
        activeProgress = 0;
        this._emitProgress(mediaId, -1);
        notify(mediaId, 'cancelled');
      }
    }
  },

  async deleteDownload(mediaId) {
    if (activeTask || retiredTasks.has(mediaId)) throw new Error('Wait for the current transfer before deleting.');
    const task = { kind: 'delete', id: mediaId };
    activeTask = task;
    try {
      const db = await ready;
      const record = await db.get(DOWNLOADS_STORE, mediaId);
      if (!record) return;
      await cleanFile(record);
      await mutateRecord(db, mediaId,
        stored => stored?.path === record.path && stored?.taskId === record.taskId, null);
    } finally {
      if (activeTask === task) activeTask = null;
    }
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
