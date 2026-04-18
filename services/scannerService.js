/**
 * scannerService.js
 *
 * Parses media filenames and extracts structured metadata.
 * Supports:
 *   - Movies:  "The.Dark.Knight.2008.1080p.BluRay.mkv"
 *   - TV:      "Breaking.Bad.S02E03.720p.mp4"
 *              "Game.of.Thrones.2x03.hdtv.mkv"
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { audit } = require('./auditorService');

/**
 * Generate a fast hash of the first 50MB of the file.
 */
function generateSparseHash(filePath) {
    return new Promise((resolve) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath, { start: 0, end: 50 * 1024 * 1024 });
        
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', () => resolve(null)); // Safely return null on read error
    });
}

/**
 * Generate a deep hash of the entire file.
 */
function generateDeepHash(filePath) {
    return new Promise((resolve) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', () => resolve(null));
    });
}

const VIDEO_EXTENSIONS = new Set([
    'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'm2ts'
]);

const QUALITY_TAGS = ['2160p', '4k', '1080p', '720p', '480p', '360p', 'uhd', 'hd', 'sd'];

const JUNK_TAGS = [
    'bluray', 'bdrip', 'brrip', 'webrip', 'web-dl', 'webdl', 'hdtv', 'dvdrip',
    'dvd', 'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'divx',
    'aac', 'ac3', 'dts', 'mp3', 'yify', 'yts', 'rarbg', 'ettv', 'extended',
    'remastered', 'theatrical', 'proper', 'repack', 'multi', 'dubbed', 'subbed'
];

/**
 * Parse a media filename and return structured metadata.
 * Returns null if the file is not a recognized video format.
 */
function parseFilename(filePath) {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).replace('.', '').toLowerCase();

    if (!VIDEO_EXTENSIONS.has(ext)) return null;

    const nameWithoutExt = path.basename(fileName, path.extname(fileName));

    // --- Try TV Episode patterns first ---
    // Pattern 1: S01E02 or S01E02E03
    const tvMatch1 = nameWithoutExt.match(
        /^(.+?)[\s._-]+[Ss](\d{1,2})[Ee](\d{1,2})/
    );
    // Pattern 2: 1x02 style
    const tvMatch2 = nameWithoutExt.match(
        /^(.+?)[\s._-]+(\d{1,2})x(\d{2})/i
    );

    if (tvMatch1 || tvMatch2) {
        const match = tvMatch1 || tvMatch2;
        const rawTitle = match[1];
        const season = parseInt(match[2], 10);
        const episode = parseInt(match[3], 10);

        return {
            type: 'tvshow',
            title: _cleanTitle(rawTitle),
            season,
            episode,
            resolution: _extractResolution(nameWithoutExt),
            format: ext,
            rawName: nameWithoutExt
        };
    }

    // --- Movie pattern: Title.Year.quality.mkv ---
    const movieMatch = nameWithoutExt.match(
        /^(.+?)[\s._\-(\[:]+((?:19|20)\d{2})[\s._\-)\[\]]*/
    );

    if (movieMatch) {
        return {
            type: 'movie',
            title: _cleanTitle(movieMatch[1]),
            year: parseInt(movieMatch[2], 10),
            resolution: _extractResolution(nameWithoutExt),
            format: ext,
            rawName: nameWithoutExt
        };
    }

    // --- Fallback: Use Intelligent Auditor heuristics ---
    const audited = audit(fileName);
    
    return {
        type: audited.type,
        title: audited.title,
        year: audited.year,
        season: audited.season,
        episode: audited.episode,
        resolution: _extractResolution(nameWithoutExt),
        format: ext,
        rawName: nameWithoutExt,
        confidence: audited.confidence
    };
}

/**
 * Recursively scan a directory and return all parsed media files.
 */
function scanDirectory(dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) return results;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...scanDirectory(fullPath));
        } else if (entry.isFile()) {
            const parsed = parseFilename(fullPath);
            if (parsed) {
                const stat = fs.statSync(fullPath);
                results.push({
                    ...parsed,
                    filePath: fullPath,
                    fileSize: stat.size
                });
            }
        }
    }
    return results;
}

// --- Helpers ---

function _cleanTitle(raw) {
    const ROMAN_REGEX = /^(?:X|IX|IV|V?I{0,3})$/i;
    
    return raw
        .replace(/[\._\-]/g, ' ')          // dots/underscores/dashes → spaces
        .replace(/\s+/g, ' ')             // collapse multiple spaces
        .trim()
        .split(' ')
        .map(w => {
            // Keep Roman Numerals uppercase
            if (ROMAN_REGEX.test(w)) return w.toUpperCase();
            
            // Handle "To" vs "Too" vs "Two" (sequel indicators)
            const low = w.toLowerCase();
            if (low === 'too' || low === 'two') return 'To'; // Normalize to most likely TMDB spelling for sequels
            
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(' ');
}

function _extractResolution(name) {
    const lower = name.toLowerCase();
    for (const tag of QUALITY_TAGS) {
        if (lower.includes(tag)) return tag;
    }
    return '';
}

module.exports = { parseFilename, scanDirectory, generateSparseHash, generateDeepHash };
