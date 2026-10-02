const { isManagedLocalMongo, ensureLocalMongo } = require('../scripts/ensure_local_mongodb');

describe('dedicated Windows database startup', () => {
    it('starts the dedicated local database before the app without launching another backend', () => {
        const run = jest.fn(() => ({ status: 0 }));
        ensureLocalMongo({ mongoURI: 'mongodb://user:secret@127.0.0.1:27018/cinevault', platform: 'win32', run });
        expect(run).toHaveBeenCalledTimes(1);
        const [command, args, options] = run.mock.calls[0];
        expect(command).toBe('powershell.exe');
        expect(args).toContain('-DatabaseOnly');
        expect(args.join(' ')).not.toContain('secret');
        expect(options.windowsHide).toBe(true);
    });

    it.each([
        ['mongodb://127.0.0.1:27018/cinevault', 'linux'],
        ['mongodb://127.0.0.1:27017/cinevault', 'win32'],
        ['mongodb://db.example:27018/cinevault', 'win32'],
        ['mongodb+srv://db.example/cinevault', 'win32'],
        ['invalid', 'win32']
    ])('leaves externally managed targets alone (%s, %s)', (mongoURI, platform) => {
        const run = jest.fn();
        expect(isManagedLocalMongo(mongoURI, platform)).toBe(false);
        ensureLocalMongo({ mongoURI, platform, run });
        expect(run).not.toHaveBeenCalled();
    });

    it.each([{ status: 1 }, { status: null, error: new Error('spawn failed') }])(
        'stops startup when the database helper fails', result => {
            expect(() => ensureLocalMongo({
                mongoURI: 'mongodb://127.0.0.1:27018/cinevault', platform: 'win32',
                run: () => result
            })).toThrow('CineVault database startup failed');
        }
    );
});
