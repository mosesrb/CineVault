/**
 * hlsManagerService.js
 * 
 * Manages active HLS transcoding sessions and their segment files.
 */

const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
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
            await fsPromises.rm(outputDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn(`⚠️ HLS Clean Warning for ${mediaId}: ${e.message}`);
    }

    if (!fs.existsSync(outputDir)) {
        await fsPromises.mkdir(outputDir, { recursive: true });
    }

    const manifestPath = path.join(outputDir, 'master.m3u8');

    console.log(`🚀 Starting HLS Session for ${mediaId}`);
    const ffmpegCommand = await createHlsStream(filePath, outputDir);

    const session = {
        ffmpegCommand,
        lastAccessed: Date.now(),
        outputDir,
        manifestPath
    };

    sessions.set(mediaId, session);

    return session;
}

/**
 * Kills a specific session.
 */
async function stopSession(mediaId) {
    if (sessions.has(mediaId)) {
        const session = sessions.get(mediaId);
        try {
            if (session.ffmpegCommand && typeof session.ffmpegCommand.kill === 'function') {
                session.ffmpegCommand.kill('SIGKILL');
            }
        } catch (e) {
            console.warn(`[HLS] Warning killing FFmpeg process for ${mediaId}:`, e.message);
        }

        try {
            if (session.outputDir && fs.existsSync(session.outputDir)) {
                await fsPromises.rm(session.outputDir, { recursive: true, force: true });
            }
        } catch (e) {
            console.warn(`[HLS] Warning cleaning cache dir for ${mediaId}:`, e.message);
        }

        sessions.delete(mediaId);
    }
}

let cleanupTimer = null;

/**
 * Periodically cleans up sessions that haven't been accessed for a while.
 */
function startInactivityCleanup(intervalMs = 60000, maxIdleMs = 600000) {
    if (cleanupTimer) return cleanupTimer;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [mediaId, session] of sessions.entries()) {
            if (now - session.lastAccessed > maxIdleMs) {
                console.log(`🧹 Cleaning up inactive HLS session: ${mediaId}`);
                stopSession(mediaId);
            }
        }
    }, intervalMs);

    if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
    }
    return cleanupTimer;
}

function stopInactivityCleanup() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

module.exports = {
    getOrCreateSession,
    stopSession,
    startInactivityCleanup,
    stopInactivityCleanup
};
