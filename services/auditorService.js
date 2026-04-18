/**
 * auditorService.js
 * 
 * An intelligent heuristic engine to parse media filenames that fail strict regex matching.
 */

const QUALITY_TAGS = ['2160p', '4k', '1080p', '1080i', '720p', '480p', '360p', 'uhd', 'hd', 'sd', 'vhs', 'bluray', 'bdrip', 'brrip', 'dvdrip', 'webrip', 'web-dl', 'hdtv'];
const CODEC_TAGS = ['x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'divx', 'aac', 'ac3', 'dts', 'mp3'];
const RELEASE_GROUPS = ['yify', 'yts', 'rarbg', 'ettv', 'fgt', 'amiable', 'spark', 'depth', 'trollhd', 'psa', 'joy', 'qxr'];

function audit(fileName) {
    // 1. Remove extension
    let clean = fileName.replace(/\.[^/.]+$/, "");
    
    // 2. Initial cleanup (dots/underscores/dashes/brackets/parens/colons to spaces)
    clean = clean.replace(/[\._\-\(\)\[\]\:]/g, ' ').replace(/\s+/g, ' ').trim();

    const words = clean.split(' ');
    let titleIndex = words.length;
    let year = null;

    // 3. Find years and boundary tags
    let qualityIdx = -1;
    for (let i = 0; i < words.length; i++) {
        const word = words[i].replace(/[^\w]/g, "").toLowerCase();
        
        // Match year (1888-2100)
        if (/^(19|20)\d{2}$/.test(word) && i > 0) {
            year = parseInt(word, 10);
            titleIndex = i;
            // Record year as the primary boundary
        }

        // Potential boundary (Resolution, Codec, etc.)
        if (QUALITY_TAGS.includes(word) || CODEC_TAGS.includes(word) || RELEASE_GROUPS.includes(word)) {
            if (qualityIdx === -1) qualityIdx = i;
        }
    }

    // If we found a year, it's the boundary.
    // If no year, but we found a quality tag, use that.
    if (!year && qualityIdx !== -1) {
        titleIndex = qualityIdx;
    }
    
    // Final title extraction with aggressive noise removal
    let titleWords = words.slice(0, titleIndex);
    const NOISE_WORDS = ['extended', 'unrated', 'directors', 'cut', 'remastered', 'criterion', 'sample', 'trailer', 'extra', 'bonus'];
    
    titleWords = titleWords.filter(w => {
        const cleanW = w.toLowerCase().replace(/[^\w]/g, '');
        return !NOISE_WORDS.includes(cleanW) && 
               !QUALITY_TAGS.includes(cleanW) && 
               !CODEC_TAGS.includes(cleanW);
    });

    const title = _toTitleCase(titleWords.join(' '));
    
    if (titleIndex < words.length && !year) {
        const potentialYear = words[titleIndex];
        if (/^(19|20)\d{2}$/.test(potentialYear)) {
            year = parseInt(potentialYear, 10);
        }
    }

    // 5. Detect Type (if it has SxxExx in the remaining words)
    let type = 'movie';
    let season = null;
    let episode = null;

    const remaining = words.slice(titleIndex).join(' ');
    const tvMatch = remaining.match(/[Ss](\d{1,2})[Ee](\d{1,2})/i);
    if (tvMatch) {
        type = 'tvshow';
        season = parseInt(tvMatch[1], 10);
        episode = parseInt(tvMatch[2], 10);
    }

    return {
        title: _toTitleCase(title || words[0]), // Fallback to first word if title is empty
        year,
        type,
        season,
        episode,
        confidence: titleIndex > 0 ? 'high' : 'low'
    };
}

function _toTitleCase(str) {
    if (!str) return '';
    return str.split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

module.exports = { audit };
