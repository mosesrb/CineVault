/**
 * hlsManagerService.js
 * 
 * Manages active HLS transcoding sessions and their segment files.
 */

const path = require('path');
const fs = require('fs');
const { createHlsStream } = require('./transcoderService');

const CACHE_DIR = path.join(process.cwd(), 'hls-cache');
const sessions = new Map(); // mediaId -> { process, lastAccessed, outputDir, manifestPath }

/**
 * Ensures a fresh HLS session is running for the given media.
 */
async function getOrCreateSession(mediaId, filePath) {
    if (sessions.has(mediaId)) {
        const session = sessions.get(mediaId);
        session.lastAccessed = Date.now();
        return session;
    }

    const outputDir = path.join(CACHE_DIR, mediaId);

    // Always attempt to wipe and recreate the folder to ensure no stale segments or 400MB legacy files exist.
    // We use a try-catch because on Windows, another process (like the previous FFmpeg) might still have a lock.
    try {
        if (fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn(`⚠️ HLS Clean Warning for ${mediaId}: ${e.message}`);
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const manifestPath = path.join(outputDir, 'master.m3u8');

    console.log(`🚀 Starting HLS Session for ${mediaId}`);
    const ffmpegCommand = createHlsStream(filePath, outputDir);

    const session = {
        ffmpegCommand,
        lastAccessed: Date.now(),
        outputDir,
        manifestPath
    };

    sessions.set(mediaId, session);

    // Initial segment wait logic can be added here if needed, 
    // but the route will handle 404 retries or polling.

    return session;
}

/**
 * Kills a specific session.
 */
function stopSession(mediaId) {
    if (sessions.has(mediaId)) {
        const session = sessions.get(mediaId);
        try {
            session.ffmpegCommand.kill('SIGKILL');
        } catch (e) { }

        // Optional: delete files immediately
        // deleteFolderRecursive(session.outputDir);

        sessions.delete(mediaId);
    }
}

let cleanupStarted = false;

/**
 * Periodically cleans up sessions that haven't been accessed for a while.
 */
function startInactivityCleanup(intervalMs = 60000, maxIdleMs = 600000) {
    if (cleanupStarted) return;
    cleanupStarted = true;
    setInterval(() => {
        const now = Date.now();
        for (const [mediaId, session] of sessions.entries()) {
            if (now - session.lastAccessed > maxIdleMs) {
                console.log(`🧹 Cleaning up inactive HLS session: ${mediaId}`);
                stopSession(mediaId);
            }
        }
    }, intervalMs);
}

module.exports = {
    getOrCreateSession,
    stopSession,
    startInactivityCleanup
};
