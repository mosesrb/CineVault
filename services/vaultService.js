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
async function setVaultRoot(vaultRootPath, inboxPath = '') {
    const resolvedVault = path.resolve(vaultRootPath);
    const resolvedInbox = inboxPath
        ? path.resolve(inboxPath)
        : path.join(resolvedVault, 'Inbox');

    // Create directories if they don't exist
    fs.mkdirSync(resolvedVault, { recursive: true });
    fs.mkdirSync(resolvedInbox, { recursive: true });

    // Upsert — only one library document ever
    let library = await Library.findOne();
    if (library) {
        library.vaultRootPath = resolvedVault;
        library.inboxPath = resolvedInbox;
        library.updatedAt = new Date();
    } else {
        library = new Library({
            vaultRootPath: resolvedVault,
            inboxPath: resolvedInbox
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

    const resolvedSource = path.resolve(sourcePath);
    const resolvedVault = path.resolve(library.vaultRootPath);
    const resolvedInbox = library.inboxPath
        ? path.resolve(library.inboxPath)
        : path.join(resolvedVault, 'Inbox');

    if (!fs.existsSync(resolvedSource)) {
        throw new Error(`Source file does not exist: ${resolvedSource}`);
    }

    const isAlreadyInVault = resolvedSource.startsWith(resolvedVault);

    if (isAlreadyInVault) {
        // Already in vault — just return the relative path
        const relativePath = path.relative(resolvedVault, resolvedSource);
        return {
            vaultPath: relativePath,
            originalPath: resolvedSource,
            alreadyInVault: true
        };
    }

    // Move file into Inbox
    const fileName = path.basename(resolvedSource);
    const destPath = path.join(resolvedInbox, fileName);

    // Avoid overwriting if file already exists in inbox
    const finalDest = _getUniqueDestPath(destPath);

    fs.copyFileSync(resolvedSource, finalDest);
    fs.unlinkSync(resolvedSource); // delete original after copy

    const relativePath = path.relative(resolvedVault, finalDest);

    return {
        vaultPath: relativePath,
        originalPath: resolvedSource,
        finalPath: finalDest,
        alreadyInVault: false
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

    const resolvedVault = path.resolve(library.vaultRootPath);
    const resolvedPath = path.resolve(resolvedVault, relativePath);

    // Safety check: Ensure the resolved path is still inside the vault root
    if (!resolvedPath.startsWith(resolvedVault)) {
        throw new Error('Security Error: Attempted to delete a file outside the vault root.');
    }

    if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
        return true;
    }
    return false;
}

/**
 * Finds a sidecar file (e.g., .srt) next to the specified media file.
 */
async function findSidecarFile(mediaRelativePath, extensions = ['.srt', '.vtt']) {
    const config = await getVaultConfig();
    if (!config) return null;

    const baseFullPath = path.join(config.vaultRootPath, mediaRelativePath);
    const dir = path.dirname(baseFullPath);
    const ext = path.extname(baseFullPath);
    const baseName = path.basename(baseFullPath, ext);

    for (const subExt of extensions) {
        // Try exact match: Movie.mkv -> Movie.srt
        const candidate1 = path.join(dir, baseName + subExt);
        if (fs.existsSync(candidate1)) return candidate1;

        // Try language match: Movie.mkv -> Movie.en.srt
        // (Basic check for common naming patterns)
        const entries = fs.readdirSync(dir);
        const match = entries.find(f => f.startsWith(baseName) && f.endsWith(subExt));
        if (match) return path.join(dir, match);
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
