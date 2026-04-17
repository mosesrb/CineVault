# 🎬 HLS Streaming Implementation Guide (CinemaPlayer Upgrade)

## 🎯 Objective

Upgrade current MP4 + manual seeking system to **HLS streaming** using Vidstack.

### Goals:

* ✅ Fix seek reset issues
* ✅ Support multi-audio tracks
* ✅ Support subtitles
* ✅ Enable adaptive streaming (future-ready)

---

# 🧩 Architecture Overview

```text
Client (Vidstack Player)
        ↓
   HLS (.m3u8)
        ↓
Backend (FFmpeg Transcoding)
        ↓
Media Files (MKV/MP4)
```

---

# 📋 Implementation Steps

---

## ✅ Step 1: Generate HLS Stream (Backend)

### 🔧 Basic Command

```bash
ffmpeg -i input.mkv \
  -map 0:v -map 0:a -map 0:s \
  -c:v libx264 -c:a aac \
  -f hls \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "segment_%03d.ts" \
  output.m3u8
```

---

## 📁 Output Structure

```text
/movie/
 ├── output.m3u8
 ├── segment_000.ts
 ├── segment_001.ts
 ├── segment_002.ts
 └── ...
```

---

## ✅ Step 2: Backend Streaming API

### Example (Node.js / Express)

```js
app.get('/stream/:id/master.m3u8', (req, res) => {
  const filePath = getHLSPath(req.params.id);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/stream/:id/:segment', (req, res) => {
  const segmentPath = getSegmentPath(req.params.id, req.params.segment);
  res.setHeader('Content-Type', 'video/MP2T');
  fs.createReadStream(segmentPath).pipe(res);
});
```

---

## ✅ Step 3: Update Frontend Player

### Replace MP4 with HLS source:

```jsx
<MediaPlayer
  ref={playerRef}
  src={`/stream/${movieId}/master.m3u8`}
  controls
  playsInline
/>
```

---

## ✅ Step 4: Remove Old Seek Logic

### ❌ Remove:

* `onManualSeek`
* `onSeeked` custom handler
* `pendingSeekRef`
* `clipStartTime`

👉 HLS handles seeking natively

---

## ✅ Step 5: Enable Subtitles

### FFmpeg includes subtitles automatically if mapped:

```bash
-map 0:s
```

### OR add external:

```jsx
<Track
  src="/subs/en.vtt"
  kind="subtitles"
  label="English"
  default
/>
```

---

## ✅ Step 6: Multi-Audio Support

FFmpeg automatically includes multiple audio tracks:

```bash
-map 0:a
```

👉 Vidstack will:

* Detect tracks
* Show audio selector UI

---

## ✅ Step 7: Add Adaptive Bitrate (Optional Upgrade)

### Multi-quality HLS:

```bash
ffmpeg -i input.mkv \
  -filter:v:0 scale=w=1920:h=1080 \
  -filter:v:1 scale=w=1280:h=720 \
  -map 0:v -map 0:a \
  -var_stream_map "v:0,a:0 v:1,a:0" \
  -f hls \
  -master_pl_name master.m3u8 \
  stream_%v.m3u8
```

---

## 🧠 Step 8: Smart Playback Logic

```js
if (isBrowserCompatible(file)) {
  return directMP4();
} else {
  return HLSstream();
}
```

---

## 🧪 Step 9: Testing Checklist

* [ ] Seek works instantly
* [ ] No reset to 0
* [ ] Audio tracks selectable
* [ ] Subtitles toggle works
* [ ] Works on mobile + TV
* [ ] No buffering loops

---

## ⚠️ Step 10: Performance Notes

* Use `-preset veryfast` for faster encoding
* Use GPU if available:

```bash
-c:v h264_nvenc
```

---

## 🚀 Step 11: Caching Strategy (IMPORTANT)

```text
First play → Transcode → Save HLS  
Next play → Serve cached HLS
```

---

## 📦 Step 12: Folder Structure (Recommended)

```text
/media
 ├── movies/
 ├── hls-cache/
 │    ├── movie1/
 │    ├── movie2/
 │    └── ...
```

---

# 🏁 Final Result

After implementation:

* ✅ No more seek bugs
* ✅ Smooth playback like YouTube
* ✅ Multi-audio + subtitles working
* ✅ Scalable architecture

---

# 🔥 Future Enhancements

* [ ] Thumbnail previews on seek
* [ ] Resume playback system
* [ ] Watch history tracking
* [ ] Auto-transcoding queue
* [ ] DRM support (Widevine/FairPlay)

---

# 📌 Priority

🔥 **High Priority Upgrade**

* Fixes core playback issues
* Enables production-grade streaming

---

# 🧠 Notes

* HLS replaces need for VLC entirely
* Works across all modern browsers
* Industry-standard approach

---
