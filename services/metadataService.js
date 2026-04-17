/**
 * metadataService.js
 *
 * Pluggable metadata fetcher.
 * - Without a TMDB API key: returns a skeleton object (title + year only).
 * - With a TMDB API key (set via TMDB_API_KEY env var): full auto-populate.
 *
 * Usage:
 *   const meta = await fetchMetadata('Inception', 2010, 'movie');
 *   const meta = await fetchMetadata('Breaking Bad', 2008, 'tvshow');
 */

const https = require('https');
const config = require('config');

const TMDB_BASE = 'api.themoviedb.org';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/original';

let TMDB_KEY = '';
try {
    TMDB_KEY = config.get('tmdbApiKey');
} catch (e) {
    // TMDB API Key is optional
}

/**
 * Main entry point. Returns structured metadata object.
 * Fields that cannot be populated will be empty strings/arrays.
 */
async function fetchMetadata(title, year, type = 'movie') {
    if (!TMDB_KEY) {
        return _buildSkeleton(title, year, type);
    }

    try {
        if (type === 'movie') return await _fetchMovieTMDB(title, year);
        if (type === 'tvshow') return await _fetchShowTMDB(title, year);
    } catch (err) {
        console.error('[MetadataService] TMDB fetch failed:', err.message);
        return _buildSkeleton(title, year, type);
    }

    return _buildSkeleton(title, year, type);
}

// --- TMDB Movie Fetch ---
async function _fetchMovieTMDB(title, year) {
    const variants = _getQueryVariants(title);
    const allResults = [];
    const seenIds = new Set();

    // 1. Fetch results for all variants in parallel
    const searchPromises = variants.map(q => 
        _get(`/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}${year ? '&year=' + year : ''}`)
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

    // Calculate scores for all unique results
    const scoredResults = allResults.filter((res, index, self) => 
        index === self.findIndex((t) => t.id === res.id)
    ).map(res => {
        const score = _calculateScore(title, year, res);
        return { ...res, _score: score };
    });

    // Sort by score
    scoredResults.sort((a, b) => b._score - a._score);

    // --- Ambiguity Detection ---
    const topScore = scoredResults[0]?._score || 0;
    const secondScore = scoredResults[1]?._score || 0;
    const isLowConfidence = topScore < 150;
    const isAmbiguous = scoredResults.length > 1 && (topScore - secondScore) < 30;

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

    if (scoredResults.length > 0) {
        console.log(`    DEBUG: Best match for "${title}": "${scoredResults[0].title}" (Score: ${scoredResults[0]._score})`);
    }

    const bestMatch = scoredResults[0];

    const detailUrl = `/3/movie/${bestMatch.id}?api_key=${TMDB_KEY}&append_to_response=credits,videos,images,keywords`;
    const detail = await _get(detailUrl);

    return _mapDetailToMeta(detail, title, year, 'movie');
}

/**
 * Maps a TMDB detail object to our internal Meta format.
 */
function _mapDetailToMeta(detail, originalTitle, originalYear, type) {
    const facts = {};
    const keywords = (detail.keywords?.keywords || detail.keywords?.results || []).slice(0, 8).map(k => k.name);
    const production_companies = (detail.production_companies || []).map(p => p.name);
    // Safely extract up to 10 backdrops/stills (filter out main backdrop if present)
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
    const variants = new Set([title]);
    const cleanLower = title.toLowerCase();
    
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

    // --- Hardened Typo Heuristics ---

    // 1. Gray <-> Grey (US/UK English)
    if (cleanLower.includes('gray')) variants.add(title.replace(/gray/i, 'Grey'));
    if (cleanLower.includes('grey')) variants.add(title.replace(/grey/i, 'Gray'));

    // 2. Tatoo -> Tattoo (Common typo)
    if (cleanLower.includes('tatoo')) variants.add(title.replace(/tatoo/i, 'Tattoo'));

    // 3. Strip trailing noise like "Directors Cut" if present in the variant search
    if (cleanLower.includes('directors cut')) {
        variants.add(title.replace(/directors cut/i, '').trim());
    }

    // 4. Compaction Handling: Madmax -> Mad Max, Spiderman -> Spider Man
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

    // 5. Vowel Fuzzy Match (Desolotion -> Desolation)
    // If a word is very long and likely misspelled
    const words = title.split(' ');
    for (const word of words) {
        if (word.length > 8) {
            // Replace 'o' with 'a' or 'i' in common suffix positions
            if (word.toLowerCase().endsWith('otion')) {
                variants.add(title.replace(word, word.replace(/otion/i, 'ation')));
            }
        }
    }

    // 6. Final Clean pass for all variants
    const finalVariants = Array.from(variants).map(v => _cleanTitle(v));

    return Array.from(new Set(finalVariants));
}

/**
 * Strips technical noise and versioning info from a title.
 */
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

/**
 * Score a TMDB result against our query.
 */
function _calculateScore(queryTitle, queryYear, result) {
    let score = 100;
    const q = queryTitle.toLowerCase();
    const r = result.title.toLowerCase();
    const resYear = result.release_date ? parseInt(result.release_date.split('-')[0], 10) : 0;

    // 1. Year Bonus/Penalty
    if (queryYear) {
        if (queryYear === resYear) score += 50;
        else score -= 100; // Hard penalty for year mismatch
    }

    // 2. Sequel Indicator Guard (I, II, III, To, Too)
    const indicators = [' i', ' ii', ' iii', ' iv', ' v', ' to', ' too', ' 2', ' 3', ' part 2', ' part 3'];
    for (const ind of indicators) {
        const inQuery = q.includes(ind);
        const inResult = r.includes(ind);
        
        // Mismatch handling
        if (inQuery && !inResult) {
            // "Part II" in result matches "II" in query
            if (ind === ' ii' && (r.includes('part ii') || r.includes(' 2'))) {}
            else if (ind === ' iii' && (r.includes('part iii') || r.includes(' 3'))) {}
            else if (ind === ' too' && r.includes(' to')) {}
            else if (ind === ' i') {
                 // "I" in query usually matches original title (no suffix)
            }
            else score -= 30;
        }

        if (!inQuery && inResult) {
            // If query is "Back to the Future I", don't match "Part II"
            if (q.endsWith(' i') && (r.includes('ii') || r.includes('2'))) score -= 80;
            else if (q === r.replace(ind, '').trim()) {
                // Query is "Dumb and Dumber", result is "Dumb and Dumber To"
                // This is a common mismatch for the first movie
                score -= 50;
            }
            else score -= 20;
        }
    }

    // Word match ratio (strict)
    const qWords = q.replace(/[\:\-\!]/g, '').split(' ').filter(w => w.length > 1);
    const rWords = r.replace(/[\:\-\!]/g, '').split(' ').filter(w => w.length > 1);
    let matchedWords = 0;
    for (const w of qWords) if (rWords.includes(w)) matchedWords++;
    
    score += (matchedWords / qWords.length) * 60;
    
    // Length Penalty (prevents matching long documentary titles over short movie titles)
    // If Result Title is much longer than Query Title, penalize
    if (r.length > q.length + 10) score -= 30;

    // Exact Title Match Bonus
    if (q === r) score += 80;
    
    // Base title match (query without "I" matches Result)
    if (q.endsWith(' i') && q.slice(0, -2).trim() === r) score += 70;

    // Distance match for "Too" -> "To"
    if (q.replace('too', 'to') === r) score += 60;

    return score;
}

// --- TMDB TV Show Fetch ---
async function _fetchShowTMDB(title, year) {
    const variants = _getQueryVariants(title);
    const allResults = [];
    const seenIds = new Set();

    const searchResponses = await Promise.all(variants.map(q => 
        _get(`/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(q)}${year ? '&first_air_date_year=' + year : ''}`)
    ));

    for (const data of searchResponses) {
        if (data.results) {
            for (const res of data.results) {
                if (!seenIds.has(res.id)) {
                    allResults.push(res);
                    seenIds.add(res.id);
                }
            }
        }
    }

    if (allResults.length === 0) {
        return _buildSkeleton(title, year, 'tvshow');
    }

    // Sort scored results
    const scoredResults = allResults.map(res => {
        const score = _calculateScore(title, year, { title: res.name || '', release_date: res.first_air_date });
        return { ...res, _score: score };
    });
    scoredResults.sort((a, b) => b._score - a._score);

    // --- Ambiguity Detection ---
    const topScore = scoredResults[0]?._score || 0;
    const secondScore = scoredResults[1]?._score || 0;
    const isLowConfidence = topScore < 150;
    const isAmbiguous = scoredResults.length > 1 && (topScore - secondScore) < 30;

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

    const detailUrl = `/3/tv/${bestMatch.id}?api_key=${TMDB_KEY}&append_to_response=credits,videos,images,keywords`;
    const detail = await _get(detailUrl);

    return _mapDetailToMeta(detail, title, year, 'tvshow');
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

function _get(urlPath) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: TMDB_BASE,
            path: urlPath,
            method: 'GET',
            headers: { Accept: 'application/json' }
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
    if (!TMDB_KEY) return [];
    const url = type === 'movie' ? '/3/search/movie' : '/3/search/tv';
    const data = await _get(`${url}?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}`);
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
    if (!TMDB_KEY) return null;
    const url = type === 'movie' ? `/3/movie/${tmdbId}` : `/3/tv/${tmdbId}`;
    const detail = await _get(`${url}?api_key=${TMDB_KEY}&append_to_response=credits,videos,images,keywords`);
    return _mapDetailToMeta(detail, detail.title || detail.name, null, type);
}

module.exports = { fetchMetadata, searchTMDB, fetchMetadataById };
