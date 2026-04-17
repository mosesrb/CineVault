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

const { User } = require('../models/user');

module.exports = async function (req, res, next) {
    try {
        const user = await User.findById(req.user._id).select('allowedGenres isBanned banExpiresAt');
        if (!user) return res.status(401).send('User not found.');

        // Enforce runtime ban check (in case ban was applied after login)
        if (user.isBanned) {
            const now = new Date();
            if (!user.banExpiresAt || user.banExpiresAt > now) {
                return res.status(403).send('Your account has been suspended.');
            }
        }

        // Set genre filter — null means unrestricted
        req.genreFilter = user.allowedGenres && user.allowedGenres.length > 0
            ? user.allowedGenres
            : null;

        next();
    } catch (err) {
        next(err);
    }
};
