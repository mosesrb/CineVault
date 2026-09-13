/**
 * genreGuard middleware
 *
 * Attaches the user's genre restriction list to req.genreFilter.
 * If the user has no genre restrictions (allowedGenres is empty),
 * req.genreFilter will be null — meaning no content filter is applied.
 *
 * Routes that need genre-aware filtering should include this middleware
 * AFTER auth, and check req.genreFilter when building DB queries.
 */

module.exports = async function (req, res, next) {
    // auth middleware has already loaded the authoritative current user.
    req.genreFilter = req.user.allowedGenres && req.user.allowedGenres.length > 0
        ? req.user.allowedGenres
        : null;
    next();
};
