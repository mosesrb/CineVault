const mongoose = require('mongoose');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { fetchMetadata } = require('../services/metadataService');

async function run() {
    await mongoose.connect('mongodb://localhost/cinevault_dev', { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("Connected to MongoDB. Starting metadata upgrade...");

    let updated = 0;

    const movies = await Movie.find({});
    for (const m of movies) {
        let needsFetch = !m.backdropUrl || !m.posterUrl || m.backdropUrl.includes('/w500/') || m.images.some(img => img.includes('/w500/'));
        if (needsFetch) {
            console.log(`Fetching metadata for movie: ${m.title} (${m.year})`);
            const meta = await fetchMetadata(m.title, m.year, 'movie');
            if (meta.posterUrl) m.posterUrl = meta.posterUrl;
            if (meta.backdropUrl) m.backdropUrl = meta.backdropUrl;
            if (meta.images && meta.images.length > 0) m.images = meta.images;
            await m.save();
            updated++;
        }
    }

    const shows = await TVShow.find({});
    for (const m of shows) {
        let needsFetch = !m.backdropUrl || !m.posterUrl || m.backdropUrl.includes('/w500/') || m.images.some(img => img.includes('/w500/'));
        if (needsFetch) {
            console.log(`Fetching metadata for tvshow: ${m.title} (${m.year})`);
            const meta = await fetchMetadata(m.title, m.year, 'tvshow');
            if (meta.posterUrl) m.posterUrl = meta.posterUrl;
            if (meta.backdropUrl) m.backdropUrl = meta.backdropUrl;
            if (meta.images && meta.images.length > 0) m.images = meta.images;
            await m.save();
            updated++;
        }
    }

    console.log(`\nUpgrade Complete. Updated ${updated} records with high-definition TMDB URLs.`);
    mongoose.disconnect();
}

run().catch(err => {
    console.error("Error during upgrade:", err);
    mongoose.disconnect();
});
