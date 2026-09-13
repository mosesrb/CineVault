describe('application lifecycle', () => {
    const originalPort = process.env.PORT;

    afterAll(() => {
        if (originalPort === undefined) delete process.env.PORT;
        else process.env.PORT = originalPort;
    });

    it('starts after dependencies are ready and shuts down cleanly', async () => {
        process.env.PORT = '0';
        const { startServer, stopServer } = require('../index');

        const server = await startServer();
        expect(server.listening).toBe(true);
        expect(server.address().port).toBeGreaterThan(0);

        await stopServer('test');
        expect(server.listening).toBe(false);
    });
});
