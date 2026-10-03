const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

describe('dependency-free development watch mode', () => {
    it('keeps database preflight, production startup and the complete audit gate', () => {
        expect(pkg.scripts.dev).toBe('node --watch --watch-preserve-output index.js');
        expect(pkg.scripts.predev).toBe('node scripts/ensure_local_mongodb.js');
        expect(pkg.scripts.start).toBe('node index.js');
        expect(pkg.scripts.fullstack).toContain('npm run dev');
        expect(pkg.scripts.audit).toBe('npm audit && npm audit --prefix frontend');
        expect(pkg.scripts['verify:web']).toMatch(/^npm run audit &&/);
    });

    it('removes the vulnerable watcher chain rather than overriding or hiding it', () => {
        for (const name of ['nodemon', 'chokidar', 'braces']) {
            expect(pkg.devDependencies[name]).toBeUndefined();
            expect(Object.keys(lock.packages).some(key => key.endsWith(`/node_modules/${name}`)
                || key === `node_modules/${name}`)).toBe(false);
        }
    });

    it('restarts an imported module and recovers from a startup error', async () => {
        // Disposable synthetic files only; never start the real server/database.
        const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cinevault-watch-test-'));
        const entry = path.join(fixture, 'index.js');
        const dependency = path.join(fixture, 'value.js');
        let output = '';
        let exitCode;
        let watcher;
        let cleanupError;
        const childPids = new Set();
        const waitFor = async predicate => {
            const deadline = Date.now() + 12000;
            while (!predicate()) {
                if (exitCode !== undefined) throw Error(`Watcher exited unexpectedly: ${exitCode}`);
                if (Date.now() > deadline) throw Error(`Watch-mode check timed out: ${output}`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
        try {
            fs.writeFileSync(dependency, 'module.exports = 1;\n');
            fs.writeFileSync(entry, [
                "const value = require('./value');",
                "console.log('WATCH_READY:' + process.pid + ':' + value);",
                "const timer = setTimeout(() => process.exit(0), 60000);",
                "process.on('SIGTERM', () => { clearTimeout(timer); process.exit(0); });"
            ].join('\n'));
            const args = pkg.scripts.dev.split(' ').slice(1, -1).concat(entry);
            watcher = spawn(process.execPath, args, { cwd: fixture, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            const collect = chunk => {
                output += chunk.toString();
                for (const match of output.matchAll(/WATCH_READY:(\d+):\d+/g)) childPids.add(Number(match[1]));
            };
            watcher.stdout.on('data', collect);
            watcher.stderr.on('data', collect);
            watcher.on('error', error => { output += error.message; exitCode = -1; });
            watcher.on('exit', code => { exitCode = code; });
            await waitFor(() => /WATCH_READY:\d+:1/.test(output));
            fs.writeFileSync(dependency, 'module.exports = 2;\n');
            await waitFor(() => /WATCH_READY:\d+:2/.test(output));
            fs.writeFileSync(dependency, "throw new Error('SYNTHETIC_WATCH_FAILURE');\n");
            await waitFor(() => output.includes('SYNTHETIC_WATCH_FAILURE'));
            fs.writeFileSync(dependency, 'module.exports = 3;\n');
            await waitFor(() => /WATCH_READY:\d+:3/.test(output));
            expect(childPids.size).toBe(3);
        } finally {
            if (watcher && exitCode === undefined) {
                const exited = new Promise(resolve => watcher.once('exit', resolve));
                watcher.kill();
                await exited;
            }
            // Windows termination may not cascade to the watcher's child.
            for (const pid of childPids) {
                try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') cleanupError = error; }
            }
            fs.rmSync(fixture, { recursive: true, force: true });
        }
        if (cleanupError) throw cleanupError;
    }, 45000);
});
