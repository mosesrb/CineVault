const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Android release transport and signing configuration', () => {
    it('keeps release WebView and network traffic HTTPS-only', () => {
        const capacitor = JSON.parse(read('frontend/capacitor.config.json'));
        const manifest = read('frontend/android/app/src/main/AndroidManifest.xml');
        const networkConfig = read('frontend/android/app/src/main/res/xml/network_security_config.xml');

        expect(capacitor.server.androidScheme).toBe('https');
        expect(capacitor.server.cleartext).toBe(false);
        expect(capacitor.android.allowMixedContent).toBe(false);
        expect(manifest).toContain('android:usesCleartextTraffic="false"');
        expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
        expect(networkConfig).toContain('cleartextTrafficPermitted="false"');
        expect(networkConfig).not.toContain('<certificates src="user"');
    });

    it('allows LAN HTTP only in the explicit debug variant', () => {
        const debugManifest = read('frontend/android/app/src/debug/AndroidManifest.xml');
        const debugNetworkConfig = read('frontend/android/app/src/debug/res/xml/network_security_config_debug.xml');
        const activity = read('frontend/android/app/src/main/java/com/cinevault/app/MainActivity.java');

        expect(debugManifest).toContain('android:usesCleartextTraffic="true"');
        expect(debugNetworkConfig).toContain('cleartextTrafficPermitted="true"');
        expect(activity).toContain('if (BuildConfig.DEBUG)');
        expect(activity).toContain('MIXED_CONTENT_ALWAYS_ALLOW');
    });

    it('loads release signing secrets only from the process environment', () => {
        const gradle = read('frontend/android/app/build.gradle');

        expect(gradle).toContain("System.getenv('CINEVAULT_KEYSTORE_PASSWORD')");
        expect(gradle).toContain("System.getenv('CINEVAULT_KEY_PASSWORD')");
        expect(gradle).not.toMatch(/storePassword\s+["'][^"']+["']/);
        expect(gradle).not.toMatch(/keyPassword\s+["'][^"']+["']/);
    });
});
