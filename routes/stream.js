const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { getVaultConfig } = require('../services/vaultService');
const { createTranscodeStream, getMediaMetadata } = require('../services/transcoderService');
const { Episode } = require('../models/episode');
const { Movie } = require('../models/movie');

/**
 * GET /stream/info?path=
 * Returns audio track metadata for a file.
 */
router.get('/info', auth, async (req, res) => {
    const vaultPath = req.query.path;
    if (!vaultPath) return res.status(400).send('path query parameter is required.');

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const fullPath = path.join(library.vaultRootPath, vaultPath);
    if (!fs.existsSync(fullPath)) return res.status(404).send('File not found.');

    try {
        const metadata = await getMediaMetadata(fullPath);
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
    const { path: vaultPath, index, seek } = req.query;
    if (!vaultPath || index === undefined) return res.status(400).send('path and index required.');

    const library = await getVaultConfig();
    const fullPath = path.join(library.vaultRootPath, vaultPath);
    if (!fs.existsSync(fullPath)) return res.status(404).send('File not found.');

    const subIndex = parseInt(index, 10);
    const seekTime = parseFloat(seek) || 0;
    const ffmpeg = require('fluent-ffmpeg');

    res.setHeader('Content-Type', 'text/vtt');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Ensure CORS is allowed for track tag
    
    // Extract specific subtitle stream and convert to vtt
    console.log(`[SubExtra] Extracting track ${subIndex} from ${vaultPath} at seek=${seekTime}`);
    ffmpeg(fullPath)
        .inputOptions(seekTime > 0 ? [`-ss ${seekTime}`] : []) // Fastest seek for subtitles
        .outputOptions([
            '-vn', '-an', // Skip video/audio for much faster subtitle extraction
            `-map 0:s:${subIndex}`,
            '-f webvtt'
        ])
        .on('start', cmd => console.log('[SubExtra] cmd:', cmd))
        .on('error', (err) => {
            console.error('[SubtitleExtraction] FFmpeg error:', err.message);
            if (!res.headersSent) res.status(500).send('Subtitle extraction failed.');
        })
        .pipe(res, { end: true });
});

/**
 * GET /api/stream/subtitles?path=
 * Serves a sidecar subtitle file if one exists next to the media file.
 */
router.get('/subtitles', auth, async (req, res) => {
    const vaultPath = req.query.path;
    if (!vaultPath) return res.status(400).send('path query parameter is required.');

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
    const vaultPath = req.query.path;
    if (!vaultPath) return res.status(400).send('path query parameter is required.');

    const library = await getVaultConfig();
    if (!library) return res.status(503).send('Vault not configured.');

    const fullPath = path.join(library.vaultRootPath, vaultPath);
    const resolvedVault = path.resolve(library.vaultRootPath);
    const resolvedFile = path.resolve(fullPath);

    // Path traversal guard
    if (!resolvedFile.startsWith(resolvedVault)) return res.status(403).send('Access denied.');
    if (!fs.existsSync(resolvedFile)) return res.status(404).send('File not found in vault.');

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
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Allow-Headers': 'Range, Authorization, x-auth-token',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Content-Duration',
        };
        if (duration !== null) {
            headers['X-Content-Duration'] = String(duration);
        }

        res.writeHead(200, headers);

        const ffmpegCommand = createTranscodeStream(resolvedFile, seekTime, audioIndex);
        ffmpegCommand.pipe(res, { end: true });

        req.on('close', () => {
            console.log('[Transcode] Client disconnected — killing FFmpeg.');
            try { ffmpegCommand.kill('SIGKILL'); } catch (_) { }
        });

        return;
    }

    // ── MODE 2: Native byte-range streaming ───────────────────────────────
    const stat = fs.statSync(resolvedFile);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4' };
    const mimeType = mimeMap[ext] || 'video/mp4';

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = Math.min(parts[1] ? parseInt(parts[1], 10) : fileSize - 1, fileSize - 1);

        if (isNaN(start) || isNaN(end) || start > end) {
            return res.status(416).send('Range Not Satisfiable');
        }

        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Allow-Headers': 'Range, Authorization, x-auth-token',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        });
        fs.createReadStream(resolvedFile, { start, end }).pipe(res);
    } else {
        res.writeHead(200, {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Allow-Headers': 'Range, Authorization, x-auth-token',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        });
        fs.createReadStream(resolvedFile).pipe(res);
    }
});

module.exports = router;
