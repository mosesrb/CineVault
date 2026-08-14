const { fetchMetadata } = require('../../services/metadataService');
const { parseFilename } = require('../../services/scannerService');

describe('Metadata Service & Parser Edge Cases', () => {
    beforeAll(() => {
        // Set sample TMDB test key
        process.env.TMDB_API_KEY = 'd778178bf483db0d218b6fa1128e6707';
    });

    describe('Filename Parsing', () => {
        it('parses Superdeep variations correctly', () => {
            const parsed1 = parseFilename('Superdeep.2020.1080p.mkv');
            expect(parsed1).toMatchObject({
                type: 'movie',
                title: 'Superdeep',
                year: 2020
            });

            const parsed2 = parseFilename('The.Superdeep.2020.mkv');
            expect(parsed2).toMatchObject({
                type: 'movie',
                title: 'The Superdeep',
                year: 2020
            });

            const parsed3 = parseFilename('Kolskaya.Sverhglubokaya.2020.mkv');
            expect(parsed3).toMatchObject({
                type: 'movie',
                title: 'Kolskaya Sverhglubokaya',
                year: 2020
            });
        });

        it('parses Evil Dead variants correctly', () => {
            const parsed1 = parseFilename('Evil.Dead.Burn.2023.1080p.mkv');
            expect(parsed1).toMatchObject({
                type: 'movie',
                title: 'Evil Dead Burn',
                year: 2023
            });

            const parsed2 = parseFilename('Evil.Dead.Rise.2023.1080p.mkv');
            expect(parsed2).toMatchObject({
                type: 'movie',
                title: 'Evil Dead Rise',
                year: 2023
            });
        });
    });

    describe('TMDB Fetching & Fallback Matching', () => {
        it('fetches metadata for Superdeep even if year is missing or differs', async () => {
            const meta = await fetchMetadata('Superdeep', 2020, 'movie');
            expect(meta.metaSource).toBe('tmdb');
            expect(meta.tmdbId).toBe('579828');
            expect(meta.title).toMatch(/Superdeep/i);
            expect(meta.posterUrl).toContain('https://image.tmdb.org');
        });

        it('fetches metadata for The Superdeep prefix variant', async () => {
            const meta = await fetchMetadata('The Superdeep', 2020, 'movie');
            expect(meta.metaSource).toBe('tmdb');
            expect(meta.tmdbId).toBe('579828');
        });

        it('fetches metadata for Evil Dead Burn even with mismatched file year', async () => {
            const meta = await fetchMetadata('Evil Dead Burn', 2023, 'movie');
            expect(meta.metaSource).toBe('tmdb');
            expect(meta.tmdbId).toBe('1212763');
            expect(meta.title).toBe('Evil Dead Burn');
        });

        it('fetches metadata for Evil Dead Rise', async () => {
            const meta = await fetchMetadata('Evil Dead Rise', 2023, 'movie');
            expect(meta.metaSource).toBe('tmdb');
            expect(meta.tmdbId).toBe('713704');
            expect(meta.title).toBe('Evil Dead Rise');
        });
    });
});
