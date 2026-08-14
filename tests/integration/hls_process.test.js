const path = require('path');
const fs = require('fs');
const hlsManager = require('../../services/hlsManagerService');

describe('HLS Manager Process Lifecycle (Reliability)', () => {
    const testDir = path.join(process.cwd(), 'hls-cache', 'test-session-123');

    afterEach(() => {
        hlsManager.stopSession('test-session-123');
        hlsManager.stopInactivityCleanup();
        try {
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        } catch (_) {}
    });

    it('should cleanly stop a session without throwing errors', () => {
        expect(() => {
            hlsManager.stopSession('non-existent-id');
        }).not.toThrow();
    });

    it('should start and stop inactivity cleanup timer cleanly', () => {
        const timer = hlsManager.startInactivityCleanup(1000, 2000);
        expect(timer).toBeDefined();
        hlsManager.stopInactivityCleanup();
    });
});
