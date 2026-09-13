const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Movie } = require('../models/movie');
const { TVShow } = require('../models/tvShow');
const { Episode } = require('../models/episode');

class ContentAccessError extends Error {
    constructor(message, status = 403) {
        super(message);
        this.name = 'ContentAccessError';
        this.status = status;
    }
}

function normalizeVaultPath(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        throw new ContentAccessError('A valid media path is required.', 400);
    }
    const normalized = path.posix.normalize(value.trim().replace(/\\/g, '/'));
    if (normalized === '..' || normalized.startsWith('../') ||
        path.posix.isAbsolute(normalized) || path.win32.isAbsolute(value)) {
        throw new ContentAccessError('Media path is outside the configured vault.', 403);
    }
    return normalized.replace(/^\.\//, '');
}

function hashVaultPath(value) {
    return crypto.createHash('sha256').update(normalizeVaultPath(value), 'utf8').digest('hex');
}

function allowedGenreSet(user) {
    const genres = user?.allowedGenres || [];
    return genres.length ? new Set(genres.map(genre => String(genre._id || genre))) : null;
}

function isMediaAllowed(user, media) {
    const allowed = allowedGenreSet(user);
    if (!allowed) return true;
    return (media?.genres || []).some(genre => allowed.has(String(genre._id || genre)));
}

function assertMediaAllowed(user, media) {
    if (!isMediaAllowed(user, media)) {
        throw new ContentAccessError('Access restricted to this content.', 403);
    }
}

function pathVariants(vaultPath) {
    const normalized = normalizeVaultPath(vaultPath);
    return [...new Set([normalized, normalized.replace(/\//g, '\\')])];
}

async function resolveMediaByVaultPath(vaultPath) {
    const normalized = normalizeVaultPath(vaultPath);
    const variants = pathVariants(normalized);
    const movie = await Movie.findOne({ vaultPath: { $in: variants } });
    if (movie) {
        return {
            resourceType: 'movie',
            resourceId: movie._id,
            mediaId: movie._id,
            media: movie,
            vaultPath: normalizeVaultPath(movie.vaultPath)
        };
    }

    const episode = await Episode.findOne({ vaultPath: { $in: variants } });
    if (episode) {
        const show = await TVShow.findById(episode.showId);
        if (!show) throw new ContentAccessError('Parent TV show was not found.', 404);
        return {
            resourceType: 'episode',
            resourceId: episode._id,
            mediaId: show._id,
            media: show,
            episode,
            vaultPath: normalizeVaultPath(episode.vaultPath)
        };
    }

    throw new ContentAccessError('Media resource was not found.', 404);
}

async function authorizeVaultPath(user, vaultPath) {
    const resource = await resolveMediaByVaultPath(vaultPath);
    assertMediaAllowed(user, resource.media);
    return resource;
}

async function authorizeMediaReference(user, mediaType, mediaId, episodeId = null) {
    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
        throw new ContentAccessError('Invalid media ID.', 400);
    }

    if (mediaType === 'movie') {
        const movie = await Movie.findById(mediaId);
        if (!movie) throw new ContentAccessError('Movie not found.', 404);
        assertMediaAllowed(user, movie);
        return { resourceType: 'movie', resourceId: movie._id, mediaId: movie._id, media: movie };
    }

    if (mediaType === 'tvshow') {
        const show = await TVShow.findById(mediaId);
        if (!show) throw new ContentAccessError('TV Show not found.', 404);
        assertMediaAllowed(user, show);
        if (episodeId) {
            if (!mongoose.Types.ObjectId.isValid(episodeId)) {
                throw new ContentAccessError('Invalid episode ID.', 400);
            }
            const episode = await Episode.findOne({ _id: episodeId, showId: show._id });
            if (!episode) throw new ContentAccessError('Episode not found.', 404);
            return { resourceType: 'episode', resourceId: episode._id, mediaId: show._id, media: show, episode };
        }
        return { resourceType: 'tvshow', resourceId: show._id, mediaId: show._id, media: show };
    }

    throw new ContentAccessError('mediaType must be movie or tvshow.', 400);
}

module.exports = {
    ContentAccessError,
    normalizeVaultPath,
    hashVaultPath,
    isMediaAllowed,
    assertMediaAllowed,
    resolveMediaByVaultPath,
    authorizeVaultPath,
    authorizeMediaReference
};
