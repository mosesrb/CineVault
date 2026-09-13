/**
 * vaultService.js
 *
 * Manages the CineVault core library folder.
 * - Set/get the vault root path (stored in DB)
 * - Ingest files from external locations into the vault inbox
 * - Files from OUTSIDE the vault are physically moved into Inbox
 * - Files already inside the vault are untouched (path just recorded)
 */

const fs = require('fs');
const path = require('path');
const { Library } = require('../models/library');
const {
    PathSecurityError,
    isWithinRoot,
    resolveExistingPathWithinRoot,
    resolveExistingFileWithinRoot,
    resolveExistingDirectoryWithinRoot
} = require('./pathSecurityService');

/**
 * Retrieve the current library config from DB.
 * Returns null if not configured yet.
 */
async function getVaultConfig() {
    return await Library.findOne();
}

/**
 * Set or update the vault root path.
 * Creates the vault and inbox directories if they don't exist.
 */
async function setVaultRoot(vaultRootPath, inboxPath = '', tmdbApiKey = undefined) {
    const resolvedVault = path.resolve(vaultRootPath);
    const resolvedInbox = inboxPath
        ? path.resolve(inboxPath)
        : path.join(resolvedVault, 'Inbox');

    if (!isWithinRoot(resolvedVault, resolvedInbox, true)) {
        throw new PathSecurityError('Inbox path must be inside the configured vault root.');
    }

    await fs.promises.mkdir(resolvedVault, { recursive: true });
    await fs.promises.mkdir(resolvedInbox, { recursive: true });

    const canonicalInbox = await resolveExistingDirectoryWithinRoot(
        resolvedVault,
        resolvedInbox,
        true
    );
    const canonicalVault = canonicalInbox.root;

    // Upsert — only one library document ever
    let library = await Library.findOne();
    if (library) {
        library.vaultRootPath = canonicalVault;
        library.inboxPath = canonicalInbox.path;
        if (tmdbApiKey !== undefined) library.tmdbApiKey = tmdbApiKey;
        library.updatedAt = new Date();
    } else {
        library = new Library({
            vaultRootPath: canonicalVault,
            inboxPath: canonicalInbox.path,
            tmdbApiKey: tmdbApiKey || ''
        });
    }
    await library.save();
    return library;
}

/**
 * Ingest a file from an external path into the vault Inbox.
 *
 * Rules:
 * - If the file is already inside the vault root, do NOT move it.
 *   Just return its relative path within the vault.
 * - If the file is from an external location, copy it to Inbox/
 *   then delete the original (i.e., move semantics).
 *
 * Returns: { vaultPath, inboxPath, originalPath, alreadyInVault }
 */
async function ingestFile(sourcePath) {
    const library = await getVaultConfig();
    if (!library) {
        throw new Error('Vault is not configured. Please set a vault root path first.');
    }

    const source = await resolveExistingPathWithinRoot(library.vaultRootPath, sourcePath, {
        type: 'file',
        candidateIsAbsolute: true
    });
    const relativePath = path.relative(source.root, source.path);

    return {
        vaultPath: relativePath,
        originalPath: source.path,
        alreadyInVault: true
    };
}

/**
 * Update library stats (called after scan completes).
 */
async function updateStats(stats = {}) {
    const library = await getVaultConfig();
    if (!library) return;

    Object.assign(library, stats, { updatedAt: new Date() });
    await library.save();
    return library;
}

/**
 * If a file with the same name exists at dest, append a counter.
 * e.g., movie.mkv → movie_1.mkv → movie_2.mkv
 */
function _getUniqueDestPath(destPath) {
    if (!fs.existsSync(destPath)) return destPath;

    const ext = path.extname(destPath);
    const base = path.basename(destPath, ext);
    const dir = path.dirname(destPath);
    let counter = 1;
    let candidate = path.join(dir, `${base}_${counter}${ext}`);
    while (fs.existsSync(candidate)) {
        counter++;
        candidate = path.join(dir, `${base}_${counter}${ext}`);
    }
    return candidate;
}

/**
 * Safely delete a file from the vault.
 */
async function deleteVaultFile(relativePath) {
    if (!relativePath) return;

    const library = await getVaultConfig();
    if (!library) throw new Error('Vault is not configured.');

    try {
        const target = await resolveExistingFileWithinRoot(library.vaultRootPath, relativePath);
        await fs.promises.unlink(target.path);
        return true;
    } catch (error) {
        if (error instanceof PathSecurityError && error.code === 'PATH_NOT_FOUND') return false;
        throw error;
    }
}

/**
 * Finds a sidecar file (e.g., .srt) next to the specified media file.
 */
async function findSidecarFile(mediaRelativePath, extensions = ['.srt', '.vtt']) {
    if (!mediaRelativePath) return null;
    const config = await getVaultConfig();
    if (!config) return null;

    let mediaFile;
    try {
        mediaFile = await resolveExistingFileWithinRoot(config.vaultRootPath, mediaRelativePath);
    } catch (error) {
        if (error instanceof PathSecurityError) return null;
        throw error;
    }

    const baseFullPath = mediaFile.path;
    const dir = path.dirname(baseFullPath);
    let entries;
    try {
        entries = await fs.promises.readdir(dir);
    } catch (_) {
        return null;
    }

    const ext = path.extname(baseFullPath);
    const baseName = path.basename(baseFullPath, ext);

    for (const subExt of extensions) {
        // Try exact match: Movie.mkv -> Movie.srt
        const candidate1 = path.join(dir, baseName + subExt);
        try {
            const exact = await resolveExistingPathWithinRoot(config.vaultRootPath, candidate1, {
                type: 'file',
                candidateIsAbsolute: true
            });
            return exact.path;
        } catch (error) {
            if (!(error instanceof PathSecurityError)) throw error;
        }

        // Try language match: Movie.mkv -> Movie.en.srt
        // (Basic check for common naming patterns)
        const match = entries.find(f => f.startsWith(baseName) && f.endsWith(subExt));
        if (match) {
            try {
                const matched = await resolveExistingPathWithinRoot(
                    config.vaultRootPath,
                    path.join(dir, match),
                    { type: 'file', candidateIsAbsolute: true }
                );
                return matched.path;
            } catch (error) {
                if (!(error instanceof PathSecurityError)) throw error;
            }
        }
    }

    return null;
}

module.exports = { 
    getVaultConfig, 
    setVaultRoot, 
    ingestFile, 
    updateStats, 
    deleteVaultFile,
    findSidecarFile
};
