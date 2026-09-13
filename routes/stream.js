const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { getVaultConfig } = require('../services/vaultService');
const { createTranscodeStream, createSubtitleStream, getMediaMetadata } = require('../services/transcoderService');
const { Episode } = require('../models/episode');
const { Movie } = require('../models/movie');
const jwt = require('jsonwebtoken');
const config = require('config');
const {
    authorizeVaultPath,
    hashVaultPath,
    ContentAccessError
} = require('../services/contentPolicyService');
const {
    PathSecurityError,
    resolveExistingFileWithinRoot
} = require('../services/pathSecurityService');

async function authorizeRequestPath(req, res) {
    try {
        const resource = await authorizeVaultPath(req.user, req.query.path);
        if (req.auth?.kind === 'stream-ticket' &&
            (String(req.auth.resourceId) !== String(resource.resourceId) ||
             String(req.auth.mediaId) !== String(resource.mediaId))) {
            res.status(403).send('Stream ticket is not valid for this resource.');
            return null;
        }
        return resource;
    } catch (error) {
        if (error instanceof ContentAccessError) {
            res.status(error.status).send(error.status === 403 ? 'Access denied.' : error.message);
            return null;
        }
        throw error;
    }
}

async function resolveAuthorizedFile(library, vaultPath, res) {
    try {
        return await resolveExistingFileWithinRoot(library.vaultRootPath, vaultPath);
    } catch (error) {
        if (error instanceof PathSecurityError) {
            const notFound = error.code === 'PATH_NOT_FOUND' || error.code === 'NOT_A_FILE';
            res.status(notFound ? 404 : 403).send(notFound ? 'File not found.' : 'Access denied.');
            return null;
        }
        throw error;
    }
}

function parseSingleRange(rangeHeader, fileSize) {
    if (!rangeHeader) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match || rangeHeader.includes(',') || fileSize <= 0) return false;

    const [, startText, endText] = match;
    if (!startText && !endText) return false;

    let start;
    let end;
    if (!startText) {
        const suffixLength = Number(endText);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
        start = Math.max(fileSize - suffixLength, 0);
        end = fileSize - 1;
    } else {
        start = Number(startText);
        end = endText ? Number(endText) : fileSize - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
            start < 0 || end < start || start >= fileSize) return false;
        end = Math.min(end, fileSize - 1);
    }
    return { start, end };
}

function pipeFile(res, filePath, options) {
    const stream = fs.createReadStream(filePath, options);
    stream.on('error', error => {
        if (!res.headersSent) res.status(500).send('Media read failed.');
        else res.destroy(error);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}

/**
 * POST /api/v1/stream/ticket
 * Issues a short-lived (2-minute) single-purpose stream ticket for video and subtitle playback.
 */
router.post('/ticket', auth, async (req, res) => {
    try {
        const requestedPath = req.body?.path;
        if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
            return res.status(400).send('A media path is required.');
        }

        const requestedOperation = req.body?.operation || 'stream';
        if (!['stream', 'download'].includes(requestedOperation)) {
            return res.status(400).send('operation must be stream or download.');
        }

        const resource = await authorizeVaultPath(req.user, requestedPath);
        const operations = requestedOperation === 'download'
            ? ['download']
            : ['stream', 'subtitle'];

        const ticket = jwt.sign(
            {
                _id: req.user._id,
                isStreamTicket: true,
                tokenType: 'stream',
                pathDigest: hashVaultPath(resource.vaultPath),
                operations,
                resourceType: resource.resourceType,
                resourceId: resource.resourceId,
                mediaId: resource.mediaId
            },
            config.get('jwtPrivateKey'),
            { expiresIn: '2m', issuer: 'cinevault', audience: 'cinevault-stream' }
        );
        res.json({ ticket });
    } catch (err) {
        if (err instanceof ContentAccessError) {
            return res.status(err.status).send(err.message);
        }
        res.status(500).send('Failed to generate stream ticket.');
    }
});

/**
 * GET /stream/info?path=
 * Returns audio track metadata for a file.
 */
router.get('/info', auth, async (req, res) => {
    if (!req.query.path) return res.status(400).send('path query parameter is required.');
    const resource = await authorizeRequestPath(req, res);
    if (!resource) return;
    const vaultPath = resource.vaultPath;

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const mediaFile = await resolveAuthorizedFile(library, vaultPath, res);
    if (!mediaFile) return;
    const resolvedFile = mediaFile.path;

    try {
        const metadata = await getMediaMetadata(resolvedFile);
        const audioTracks = (metadata.streams || [])
            .filter(s => s.codec_type === 'audio')
            .map((s, idx) => ({
                index: idx,
                language: s.tags?.language || 'unknown',
                title: s.tags?.title || `Track ${idx + 1}`,
                codec: s.codec_name,
                channels: s.channels
            }));
        const subtitleTracks = (metadata.streams || [])
            .filter(s => s.codec_type === 'subtitle')
            .map((s, idx) => ({
                index: idx,
                language: (s.tags?.language || 'unknown').toLowerCase(),
                title: s.tags?.title || `Track ${idx + 1}`,
                codec: s.codec_name
            }))
            .filter(t => {
                const l = t.language;
                return l.includes('eng') || l.includes('hin') || l === 'unknown' || l === 'en' || l === 'hi';
            });
        res.json({ audioTracks, subtitleTracks });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/**
 * GET /api/stream/subtitles/vtt?path=&index=
 * Extracts an internal subtitle stream and converts it to WebVTT on-the-fly.
 */
router.get('/subtitles/vtt', auth, async (req, res) => {
    const { index, seek } = req.query;
    if (!req.query.path || index === undefined) return res.status(400).send('path and index required.');
    const resource = await authorizeRequestPath(req, res);
    if (!resource) return;
    const vaultPath = resource.vaultPath;

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const mediaFile = await resolveAuthorizedFile(library, vaultPath, res);
    if (!mediaFile) return;
    const resolvedFile = mediaFile.path;

    const subIndex = parseInt(index, 10);
    const seekTime = parseFloat(seek) || 0;

    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Ensure CORS is allowed for track tag
    
    // Extract specific subtitle stream and convert to vtt
    console.log(`[SubExtra] Extracting track ${subIndex} from ${vaultPath} at seek=${seekTime}`);
    try {
        const command = await createSubtitleStream(resolvedFile, subIndex, seekTime);
        command.on('error', (err) => {
            if (!res.headersSent) res.status(500).send('Subtitle extraction failed.');
        });
        command.pipe(res, { end: true });

        req.on('close', () => {
            try { command.kill('SIGKILL'); } catch (_) {}
        });
    } catch (err) {
        if (!res.headersSent) res.status(503).send(err.message);
    }
});

/**
 * GET /api/stream/subtitles?path=
 * Serves a sidecar subtitle file if one exists next to the media file.
 */
router.get('/subtitles', auth, async (req, res) => {
    if (!req.query.path) return res.status(400).send('path query parameter is required.');
    const resource = await authorizeRequestPath(req, res);
    if (!resource) return;
    const vaultPath = resource.vaultPath;

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const { findSidecarFile } = require('../services/vaultService');
    const subPath = await findSidecarFile(vaultPath);
    if (!subPath) return res.status(404).send('No sidecar subtitles found.');

    const ext = path.extname(subPath).toLowerCase();
    const mimeMap = { '.srt': 'text/plain', '.vtt': 'text/vtt' };
    res.sendFile(subPath, { headers: { 'Content-Type': mimeMap[ext] || 'text/plain' } });
});

/**
 * GET /stream?path=&transcode=true|false&seek=N&audio=N
 *
 * Two modes:
 *   1. Transcode  — FFmpeg pipes fragmented MP4 directly to the response.
 *                   Used for MKV/AVI/MOV/etc and when ?transcode=true.
 *                   Seeking is done by restarting with ?seek=N.
 *   2. Byte-range — Direct file read with range request support.
 *                   Used for MP4/WebM that browsers can play natively.
 */
router.get('/', auth, async (req, res) => {
    if (!req.query.path) return res.status(400).send('path query parameter is required.');
    const resource = await authorizeRequestPath(req, res);
    if (!resource) return;
    const vaultPath = resource.vaultPath;

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const mediaFile = await resolveAuthorizedFile(library, vaultPath, res);
    if (!mediaFile) return;
    const resolvedFile = mediaFile.path;

    const ext = path.extname(resolvedFile).toLowerCase();
    const forceTranscode = req.query.transcode === 'true';
    const isDownload = req.query.download === 'true';
    const seekTime = parseFloat(req.query.seek) || 0;
    const audioIndex = parseInt(req.query.audio, 10) || 0;
    const TRANSCODE_EXTS = new Set(['.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m2ts']);
    
    // For downloads, we skip transcode to ensure bit-perfect delivery and stable Content-Length
    const isTranscodeRequired = !isDownload && (forceTranscode || TRANSCODE_EXTS.has(ext));

    // ── MODE 1: Transcode → fragmented MP4 pipe ───────────────────────────
    if (isTranscodeRequired) {
        console.log(`[Transcode] ${ext} | seek=${seekTime}s | audio=${audioIndex} | ${vaultPath}`);

        // Probe duration so the player can show a scrubber
        let duration = null;
        try {
            const metadata = await getMediaMetadata(resolvedFile);
            duration = metadata.format?.duration ?? null;

            // ── Self-Healing Logic ───────────────────────────────────────────
            // If the DB says runtime is 0, repair it now so it works for the player next time.
            if (duration && duration > 0) {
                const rounded = Math.round(duration);
                // Try Episode first (more common for zero-duration bugs)
                const ep = await Episode.findOne({ vaultPath });
                if (ep && ep.runtime === 0) {
                    ep.runtime = rounded;
                    await ep.save();
                    console.log(`[Heal] Automatically fixed runtime for episode: ${vaultPath}`);
                } else {
                    // Try Movie
                    const movie = await Movie.findOne({ vaultPath });
                    if (movie && (movie.duration === 0 || movie.runtime === 0)) {
                        movie.duration = rounded;
                        // If runtime (minutes) is also 0, sync it too
                        if (movie.runtime === 0) movie.runtime = Math.round(rounded / 60);
                        await movie.save();
                        console.log(`[Heal] Automatically fixed runtime for movie: ${vaultPath}`);
                    }
                }
            }
        } catch (e) {
            console.warn('[Transcode] Could not probe duration:', e.message);
        }

        const headers = {
            'Content-Type': 'video/mp4',
            'Transfer-Encoding': 'chunked',
            'Accept-Ranges': 'none',
            'Cache-Control': 'no-cache',
        };
        if (duration !== null) {
            headers['X-Content-Duration'] = String(duration);
        }

        res.writeHead(200, headers);

        try {
            const ffmpegCommand = await createTranscodeStream(resolvedFile, seekTime, audioIndex);
            ffmpegCommand.pipe(res, { end: true });

            req.on('close', () => {
                console.log('[Transcode] Client disconnected — killing FFmpeg.');
                try { ffmpegCommand.kill('SIGKILL'); } catch (_) { }
            });
        } catch (err) {
            console.error('[Transcode] Limit reached:', err.message);
            if (!res.headersSent) res.status(503).send(err.message);
        }

        return;
    }

    // ── MODE 2: Native byte-range streaming ───────────────────────────────
    const fileSize = mediaFile.stats.size;
    const range = req.headers.range;
    const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4' };
    const mimeType = mimeMap[ext] || 'video/mp4';

    if (range && !isDownload) {
        const parsedRange = parseSingleRange(range, fileSize);
        if (!parsedRange) {
            res.setHeader('Content-Range', `bytes */${fileSize}`);
            return res.status(416).send('Range Not Satisfiable');
        }
        const { start, end } = parsedRange;

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': mimeType,
        });
        pipeFile(res, resolvedFile, { start, end });
    } else {
        const filename = path.basename(resolvedFile);
        const downloadHeaders = {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        };
        if (isDownload) {
            downloadHeaders['Content-Disposition'] = `attachment; filename="${filename}"`;
        }
        res.writeHead(200, downloadHeaders);
        pipeFile(res, resolvedFile);
    }
});

module.exports = router;
module.exports.parseSingleRange = parseSingleRange;
