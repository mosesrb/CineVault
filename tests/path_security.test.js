const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    PathSecurityError,
    isWithinRoot,
    resolveExistingFileWithinRoot,
    resolveExistingDirectoryWithinRoot
} = require('../services/pathSecurityService');
const { parseSingleRange } = require('../routes/stream');

describe('Phase 1 path containment and range parsing', () => {
    let temporaryRoot;
    let vaultRoot;
    let siblingRoot;

    beforeEach(() => {
        temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cinevault-path-'));
        vaultRoot = path.join(temporaryRoot, 'vault');
        siblingRoot = path.join(temporaryRoot, 'vault-escape');
        fs.mkdirSync(vaultRoot);
        fs.mkdirSync(siblingRoot);
        fs.writeFileSync(path.join(vaultRoot, 'movie.mp4'), 'movie');
        fs.writeFileSync(path.join(siblingRoot, 'secret.mp4'), 'secret');
    });

    afterEach(() => {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    });

    it('accepts a regular file inside the canonical vault', async () => {
        const result = await resolveExistingFileWithinRoot(vaultRoot, 'movie.mp4');
        expect(result.path).toBe(await fs.promises.realpath(path.join(vaultRoot, 'movie.mp4')));
        expect(result.stats.isFile()).toBe(true);
    });

    it('rejects sibling-prefix traversal and absolute file input', async () => {
        await expect(resolveExistingFileWithinRoot(vaultRoot, '../vault-escape/secret.mp4'))
            .rejects.toBeInstanceOf(PathSecurityError);
        await expect(resolveExistingFileWithinRoot(vaultRoot, path.join(vaultRoot, 'movie.mp4')))
            .rejects.toBeInstanceOf(PathSecurityError);
        expect(isWithinRoot(vaultRoot, siblingRoot, true)).toBe(false);
    });

    it('allows only an existing directory contained by the approved root', async () => {
        const result = await resolveExistingDirectoryWithinRoot(vaultRoot, vaultRoot, true);
        expect(result.path).toBe(await fs.promises.realpath(vaultRoot));
        await expect(resolveExistingDirectoryWithinRoot(vaultRoot, siblingRoot, true))
            .rejects.toBeInstanceOf(PathSecurityError);
    });

    it('parses standard, open-ended, and suffix byte ranges', () => {
        expect(parseSingleRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 });
        expect(parseSingleRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
        expect(parseSingleRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
        expect(parseSingleRange('bytes=9-20', 10)).toEqual({ start: 9, end: 9 });
    });

    it('rejects malformed, multiple, and unsatisfiable ranges', () => {
        expect(parseSingleRange('bytes=10-11', 10)).toBe(false);
        expect(parseSingleRange('bytes=5-4', 10)).toBe(false);
        expect(parseSingleRange('bytes=0-1,4-5', 10)).toBe(false);
        expect(parseSingleRange('items=0-1', 10)).toBe(false);
        expect(parseSingleRange('bytes=-0', 10)).toBe(false);
    });
});
