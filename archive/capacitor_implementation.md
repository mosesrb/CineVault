# 🎬 CineVault Android App Setup (Capacitor + Cloudflare Tunnel)

## 📌 Goal

Convert the CineVault React frontend into an Android app (Phone + TV compatible) using Capacitor, while using Cloudflare Tunnel for remote access during testing.

---

# 🧱 Architecture Overview

```
CineVault Backend (Node.js)
        ↓
Cloudflare Tunnel (public URL)
        ↓
React Frontend (Vite build)
        ↓
Capacitor Wrapper
        ↓
Android App (APK)
```

---

# ⚙️ Prerequisites

* Node.js (v18+ recommended)
* Android Studio installed
* Java JDK (comes with Android Studio)
* CineVault frontend working locally
* cloudflared working (you already tested ✅)

---

# 🚀 Step 1: Prepare Frontend

Build your React app:

```bash
npm run build
```

Output should be in:

```
/dist
```

---

# 📦 Step 2: Install Capacitor

```bash
npm install @capacitor/core @capacitor/cli
npx cap init cinevault com.cinevault.app
```

### When prompted:

* App Name: `CineVault`
* App ID: `com.cinevault.app`

---

# 🔗 Step 3: Configure Build Output

Edit:

```
capacitor.config.json
```

```json
{
  "appId": "com.cinevault.app",
  "appName": "CineVault",
  "webDir": "dist",
  "bundledWebRuntime": false
}
```

---

# 📱 Step 4: Add Android Platform

```bash
npx cap add android
```

---

# 🔄 Step 5: Sync Project

```bash
npx cap sync
```

---

# 🧑‍💻 Step 6: Open in Android Studio

```bash
npx cap open android
```

Wait for Gradle sync to complete.

---

# 🌐 Step 7: Connect to Your Backend (IMPORTANT)

Since you're using Cloudflare Tunnel:

### Option A (Quick Testing)

Hardcode your tunnel URL:

```js
const API_BASE = "https://your-random.trycloudflare.com";
```

---

### Option B (Better)

Use environment config:

```env
VITE_API_URL=https://your-random.trycloudflare.com
```

Then in code:

```js
const API_BASE = import.meta.env.VITE_API_URL;
```

---

# 🔐 Step 8: Allow External Requests (Android Fix)

Open:

```
android/app/src/main/AndroidManifest.xml
```

Add inside `<application>`:

```xml
android:usesCleartextTraffic="true"
```

---

# 📺 Step 9: Android TV Optimization

### Enable D-Pad Navigation

You already support it ✅

Now ensure:

* Focusable elements:

```css
button, div {
  outline: none;
}
```

* Add visible focus:

```css
:focus {
  transform: scale(1.05);
  border: 2px solid white;
}
```

---

### Lock Landscape Mode

Edit:

```
MainActivity.java
```

```java
setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
```

---

# 🎬 Step 10: Video Playback Notes

Your current player works via WebView.

### Ensure:

* HLS streams enabled
* Range requests working
* No CORS issues

---

# ⚠️ Important for Streaming

Cloudflare Tunnel:

* Works well for testing
* May struggle with very high bitrate files

### Recommended:

* Use your adaptive HLS system ✅
* Avoid raw 40–60 Mbps files during testing

---

# ▶️ Step 11: Build APK

In Android Studio:

1. Build → Build APK(s)
2. Locate APK:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Install on:

* Phone ✅
* Android TV (via USB or ADB)

---

# 📡 Step 12: Run With Tunnel

Start CineVault backend:

```bash
npm run dev
```

Start tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

Update app API URL → rebuild → test

---

# 🧪 Testing Flow

```
1. Start backend
2. Start tunnel
3. Launch app
4. Login
5. Play media
```

---

# 🧠 Recommended Improvements (Next Phase)

## 1. Dynamic Server URL Input

Add a settings screen:

* User enters server URL manually
* Saves in local storage

---

## 2. Device Pairing (TV UX)

* TV shows code
* Phone logs in
* Auto-authenticate TV

---

## 3. Token-Based Streaming

Protect media URLs:

* Signed URLs
* Expiry-based playback

---

## 4. Native Player (Future Upgrade)

Replace WebView playback with:

* ExoPlayer (better buffering + codec support)

---

# 🔒 Security Notes

Since you’re exposing via tunnel:

* Use test accounts only
* Do NOT expose admin account
* Kill tunnel after testing

---

# ✅ Final Result

You now have:

✔ Android app (phone + TV)
✔ Uses your existing UI
✔ Streams from your CineVault backend
✔ Accessible over internet via Cloudflare Tunnel

---

# 🚀 Next Steps

* Add settings page (server URL input)
* Improve TV UX polish
* Explore native player integration

---

**CineVault is now evolving from local system → real cross-device platform.**
