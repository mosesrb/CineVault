/**
 * metadataService.js
 *
 * Pluggable metadata fetcher.
 * - Dynamic TMDB API Key resolution (Database Library config -> Environment variables -> JSON config).
 * - Automatic key sanitization (strips whitespace, quotes, Bearer prefixes).
 * - Dual Authentication Support: TMDB v3 API Keys (32-hex) and TMDB v4 Read Access Tokens (JWT Bearer tokens).
 * - Multi-stage search (Year-constrained primary search + Year-agnostic fallback).
 * - Comprehensive title normalization, prefix handling ("The ", "A "), and transliteration support.
 * - Intelligent scoring with exact title match weighting, proportional year variance, and popularity bonuses.
 * - Without a TMDB API key: returns a skeleton object (title + year only).
 * - With a TMDB API key: full auto-populate.
 */

const https = require('https');
const config = require('config');
const mongoose = require('mongoose');

const TMDB_BASE = 'api.themoviedb.org';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';

/**
 * Sanitizes any raw TMDB key/token string.
 * Strips whitespace, wrapping quotes, and accidental "Bearer " prefixes.
 */
function _sanitizeTmdbKey(key) {
    if (!key || typeof key !== 'string') return '';
    let cleaned = key.trim();
    // Strip wrapping quotes
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
    // Strip leading "Bearer " prefix if user included it
    cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();
    return cleaned;
}

/**
 * Dynamically resolves the active TMDB API key.
 * Priority:
 * 1. Database Library Configuration (`library.tmdbApiKey`)
 * 2. Environment Variable (`TMDB_API_KEY`)
 * 3. Application Config (`config.get('tmdbApiKey')`)
 */
async function getTmdbKey() {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            const { Library } = require('../models/library');
            const lib = await Library.findOne().select('tmdbApiKey').maxTimeMS(2000);
            if (lib && lib.tmdbApiKey && lib.tmdbApiKey.trim()) {
                return _sanitizeTmdbKey(lib.tmdbApiKey);
            }
        }
    } catch (e) {
        // Fall back to env/config
    }

    if (process.env.TMDB_API_KEY && process.env.TMDB_API_KEY.trim()) {
        return _sanitizeTmdbKey(process.env.TMDB_API_KEY);
    }

    try {
        const key = config.get('tmdbApiKey');
        if (key && typeof key === 'string' && key.trim() && key !== 'your_tmdb_api_key_here') {
            return _sanitizeTmdbKey(key);
        }
    } catch (e) {
        // Config key not set
    }

    return '';
}

/**
 * Tests authentication against the TMDB API.
 * Works seamlessly with both v3 API keys and v4 Read Access Tokens.
 */
async function testTmdbApiKey(apiKey) {
    const rawKey = apiKey !== undefined ? apiKey : await getTmdbKey();
    const keyToTest = _sanitizeTmdbKey(rawKey);
    if (!keyToTest) {
        return { success: false, message: 'No TMDB API key provided or configured.' };
    }

    try {
        const res = await _get('/3/authentication', keyToTest);
        if (res && (res.success === true || res.status_code === 1)) {
            return { success: true, message: 'TMDB API key is valid and connected successfully.' };
        } else {
            return { success: false, message: res?.status_message || 'TMDB API authentication failed.' };
        }
    } catch (err) {
        return { success: false, message: err.message || 'Failed to connect to TMDB API.' };
    }
}

/**
 * Main entry point. Returns structured metadata object.
 * Fields that cannot be populated will be empty strings/arrays.
 */
async function fetchMetadata(title, year, type = 'movie') {
    const tmdbKey = await getTmdbKey();
    if (!tmdbKey) {
        return _buildSkeleton(title, year, type);
    }

    try {
        if (type === 'movie') return await _fetchMovieTMDB(title, year, tmdbKey);
        if (type === 'tvshow') return await _fetchShowTMDB(title, year, tmdbKey);
    } catch (err) {
        console.error('[MetadataService] TMDB fetch failed:', err.message);
        return _buildSkeleton(title, year, type);
    }

    return _buildSkeleton(title, year, type);
}

// --- TMDB Movie Fetch ---
async function _fetchMovieTMDB(title, year, tmdbKey) {
    const variants = _getQueryVariants(title);
    const allResults = [];
    const seenIds = new Set();

    // Stage 1: Search with year constraint if provided
    if (year) {
        const searchPromises = variants.map(q => 
            _get(`/3/search/movie?query=${encodeURIComponent(q)}&year=${year}`, tmdbKey)
        );
        const searchResponses = await Promise.all(searchPromises);
        for (const data of searchResponses) {
            if (data && data.results) {
                for (const res of data.results) {
                    if (!seenIds.has(res.id)) {
                        allResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
        }
    }

    // Stage 2: Fallback to year-agnostic search if no results or to gather top candidates
    if (allResults.length === 0) {
        const broadPromises = variants.map(q => 
            _get(`/3/search/movie?query=${encodeURIComponent(q)}`, tmdbKey)
        );
        const broadResponses = await Promise.all(broadPromises);
        for (const data of broadResponses) {
            if (data && data.results) {
                for (const res of data.results) {
                    if (!seenIds.has(res.id)) {
                        allResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
        }
    }

    if (allResults.length === 0) {
        return _buildSkeleton(title, year, 'movie');
    }

    // Calculate scores for all unique results
    const scoredResults = allResults.map(res => {
        const score = _calculateScore(title, year, res);
        return { ...res, _score: score };
    });

    // Sort by score descending
    scoredResults.sort((a, b) => b._score - a._score);

    // Ambiguity / Conflict Detection
    const topScore = scoredResults[0]?._score || 0;
    const secondScore = scoredResults[1]?._score || 0;
    const isLowConfidence = topScore < 100;
    const isAmbiguous = scoredResults.length > 1 && (topScore - secondScore) < 20 && topScore < 160;

    if (isLowConfidence || isAmbiguous) {
        console.log(`    [Conflict] Detected for "${title}". Top Score: ${topScore}, Second: ${secondScore}`);
        const skeleton = _buildSkeleton(title, year, 'movie');
        skeleton.isConflict = true;
        skeleton.conflictOptions = scoredResults.slice(0, 5).map(res => ({
            id: String(res.id),
            title: res.title || res.name,
            year: (res.release_date || res.first_air_date || '').split('-')[0],
            posterUrl: res.poster_path ? `${TMDB_POSTER_BASE}${res.poster_path}` : '',
            description: res.overview || '',
            score: res._score
        }));
        return skeleton;
    }

    const bestMatch = scoredResults[0];
    const detailUrl = `/3/movie/${bestMatch.id}?append_to_response=credits,videos,images,keywords`;
    const detail = await _get(detailUrl, tmdbKey);

    return _mapDetailToMeta(detail, title, year, 'movie');
}

// --- TMDB TV Show Fetch ---
async function _fetchShowTMDB(title, year, tmdbKey) {
    const variants = _getQueryVariants(title);
    const allResults = [];
    const seenIds = new Set();

    // Stage 1: Search with year constraint if provided
    if (year) {
        const searchPromises = variants.map(q => 
            _get(`/3/search/tv?query=${encodeURIComponent(q)}&first_air_date_year=${year}`, tmdbKey)
        );
        const searchResponses = await Promise.all(searchPromises);
        for (const data of searchResponses) {
            if (data && data.results) {
                for (const res of data.results) {
                    if (!seenIds.has(res.id)) {
                        allResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
        }
    }

    // Stage 2: Fallback to year-agnostic search
    if (allResults.length === 0) {
        const broadResponses = await Promise.all(variants.map(q => 
            _get(`/3/search/tv?query=${encodeURIComponent(q)}`, tmdbKey)
        ));
        for (const data of broadResponses) {
            if (data && data.results) {
                for (const res of data.results) {
                    if (!seenIds.has(res.id)) {
                        allResults.push(res);
                        seenIds.add(res.id);
                    }
                }
            }
        }
    }

    if (allResults.length === 0) {
        return _buildSkeleton(title, year, 'tvshow');
    }

    const scoredResults = allResults.map(res => {
        const score = _calculateScore(title, year, { 
            title: res.name || '', 
            original_title: res.original_name || '', 
            release_date: res.first_air_date,
            popularity: res.popularity
        });
        return { ...res, _score: score };
    });
    scoredResults.sort((a, b) => b._score - a._score);

    const topScore = scoredResults[0]?._score || 0;
    const secondScore = scoredResults[1]?._score || 0;
    const isLowConfidence = topScore < 100;
    const isAmbiguous = scoredResults.length > 1 && (topScore - secondScore) < 20 && topScore < 160;

    if (isLowConfidence || isAmbiguous) {
        console.log(`    [Conflict] Detected for TV "${title}". Top Score: ${topScore}, Second: ${secondScore}`);
        const skeleton = _buildSkeleton(title, year, 'tvshow');
        skeleton.isConflict = true;
        skeleton.conflictOptions = scoredResults.slice(0, 5).map(res => ({
            id: String(res.id),
            title: res.name || res.title,
            year: (res.first_air_date || res.release_date || '').split('-')[0],
            posterUrl: res.poster_path ? `${TMDB_POSTER_BASE}${res.poster_path}` : '',
            description: res.overview || '',
            score: res._score
        }));
        return skeleton;
    }

    const bestMatch = scoredResults[0];
    const detailUrl = `/3/tv/${bestMatch.id}?append_to_response=credits,videos,images,keywords`;
    const detail = await _get(detailUrl, tmdbKey);

    return _mapDetailToMeta(detail, title, year, 'tvshow');
}

/**
 * Maps a TMDB detail object to our internal Meta format.
 */
function _mapDetailToMeta(detail, originalTitle, originalYear, type) {
    const facts = {};
    const keywords = (detail.keywords?.keywords || detail.keywords?.results || []).slice(0, 8).map(k => k.name);
    const production_companies = (detail.production_companies || []).map(p => p.name);
    const images = (detail.images?.backdrops || []).slice(0, 10).map(img => `${TMDB_BACKDROP_BASE}${img.file_path}`);

    if (type === 'movie') {
        if (detail.budget) facts.budget = detail.budget;
        if (detail.revenue) facts.revenue = detail.revenue;
        if (detail.status) facts.status = detail.status;
        if (production_companies.length) facts.productionCompanies = production_companies;
        if (keywords.length) facts.keywords = keywords;

        return {
            tmdbId: String(detail.id || ''),
            imdbId: detail.imdb_id || '',
            title: detail.title || originalTitle,
            year: detail.release_date ? parseInt(detail.release_date.split('-')[0], 10) : originalYear,
            description: detail.overview || '',
            tagline: detail.tagline || '',
            rating: detail.vote_average || 0,
            posterUrl: detail.poster_path ? `${TMDB_POSTER_BASE}${detail.poster_path}` : '',
            backdropUrl: detail.backdrop_path ? `${TMDB_BACKDROP_BASE}${detail.backdrop_path}` : '',
            images: images,
            facts: facts,
            trailerUrl: _extractTrailer(detail.videos),
            runtime: detail.runtime || 0,
            genres: detail.genres ? detail.genres.map(g => g.name) : [],
            releaseDate: detail.release_date ? new Date(detail.release_date) : null,
            director: _extractDirector(detail.credits),
            cast: _extractCast(detail.credits),
            metaSource: 'tmdb',
            metaSyncedAt: new Date()
        };
    } else {
        if (detail.status) facts.status = detail.status;
        if (detail.type) facts.type = detail.type;
        if (production_companies.length) facts.productionCompanies = production_companies;
        if (keywords.length) facts.keywords = keywords;

        return {
            tmdbId: String(detail.id || ''),
            title: detail.name || originalTitle,
            year: detail.first_air_date ? parseInt(detail.first_air_date.split('-')[0], 10) : originalYear,
            description: detail.overview || '',
            tagline: detail.tagline || '',
            rating: detail.vote_average || 0,
            posterUrl: detail.poster_path ? `${TMDB_POSTER_BASE}${detail.poster_path}` : '',
            backdropUrl: detail.backdrop_path ? `${TMDB_BACKDROP_BASE}${detail.backdrop_path}` : '',
            images: images,
            facts: facts,
            trailerUrl: _extractTrailer(detail.videos),
            runtime: detail.episode_run_time?.[0] || 0,
            genres: detail.genres ? detail.genres.map(g => g.name) : [],
            status: _mapShowStatus(detail.status),
            network: detail.networks?.[0]?.name || '',
            totalSeasons: detail.number_of_seasons || 0,
            totalEpisodes: detail.number_of_episodes || 0,
            firstAirDate: detail.first_air_date ? new Date(detail.first_air_date) : null,
            lastAirDate: detail.last_air_date ? new Date(detail.last_air_date) : null,
            cast: _extractCast(detail.credits),
            metaSource: 'tmdb',
            metaSyncedAt: new Date()
        };
    }
}

/**
 * Generates search variants to overcome fuzzy/strict TMDB matching.
 */
function _getQueryVariants(title) {
    if (!title) return [];
    const variants = new Set([title]);
    const cleanLower = title.toLowerCase().trim();
    
    // Variant: Add / Strip leading "The "
    if (/^the\s+/i.test(title)) {
        variants.add(title.replace(/^the\s+/i, '').trim());
    } else {
        variants.add(`The ${title}`.trim());
    }

    // Variant: Strip "A " / "An "
    if (/^(a|an)\s+/i.test(title)) {
        variants.add(title.replace(/^(a|an)\s+/i, '').trim());
    }

    // Variant: Strip Roman Numeral " I"
    if (title.endsWith(' I')) variants.add(title.slice(0, -2).trim());
    
    // Variant: "Too" -> "To", "Too" -> "2"
    if (cleanLower.includes(' too')) {
        variants.add(title.replace(/ too/i, ' To'));
        variants.add(title.replace(/ too/i, ' 2'));
    }

    // Variant: " II" -> " 2", " II" -> " Part II"
    if (title.endsWith(' II')) {
        variants.add(title.replace(/ II$/, ' 2'));
        variants.add(title.replace(/ II$/, ' Part II'));
    }

    // Known transliterations & aliases for international films
    const transliterations = {
        'kolskaya sverhglubokaya': 'Superdeep',
        'kolskaya': 'Superdeep',
        'sverhglubokaya': 'Superdeep'
    };
    for (const [key, val] of Object.entries(transliterations)) {
        if (cleanLower.includes(key)) variants.add(val);
    }

    // 1. Gray <-> Grey (US/UK English)
    if (cleanLower.includes('gray')) variants.add(title.replace(/gray/i, 'Grey'));
    if (cleanLower.includes('grey')) variants.add(title.replace(/grey/i, 'Gray'));

    // 2. Tatoo -> Tattoo (Common typo)
    if (cleanLower.includes('tatoo')) variants.add(title.replace(/tatoo/i, 'Tattoo'));

    // 3. Strip trailing noise like "Directors Cut" if present in the variant search
    if (cleanLower.includes('directors cut')) {
        variants.add(title.replace(/directors cut/i, '').trim());
    }

    // 4. Compaction Handling
    const compacts = {
        'madmax': 'Mad Max',
        'spiderman': 'Spider-Man',
        'batman': 'Batman',
        'ironman': 'Iron Man',
        'superman': 'Superman',
        'xmen': 'X-Men',
        'kickass': 'Kick-Ass'
    };
    for (const [key, val] of Object.entries(compacts)) {
        if (cleanLower.includes(key)) variants.add(title.replace(new RegExp(key, 'i'), val));
    }

    // 5. Final Clean pass for all variants
    const finalVariants = Array.from(variants).map(v => _cleanTitle(v));
    return Array.from(new Set(finalVariants)).filter(Boolean);
}

function _cleanTitle(title) {
    if (!title) return '';
    const noise = [
        'extended', 'unrated', 'directors cut', 'remastered', 'criterion',
        '1080p', '720p', '4k', 'uhd', 'bluray', 'brrip', 'bdrip', 'webrip', 'web-dl',
        'x264', 'x265', 'hevc', 'h264', 'h265', 'aac', 'ac3', 'dts', 'collector',
        'ultimate', 'anniversary', 'edition', 'boxset', 'final cut'
    ];
    
    let clean = title.toLowerCase();
    noise.forEach(n => {
        const regex = new RegExp('\\b' + n + '\\b', 'gi');
        clean = clean.replace(regex, '');
    });
    
    return clean.replace(/\s+/g, ' ').trim() || title;
}

function _calculateScore(queryTitle, queryYear, result) {
    let score = 100;
    const q = queryTitle.toLowerCase().trim();
    const r = (result.title || result.name || '').toLowerCase().trim();
    const orig = (result.original_title || result.original_name || '').toLowerCase().trim();
    const resYear = (result.release_date || result.first_air_date) ? parseInt((result.release_date || result.first_air_date).split('-')[0], 10) : 0;

    // 1. Year Scoring
    if (queryYear && resYear) {
        if (queryYear === resYear) {
            score += 60; // Exact match bonus
        } else if (Math.abs(queryYear - resYear) === 1) {
            score += 30; // 1-year variance (common for international/festival releases)
        } else {
            const diff = Math.abs(queryYear - resYear);
            score -= Math.min(diff * 15, 60); // Progressive penalty capped at -60
        }
    }

    // 2. Exact Title Match Bonus
    if (q === r || q === orig) {
        score += 90;
    } else if (q.replace(/^the\s+/i, '') === r.replace(/^the\s+/i, '')) {
        score += 85;
    }

    // 3. Word Matching
    const qWords = q.replace(/[\:\-\!\,\.]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    const rWords = r.replace(/[\:\-\!\,\.]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    
    let matchedWords = 0;
    for (const w of qWords) {
        if (rWords.includes(w)) matchedWords++;
    }
    
    const wordRatio = qWords.length > 0 ? (matchedWords / qWords.length) : 0;
    score += wordRatio * 50;

    // 4. Popularity Bonus
    if (result.popularity && typeof result.popularity === 'number') {
        score += Math.min(Math.log10(result.popularity + 1) * 10, 25);
    }

    return score;
}

// --- Helpers ---
function _buildSkeleton(title, year, type) {
    return {
        tmdbId: '',
        imdbId: '',
        title,
        year,
        description: '',
        tagline: '',
        rating: 0,
        posterUrl: '',
        backdropUrl: '',
        images: [],
        facts: {},
        trailerUrl: '',
        cast: [],
        director: type === 'movie' ? '' : undefined,
        releaseDate: null,
        metaSource: 'none',
        metaSyncedAt: null
    };
}

function _extractTrailer(videos) {
    if (!videos || !videos.results) return '';
    const trailer = videos.results.find(
        v => v.type === 'Trailer' && v.site === 'YouTube'
    );
    return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : '';
}

function _extractDirector(credits) {
    if (!credits || !credits.crew) return '';
    const director = credits.crew.find(c => c.job === 'Director');
    return director ? director.name : '';
}

function _extractCast(credits) {
    if (!credits || !credits.cast) return [];
    return credits.cast.slice(0, 15).map((c, i) => ({
        name: c.name || '',
        character: c.character || '',
        profileUrl: c.profile_path ? `${TMDB_POSTER_BASE}${c.profile_path}` : '',
        order: i
    }));
}

function _mapShowStatus(status) {
    if (!status) return 'unknown';
    const s = status.toLowerCase();
    if (s.includes('return') || s === 'in production') return 'ongoing';
    if (s === 'ended') return 'ended';
    if (s === 'cancelled' || s === 'canceled') return 'cancelled';
    return 'unknown';
}

function _get(urlPath, tmdbKey = '') {
    return new Promise((resolve, reject) => {
        const sanitizedKey = _sanitizeTmdbKey(tmdbKey);
        const isJwt = sanitizedKey.startsWith('ey') || sanitizedKey.length > 40;
        
        const headers = { 
            Accept: 'application/json' 
        };
        
        let pathWithAuth = urlPath;
        if (sanitizedKey) {
            if (isJwt) {
                // TMDB v4 Read Access Token (JWT Bearer Token)
                headers['Authorization'] = `Bearer ${sanitizedKey}`;
            } else {
                // TMDB v3 API Key (32-character hex)
                const separator = urlPath.includes('?') ? '&' : '?';
                pathWithAuth = `${urlPath}${separator}api_key=${encodeURIComponent(sanitizedKey)}`;
            }
        }

        const options = {
            hostname: TMDB_BASE,
            path: pathWithAuth,
            method: 'GET',
            headers
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON from TMDB')); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

/**
 * Search TMDB for a query.
 */
async function searchTMDB(query, type = 'movie') {
    const tmdbKey = await getTmdbKey();
    if (!tmdbKey) return [];
    const url = type === 'movie' ? '/3/search/movie' : '/3/search/tv';
    const data = await _get(`${url}?query=${encodeURIComponent(query)}`, tmdbKey);
    if (!data.results) return [];
    
    return data.results.slice(0, 10).map(res => ({
        id: String(res.id),
        title: res.title || res.name,
        year: (res.release_date || res.first_air_date || '').split('-')[0],
        posterUrl: res.poster_path ? `${TMDB_POSTER_BASE}${res.poster_path}` : '',
        description: res.overview || ''
    }));
}

/**
 * Fetch full details by TMDB ID.
 */
async function fetchMetadataById(tmdbId, type = 'movie') {
    const tmdbKey = await getTmdbKey();
    if (!tmdbKey) return null;
    const url = type === 'movie' ? `/3/movie/${tmdbId}` : `/3/tv/${tmdbId}`;
    const detail = await _get(`${url}?append_to_response=credits,videos,images,keywords`, tmdbKey);
    return _mapDetailToMeta(detail, detail.title || detail.name, null, type);
}

module.exports = {
    fetchMetadata,
    searchTMDB,
    fetchMetadataById,
    getTmdbKey,
    testTmdbApiKey
};
