/**
 * repair_metadata.js
 * 
 * Re-scans movies with 'none' metadata using improved parsing logic.
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

async function repair() {
    try {
        await mongoose.connect('mongodb://localhost/cinevault_dev');
        console.log('--- Metadata Repair Tool ---');

        const skeletons = await Movie.find({ metaSource: 'none' });
        console.log(`Found ${skeletons.length} items to repair.\n`);

        for (const movie of skeletons) {
            console.log(`Processing: "${movie.vaultPath}"`);
            
            // Re-parse with new logic
            const strippedPath = movie.vaultPath.split(/[\\\/]/).pop(); // Use just the filename for better parsing
            const parsed = parseFilename(strippedPath);
            if (!parsed) {
                console.log(`  ! Failed to parse filename even with new logic.`);
                continue;
            }

            console.log(`  → New Interpretation: Title: "${parsed.title}", Year: ${parsed.year}`);

            // Fetch metadata
            const metadata = await fetchMetadata(parsed.title, parsed.year);
            if (metadata.metaSource !== 'none') {
                console.log(`  ✅ Successfully matched: "${metadata.title}" (${metadata.year})`);
                
                // Map genres to IDs
                const genreIds = await getGenreIds(metadata.genres);
                
                // Update movie record
                const { genres, ...metaWithoutGenres } = metadata;
                Object.assign(movie, metaWithoutGenres);
                movie.genres = genreIds;
                
                // Also update the display title if it was messy
                movie.title = metadata.title; 
                movie.year = metadata.year;
                
                await movie.save();
            } else {
                console.log(`  ❌ Still no TMDB match found.`);
            }
        }

        console.log('\nRepair complete.');
        process.exit(0);
    } catch (err) {
        console.error('Repair failed:', err);
        process.exit(1);
    }
}

repair();
