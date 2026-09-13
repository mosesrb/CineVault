const fs = require('fs');
const path = require('path');

class PathSecurityError extends Error {
    constructor(message, code = 'PATH_OUTSIDE_ROOT') {
        super(message);
        this.name = 'PathSecurityError';
        this.code = code;
    }
}

function isWithinRoot(rootPath, candidatePath, allowRoot = false) {
    const relative = path.relative(rootPath, candidatePath);
    if (!relative) return allowRoot;
    return relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
}

function rejectUnsafeRelativePath(value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
        throw new PathSecurityError('A valid relative path is required.', 'INVALID_PATH');
    }
    if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
        throw new PathSecurityError('Absolute paths are not permitted.', 'PATH_OUTSIDE_ROOT');
    }
}

async function canonicalRoot(rootPath) {
    return fs.promises.realpath(path.resolve(rootPath));
}

async function resolveExistingPathWithinRoot(rootPath, candidatePath, options = {}) {
    const { type = 'any', allowRoot = false, candidateIsAbsolute = false } = options;
    const lexicalRoot = path.resolve(rootPath);
    const root = await canonicalRoot(lexicalRoot);

    let resolvedCandidate;
    if (candidateIsAbsolute) {
        if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
            throw new PathSecurityError('A valid path is required.', 'INVALID_PATH');
        }
        resolvedCandidate = path.resolve(candidatePath);
    } else {
        rejectUnsafeRelativePath(candidatePath);
        resolvedCandidate = path.resolve(lexicalRoot, candidatePath);
    }

    if (!isWithinRoot(lexicalRoot, resolvedCandidate, allowRoot)) {
        throw new PathSecurityError('Path is outside the configured root.');
    }

    let canonicalCandidate;
    try {
        canonicalCandidate = await fs.promises.realpath(resolvedCandidate);
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new PathSecurityError('Path does not exist.', 'PATH_NOT_FOUND');
        }
        throw error;
    }

    if (!isWithinRoot(root, canonicalCandidate, allowRoot)) {
        throw new PathSecurityError('Path resolves outside the configured root.');
    }

    const stats = await fs.promises.stat(canonicalCandidate);
    if (type === 'file' && !stats.isFile()) {
        throw new PathSecurityError('Path is not a regular file.', 'NOT_A_FILE');
    }
    if (type === 'directory' && !stats.isDirectory()) {
        throw new PathSecurityError('Path is not a directory.', 'NOT_A_DIRECTORY');
    }
    return { root, path: canonicalCandidate, stats };
}

async function resolveExistingFileWithinRoot(rootPath, relativePath) {
    return resolveExistingPathWithinRoot(rootPath, relativePath, { type: 'file' });
}

async function resolveExistingDirectoryWithinRoot(rootPath, candidatePath, allowRoot = true) {
    return resolveExistingPathWithinRoot(rootPath, candidatePath, {
        type: 'directory',
        allowRoot,
        candidateIsAbsolute: true
    });
}

module.exports = {
    PathSecurityError,
    isWithinRoot,
    canonicalRoot,
    resolveExistingPathWithinRoot,
    resolveExistingFileWithinRoot,
    resolveExistingDirectoryWithinRoot
};
