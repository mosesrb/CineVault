const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const genreGuard = require('../middleware/genreGuard');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { Genre } = require('../models/genre');

/**
 * GET /api/search
 * Query params:
 *   q       - search term (required)
 *   type    - 'movie' | 'tvshow' | 'all' (default: all)
 *   genre   - genre slug filter
 *   year    - year filter
 */
router.get('/', [auth, genreGuard], async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).send('Search query "q" is required.');

    const type = req.query.type || 'all';
    const year = req.query.year ? parseInt(req.query.year, 10) : null;

    let genreId = null;
    if (req.query.genre) {
        const g = await Genre.findOne({ slug: req.query.genre });
        if (g) genreId = g._id;
    }

    const buildFilter = () => {
        const f = { $text: { $search: q } };
        
        // Intersect Global Restriction with Local Genre Filter
        if (req.genreFilter) {
            if (genreId) {
                const isAllowed = req.genreFilter.some(id => id.toString() === genreId.toString());
                f.genres = isAllowed ? genreId : new mongoose.Types.ObjectId(); // force zero results if mismatch
            } else {
                f.genres = { $in: req.genreFilter };
            }
        } else if (genreId) {
            f.genres = genreId;
        }

        if (year) f.year = year;
        return f;
    };

    const results = { movies: [], shows: [] };

    if (type === 'all' || type === 'movie') {
        results.movies = await Movie.find(buildFilter())
            .select('title year posterUrl genres rating resolution')
            .populate('genres', 'name slug')
            .sort({ score: { $meta: 'textScore' } })
            .limit(30);
    }

    if (type === 'all' || type === 'tvshow') {
        results.shows = await TVShow.find(buildFilter())
            .select('title year posterUrl genres rating status')
            .populate('genres', 'name slug')
            .sort({ score: { $meta: 'textScore' } })
            .limit(30);
    }

    results.total = results.movies.length + results.shows.length;
    res.send(results);
});

module.exports = router;
