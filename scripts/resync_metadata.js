/**
 * resync_metadata.js
 * 
 * Re-evaluates ALL movies in the library using improved parsing and matching logic.
 * Forces an update if the new identification (TMDB ID or Year) differs from the current record.
 */

const mongoose = require('mongoose');
const { Movie } = require('../models/movie');
const { Genre } = require('../models/genre');
const { parseFilename } = require('../services/scannerService');
const { fetchMetadata } = require('../services/metadataService');

/**
 * Maps genre names to ObjectIds (finds or creates).
 */
async function getGenreIds(names) {
    if (!names || !Array.isArray(names)) return [];
    const ids = [];
    for (const name of names) {
        let genre = await Genre.findOne({ name: new RegExp('^' + name + '$', 'i') });
        if (!genre) {
            genre = new Genre({ name });
            await genre.save();
        }
        ids.push(genre._id);
    }
    return ids;
}

async function resync() {
    try {
        await mongoose.connect('mongodb://localhost/cinevault_dev');
        console.log('--- Universal Metadata Re-Sync ---');
        console.log('Refreshing all existing records with improved matching rules...\n');

        const movies = await Movie.find({});
        console.log(`Scanning ${movies.length} items...\n`);

        let updatedCount = 0;

        for (const movie of movies) {
            // Re-parse filename
            const filename = movie.vaultPath.split(/[\\\/]/).pop();
            const parsed = parseFilename(filename);
            
            if (!parsed) {
                console.log(`[SKIPPED] "${filename}" - Parsing failed.`);
                continue;
            }

            // Fetch new metadata with improved logic
            const metadata = await fetchMetadata(parsed.title, parsed.year);
            
            if (metadata.metaSource === 'none') {
                console.log(`[NO MATCH] "${filename}" - No TMDB result found.`);
                continue;
            }

            // Check if identification changed
            const idChanged = movie.tmdbId !== metadata.tmdbId;
            const yearChanged = movie.year !== metadata.year;

            if (idChanged || yearChanged) {
                console.log(`[UPDATING] "${filename}"`);
                console.log(`  Current: ${movie.title} (${movie.year}) [ID: ${movie.tmdbId}]`);
                console.log(`  New:     ${metadata.title} (${metadata.year}) [ID: ${metadata.tmdbId}]`);

                // Map genres
                const genreIds = await getGenreIds(metadata.genres);
                
                // Update record
                const { genres, ...metaWithoutGenres } = metadata;
                Object.assign(movie, metaWithoutGenres);
                movie.genres = genreIds;
                movie.title = metadata.title;
                movie.year = metadata.year;
                
                await movie.save();
                updatedCount++;
                console.log('  ✅ Success.\n');
            }
        }

        console.log(`\nRe-sync complete. Updated ${updatedCount} items.`);
        process.exit(0);
    } catch (err) {
        console.error('Re-sync failed:', err);
        process.exit(1);
    }
}

resync();
