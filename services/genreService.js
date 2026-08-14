const { Genre } = require('../models/genre');

/**
 * Ensures genres exist in the database and returns an array of their ObjectIds.
 * Performs case-insensitive matching.
 */
async function ensureGenres(genreNames) {
    if (!genreNames || !genreNames.length) return [];
    const genreIds = [];
    for (const name of genreNames) {
        if (!name || typeof name !== 'string') continue;
        const trimmed = name.trim();
        if (!trimmed) continue;

        let genre = await Genre.findOne({ name: new RegExp(`^${trimmed}$`, 'i') });
        if (!genre) {
            genre = new Genre({ name: trimmed });
            await genre.save();
        }
        genreIds.push(genre._id);
    }
    return genreIds;
}

module.exports = {
    ensureGenres
};
