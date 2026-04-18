const mongoose = require('mongoose');
const path = require('path');

// Logic:
// 1. Group by vaultPath. If count > 1, keep the one with most metadata (genres/description).
// 2. Group by (title, year). If count > 1, keep the one with most metadata.

const MovieSchema = new mongoose.Schema({}, { strict: false, collection: 'movies' });
const Movie = mongoose.model('Movie', MovieSchema);

const TVShowSchema = new mongoose.Schema({}, { strict: false, collection: 'tv_shows' });
const TVShow = mongoose.model('TVShow', TVShowSchema);

const EpisodeSchema = new mongoose.Schema({}, { strict: false, collection: 'episodes' });
const Episode = mongoose.model('Episode', EpisodeSchema);

async function cleanup() {
    try {
        await mongoose.connect('mongodb://localhost:27017/cinevault_dev');
        console.log('Connected to MongoDB');

        console.log('--- Cleaning up Movies ---');
        
        // 1. Exact VaultPath Duplicates
        const pathDupes = await Movie.aggregate([
            { $group: { _id: "$vaultPath", count: { $sum: 1 }, ids: { $push: "$_id" } } },
            { $match: { count: { $gt: 1 }, _id: { $ne: "" } } }
        ]);

        console.log(`Found ${pathDupes.length} sets of identical vaultPath duplicates.`);
        for (const set of pathDupes) {
            const docs = await Movie.find({ _id: { $in: set.ids } });
            // Sort by metadata completeness
            docs.sort((a, b) => {
                const aMeta = (a.tmdbId ? 1 : 0) + (a.genres?.length || 0);
                const bMeta = (b.tmdbId ? 1 : 0) + (b.genres?.length || 0);
                return bMeta - aMeta;
            });
            const keeper = docs[0];
            const toDelete = docs.slice(1).map(d => d._id);
            console.log(`Keeping ${keeper.title} (${keeper._id}), deleting ${toDelete.length} duplicates.`);
            await Movie.deleteMany({ _id: { $in: toDelete } });
        }

        // 2. Title/Year Duplicates (Case Insensitive)
        const titleDupes = await Movie.aggregate([
            { $group: { 
                _id: { title: { $toLower: "$title" }, year: "$year" }, 
                count: { $sum: 1 }, 
                ids: { $push: "$_id" } 
            } },
            { $match: { count: { $gt: 1 } } }
        ]);

        console.log(`Found ${titleDupes.length} sets of Title/Year duplicates.`);
        for (const set of titleDupes) {
            const docs = await Movie.find({ _id: { $in: set.ids } });
            docs.sort((a, b) => {
                const aMeta = (a.tmdbId ? 1 : 0) + (a.genres?.length || 0);
                const bMeta = (b.tmdbId ? 1 : 0) + (b.genres?.length || 0);
                return bMeta - aMeta;
            });
            const keeper = docs[0];
            const toDelete = docs.slice(1).map(d => d._id);
            console.log(`Keeping "${keeper.title}" (${keeper.year}) - ID: ${keeper._id}, deleting ${toDelete.length} duplicates.`);
            await Movie.deleteMany({ _id: { $in: toDelete } });
        }

        console.log('\n--- Cleanup Finished ---');
        process.exit(0);
    } catch (err) {
        console.error('Cleanup failed:', err);
        process.exit(1);
    }
}

cleanup();
