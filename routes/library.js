const express = require('express');
const router = express.Router();
const path = require('path');

const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { validateLibraryConfig } = require('../models/library');
const { getVaultConfig, setVaultRoot, ingestFile, updateStats } = require('../services/vaultService');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { Episode } = require('../models/episode');
const { Genre } = require('../models/genre');
const { User } = require('../models/user');
const { Session } = require('../models/session');
const { Duplicate } = require('../models/duplicate');
const { scanDirectory, parseFilename, generateSparseHash } = require('../services/scannerService');
const { fetchMetadata } = require('../services/metadataService');

// ─── SCAN STATUS TRACKER ─────────────────────────────────────
let activeScan = {
    isScanning: false,
    total: 0,
    processed: 0,
    currentFile: '',
    report: null
};
// ─── HELPERS ────────────────────────────────────────────────
async function ensureGenres(genreNames) {
    if (!genreNames || !genreNames.length) return [];
    const genreIds = [];
    for (const name of genreNames) {
        let genre = await Genre.findOne({ name: new RegExp(`^${name}$`, 'i') });
        if (!genre) {
            genre = new Genre({ name });
            await genre.save();
        }
        genreIds.push(genre._id);
    }
    return genreIds;
}

// ─── GET /api/library/config ─────────────────────────────────
router.get('/config', [auth, admin], async (req, res) => {
    const config = await getVaultConfig();
    if (!config) return res.status(404).send('Library vault is not configured yet.');
    res.send(config);
});

// ─── PUT /api/library/config ─────────────────────────────────
// Admin: set or update vault root path
router.put('/config', [auth, admin], async (req, res) => {
    const { error } = validateLibraryConfig(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    try {
        const library = await setVaultRoot(req.body.vaultRootPath, req.body.inboxPath || '');
        res.send(library);
    } catch (err) {
        res.status(500).send(`Failed to configure vault: ${err.message}`);
    }
});

// ─── POST /api/library/ingest ─────────────────────────────────
// Admin: ingest a file from an external path into the vault
// Body: { sourcePath: "/path/to/file.mkv" }
router.post('/ingest', [auth, admin], async (req, res) => {
    if (!req.body.sourcePath) return res.status(400).send('sourcePath is required.');

    try {
        const ingestResult = await ingestFile(req.body.sourcePath);
        const parsed = parseFilename(ingestResult.vaultPath || req.body.sourcePath);

        if (!parsed) {
            return res.status(422).send({
                message: 'File ingested but could not parse filename as a known media type.',
                ingestResult
            });
        }

        // Auto-populate record in DB based on parsed type
        const meta = await fetchMetadata(parsed.title, parsed.year, parsed.type);
        const genreIds = await ensureGenres(meta.genres);

        if (parsed.type === 'movie') {
            const existing = await Movie.findOne({ title: parsed.title, year: parsed.year });
            if (existing) {
                if (!existing.vaultPath) {
                    existing.vaultPath = ingestResult.vaultPath;
                    await existing.save();
                }
                return res.send({ message: 'Movie already exists in library.', movie: existing });
            }

            const movie = new Movie({
                title: meta.title || parsed.title,
                year: meta.year || parsed.year,
                vaultPath: ingestResult.vaultPath,
                originalSourcePath: req.body.sourcePath,
                fileSize: 0,
                format: parsed.format,
                resolution: parsed.resolution,
                ...meta,
                genres: genreIds
            });
            await movie.save();
            return res.status(201).send({ message: 'Movie ingested and added to library.', movie });
        }

        if (parsed.type === 'tvshow') {
            let show = await TVShow.findOne({ title: parsed.title });
            if (!show) {
                const meta2 = await fetchMetadata(parsed.title, parsed.year, 'tvshow');
                const genreIds2 = await ensureGenres(meta2.genres);
                show = new TVShow({
                    title: meta2.title || parsed.title,
                    year: meta2.year || parsed.year,
                    ...meta2,
                    genres: genreIds2
                });
                await show.save();
            }

            // Check if episode already exists
            const existingEp = await Episode.findOne({
                showId: show._id,
                season: parsed.season,
                episode: parsed.episode
            });
            if (existingEp) {
                return res.send({ message: 'Episode already exists.', episode: existingEp });
            }

            const ep = new Episode({
                showId: show._id,
                season: parsed.season,
                episode: parsed.episode,
                vaultPath: ingestResult.vaultPath,
                originalSourcePath: req.body.sourcePath,
                format: parsed.format,
                resolution: parsed.resolution
            });
            await ep.save();
            return res.status(201).send({ message: 'Episode ingested and added to library.', show, episode: ep });
        }

        // Unknown type — ingested but not categorized
        res.send({
            message: 'File ingested into vault but could not auto-categorize. Please categorize manually.',
            parsed,
            ingestResult
        });

    } catch (err) {
        res.status(500).send(`Ingest failed: ${err.message}`);
    }
});

// ─── GET /api/library/duplicates ─────────────────────────────
// Admin: find all duplicated entries
router.get('/duplicates', [auth, admin], async (req, res) => {
    try {
        const movieDupes = await Movie.aggregate([
            { $group: { 
                _id: { title: { $toLower: "$title" }, year: "$year" }, 
                count: { $sum: 1 }, 
                docs: { $push: { _id: "$_id", vaultPath: "$vaultPath", tmdbId: "$tmdbId" } } 
            } },
            { $match: { count: { $gt: 1 } } }
        ]);

        const pathDupes = await Movie.aggregate([
            { $group: { 
                _id: "$vaultPath", 
                count: { $sum: 1 }, 
                docs: { $push: { _id: "$_id", title: "$title", year: "$year" } } 
            } },
            { $match: { count: { $gt: 1 }, _id: { $ne: "" } } }
        ]);

        const hashDupes = await Duplicate.find().populate('originalMediaId', 'title year vaultPath');

        res.send({ movieDupes, pathDupes, hashDupes });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ─── POST /api/library/duplicates/cleanup ────────────────────
// Admin: remove duplicates keeping the best metadata match
router.post('/duplicates/cleanup', [auth, admin], async (req, res) => {
    try {
        let removed = 0;
        
        // Use a Set to track IDs to keep across multiple cleanup passes
        const movies = await Movie.find();
        const groupedByPath = {};
        movies.forEach(m => {
            if (!m.vaultPath) return;
            if (!groupedByPath[m.vaultPath]) groupedByPath[m.vaultPath] = [];
            groupedByPath[m.vaultPath].push(m);
        });

        for (const path in groupedByPath) {
            const docs = groupedByPath[path];
            if (docs.length > 1) {
                // Sort by metadata completeness
                docs.sort((a, b) => {
                    const aMeta = (a.tmdbId ? 10 : 0) + (a.genres?.length || 0);
                    const bMeta = (b.tmdbId ? 10 : 0) + (b.genres?.length || 0);
                    return bMeta - aMeta;
                });
                const keeper = docs[0];
                const toDelete = docs.slice(1).map(d => d._id);
                await Movie.deleteMany({ _id: { $in: toDelete } });
                removed += toDelete.length;
            }
        }

        // Second pass: Title/Year duplicates
        const remainingMovies = await Movie.find();
        const groupedByTitleYear = {};
        remainingMovies.forEach(m => {
            const key = `${m.title.toLowerCase()}_${m.year}`;
            if (!groupedByTitleYear[key]) groupedByTitleYear[key] = [];
            groupedByTitleYear[key].push(m);
        });

        for (const key in groupedByTitleYear) {
            const docs = groupedByTitleYear[key];
            if (docs.length > 1) {
                docs.sort((a, b) => {
                    const aMeta = (a.tmdbId ? 10 : 0) + (a.genres?.length || 0);
                    const bMeta = (b.tmdbId ? 10 : 0) + (b.genres?.length || 0);
                    return bMeta - aMeta;
                });
                const toDelete = docs.slice(1).map(d => d._id);
                await Movie.deleteMany({ _id: { $in: toDelete } });
                removed += toDelete.length;
            }
        }

        res.send({ message: 'Cleanup successful', removed });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// ─── GET /api/library/scan-status ─────────────────────────────
router.get('/scan-status', [auth, admin], (req, res) => {
    res.send(activeScan);
});

// ─── POST /api/library/scan ───────────────────────────────────
// Admin: scan the vault directory and auto-import all media files
router.post('/scan', [auth, admin], async (req, res) => {
    const config = await getVaultConfig();
    if (!config) return res.status(400).send('Vault is not configured.');

    if (activeScan.isScanning) return res.status(409).send('A scan is already in progress.');

    const scanPath = req.body.path || config.vaultRootPath;
    const hashMode = req.body.hashMode || 'normal';
    let results = [];
    try {
        results = scanDirectory(scanPath);
    } catch (e) {
        return res.status(500).send('Error scanning directory: ' + e.message);
    }

    // Initialize tracking
    activeScan = {
        isScanning: true,
        total: results.length,
        processed: 0,
        currentFile: '',
        report: null
    };

    // Return immediately
    res.status(202).send({ message: 'Scan started in background.', total: results.length });

    // Run the actual loop in background
    (async () => {
        const report = {
            total: results.length,
            imported: 0,
            skipped: 0,
            errors: []
        };

        for (const [index, item] of results.entries()) {
            activeScan.processed = index + 1;
            activeScan.currentFile = path.basename(item.filePath);
            
            try {
                const relativePath = path.relative(config.vaultRootPath, item.filePath);

                if (item.type === 'movie') {
                    // Populate missing hashes on legacy records
                    const existsByPath = await Movie.findOne({ vaultPath: relativePath });
                    if (existsByPath) { 
                        if (!existsByPath.sparseHash && hashMode === 'sparse') { existsByPath.sparseHash = await generateSparseHash(item.filePath) || ''; await existsByPath.save(); }
                        if (!existsByPath.deepHash && hashMode === 'deep') { existsByPath.deepHash = await require('../services/scannerService').generateDeepHash(item.filePath) || ''; await existsByPath.save(); }
                        report.skipped++; 
                        continue; 
                    }

                    // --- Hash-based Duplicate Detection ---
                    if (hashMode !== 'normal') {
                        const hashFunc = hashMode === 'deep' ? require('../services/scannerService').generateDeepHash : generateSparseHash;
                        const fileHash = await hashFunc(item.filePath) || '';
                        if (fileHash) {
                            const duplicateHash = await Movie.findOne({ $or: [{ sparseHash: fileHash }, { deepHash: fileHash }] });
                            if (duplicateHash) {
                                const newDuplicate = new Duplicate({
                                    originalMediaId: duplicateHash._id,
                                    originalMatchModel: 'Movie',
                                    vaultPath: relativePath,
                                    hash: fileHash,
                                    fileSize: item.fileSize
                                });
                                await newDuplicate.save();
                                report.skipped++;
                                continue;
                            }
                        }
                        item.fileHash = fileHash;
                    }

                    const exists = await Movie.findOne({ title: item.title, year: item.year });
                    if (exists) { report.skipped++; continue; }

                    const meta = await fetchMetadata(item.title, item.year, item.type);
                    const genreIds = await ensureGenres(meta.genres);
                    
                    const movie = new Movie({
                        title: meta.title || item.title,
                        year: meta.year || item.year,
                        vaultPath: relativePath,
                        fileSize: item.fileSize,
                        format: item.format,
                        resolution: item.resolution,
                        sparseHash: (hashMode === 'sparse' || hashMode === 'deep') ? item.fileHash : '',
                        deepHash: hashMode === 'deep' ? item.fileHash : '',
                        ...meta,
                        genres: genreIds
                    });
                    await movie.save();
                    report.imported++;
                }

                if (item.type === 'tvshow') {
                    let show = await TVShow.findOne({ title: item.title });
                    if (!show) {
                        const showMeta = await fetchMetadata(item.title, item.year, 'tvshow');
                        const genreIdsT = await ensureGenres(showMeta.genres);
                        show = new TVShow({
                            title: showMeta.title || item.title,
                            year: showMeta.year || item.year,
                            ...showMeta,
                            genres: genreIdsT
                        });
                        await show.save();
                    }

                    const existsEp = await Episode.findOne({
                        showId: show._id,
                        season: item.season,
                        episode: item.episode
                    });
                    if (existsEp) { 
                        if (!existsEp.sparseHash && hashMode === 'sparse') { existsEp.sparseHash = await generateSparseHash(item.filePath) || ''; await existsEp.save(); }
                        if (!existsEp.deepHash && hashMode === 'deep') { existsEp.deepHash = await require('../services/scannerService').generateDeepHash(item.filePath) || ''; await existsEp.save(); }
                        report.skipped++; 
                        continue; 
                    }

                    // --- Hash-based Duplicate Detection ---
                    if (hashMode !== 'normal') {
                        const hashFunc = hashMode === 'deep' ? require('../services/scannerService').generateDeepHash : generateSparseHash;
                        const fileHash = await hashFunc(item.filePath) || '';
                        if (fileHash) {
                            const duplicateHash = await Episode.findOne({ $or: [{ sparseHash: fileHash }, { deepHash: fileHash }] });
                            if (duplicateHash) {
                                const newDuplicate = new Duplicate({
                                    originalMediaId: duplicateHash._id,
                                    originalMatchModel: 'Episode',
                                    vaultPath: path.relative(config.vaultRootPath, item.filePath),
                                    hash: fileHash,
                                    fileSize: item.fileSize
                                });
                                await newDuplicate.save();
                                report.skipped++;
                                continue;
                            }
                        }
                        item.fileHash = fileHash;
                    }

                    const ep = new Episode({
                        showId: show._id,
                        season: item.season,
                        episode: item.episode,
                        vaultPath: path.relative(config.vaultRootPath, item.filePath),
                        fileSize: item.fileSize,
                        format: item.format,
                        resolution: item.resolution,
                        sparseHash: (hashMode === 'sparse' || hashMode === 'deep') ? item.fileHash : '',
                        deepHash: hashMode === 'deep' ? item.fileHash : ''
                    });
                    await ep.save();
                    report.imported++;
                }
            } catch (err) {
                report.errors.push({ file: item.filePath, error: err.message });
            }
        }
        const totalMovies = await Movie.countDocuments();
        const totalShows = await TVShow.countDocuments();
        const totalEpisodes = await Episode.countDocuments();
        await updateStats({ totalMovies, totalShows, totalEpisodes, lastScannedAt: new Date() });

        activeScan.isScanning = false;
        activeScan.report = report;
    })();
});

// ─── POST /api/library/refresh-metadata ─────────────────────
// Admin: bulk fetch metadata for items that have none
router.post('/refresh-metadata', [auth, admin], async (req, res) => {
    // Target: Items with no metadata, missing genres/runtime, OR missing new rich fields (images/facts)
    const movies = await Movie.find({ 
        $or: [
            { metaSource: 'none' },
            { genres: { $size: 0 } },
            { runtime: 0 },
            { images: { $size: 0 } },
            { facts: { $exists: false } },
            { facts: {} }
        ]
    });
    const shows = await TVShow.find({ 
        $or: [
            { metaSource: 'none' },
            { genres: { $size: 0 } },
            { runtime: 0 },
            { images: { $size: 0 } },
            { facts: { $exists: false } },
            { facts: {} }
        ]
    });

    let updated = 0;
    const errors = [];

    // Process Movies
    for (const movie of movies) {
        try {
            const meta = await fetchMetadata(movie.title, movie.year, 'movie');
            if (meta.metaSource !== 'none') {
                const genreIds = await ensureGenres(meta.genres);
                Object.assign(movie, { ...meta, genres: genreIds });
                await movie.save();
                updated++;
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (err) {
            errors.push({ id: movie._id, title: movie.title, error: err.message });
        }
    }

    // Process TV Shows
    for (const show of shows) {
        try {
            const meta = await fetchMetadata(show.title, show.year, 'tvshow');
            if (meta.metaSource !== 'none') {
                const genreIds = await ensureGenres(meta.genres);
                Object.assign(show, { ...meta, genres: genreIds });
                await show.save();
                updated++;
                await new Promise(r => setTimeout(r, 100));
            }
        } catch (err) {
            errors.push({ id: show._id, title: show.title, error: err.message });
        }
    }

    res.send({
        message: 'Bulk refresh complete.',
        stats: { updated, errors: errors.length },
        errors: errors.slice(0, 10) // return first 10 errors if any
    });
});

// ─── GET /api/library/organize ────────────────────────────────
// Admin: preview the virtual genre-based organization map
router.get('/organize', [auth, admin], async (req, res) => {
    const genres = await Genre.find();
    const map = [];

    for (const genre of genres) {
        const movies = await Movie.find({ genres: genre._id }).select('title year posterUrl');
        const shows = await TVShow.find({ genres: genre._id }).select('title year posterUrl');
        map.push({
            genre: { id: genre._id, name: genre.name, slug: genre.slug },
            movies,
            shows,
            total: movies.length + shows.length
        });
    }

    // Uncategorized
    const allGenreIds = genres.map(g => g._id);
    const uncatMovies = await Movie.find({ genres: { $size: 0 } }).select('title year');
    const uncatShows = await TVShow.find({ genres: { $size: 0 } }).select('title year');
    map.push({
        genre: { id: null, name: 'Uncategorized', slug: 'uncategorized' },
        movies: uncatMovies,
        shows: uncatShows,
        total: uncatMovies.length + uncatShows.length
    });

    res.send(map);
});

// ─── GET /api/library/stats ───────────────────────────────────
router.get('/stats', [auth, admin], async (req, res) => {
    const config = await getVaultConfig();
    const totalMovies = await Movie.countDocuments();
    const totalShows = await TVShow.countDocuments();
    const totalEpisodes = await Episode.countDocuments();
    const totalUsers = await User.countDocuments();
    const activeSessions = await Session.countDocuments();
    res.send({ config, totalMovies, totalShows, totalEpisodes, totalUsers, activeSessions });
});

module.exports = router;
