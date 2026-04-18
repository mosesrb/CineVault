# 🛠️ Fix Vidstack Seek Reset Bug (CinemaPlayer)

## 🎯 Objective

Fix the issue where seeking (forward/dragging timeline) resets playback to **0 seconds** in the CinemaPlayer.

---

## 🧩 Root Cause Summary

* Player is being **remounted on seek**
* Caused by:

  * Dynamic `key` prop on `<MediaPlayer>`
  * Changing `src` during seek
  * Using `onSeeking` (fires too early)
  * Misuse of `clipStartTime`

---

## 📋 Tasks

### ✅ 1. Remove Dynamic `key` (CRITICAL)

**File:** `CinemaPlayer.jsx`

#### ❌ Remove:

```jsx
key={typeof src === 'string' ? src : src.src}
```

#### ✅ Result:

* Prevents React from remounting the player
* Preserves playback state

---

### ✅ 2. Replace `onSeeking` with `onSeeked`

#### ❌ Current:

```js
onSeeking={handleSeeking}
```

#### ✅ Update:

```js
onSeeked={handleSeeked}
```

#### ✅ New Handler:

```js
const handleSeeked = () => {
  if (isTranscoding && onManualSeek) {
    const time = playerRef.current?.currentTime;
    if (time != null) {
      onManualSeek(time);
    }
  }
};
```

#### 🎯 Reason:

* `onSeeking` fires too early → causes instability
* `onSeeked` fires after user completes seek → reliable

---

### ✅ 3. Fix `clipStartTime` Usage

#### ❌ Current:

```jsx
clipStartTime={isTranscoding ? startTime : 0}
```

#### ✅ Update:

```jsx
clipStartTime={0}
```

#### 🎯 Reason:

* Conflicts with manual seeking logic
* Backend should handle offset (`-ss` in transcoding)

---

### ✅ 4. Stabilize `src` Prop

#### Add:

```js
const stableSrc = React.useMemo(() => src, [src]);
```

#### Update Player:

```jsx
<MediaPlayer src={stableSrc} />
```

#### 🎯 Reason:

* Prevents unnecessary re-renders
* Keeps player instance stable

---

### ✅ 5. Improve Transcoding Seek Flow

#### 🚀 Target Behavior:

1. User seeks
2. Capture target time
3. Pause player
4. Request backend stream:

   ```
   /stream?start=<time>
   ```
5. Update stream source WITHOUT remount
6. Resume playback

---

### ⚠️ 6. Avoid Direct Remount on Source Change

#### ❌ Avoid:

* Re-rendering full component
* Changing `key`
* Resetting player instance

#### ✅ Preferred:

```js
playerRef.current.src = newStreamUrl;
```

---

### 🧪 7. Debug Check (Optional)

Add temporary debug:

```js
React.useEffect(() => {
  console.log("Player mounted");
}, []);
```

#### Expected:

* Should log **once only**
* If logs on every seek → still remounting

---

## ✅ Acceptance Criteria

* [ ] Seeking does NOT reset to 0
* [ ] Player does NOT remount on seek
* [ ] Timeline drag works smoothly
* [ ] Transcoding seek triggers backend correctly
* [ ] Playback resumes from correct timestamp

---

## 🚀 Future Improvements (Optional)

* [ ] Add seek preview thumbnails
* [ ] Add buffering indicator during transcode switch
* [ ] Implement resume playback (watch history)
* [ ] Optimize HLS/DASH for real seeking support

---

## 🧠 Notes

* Native seeking **won’t work properly with transcoding**
* Treat seek as a **"request new stream at timestamp"**
* Keep player instance stable at all costs

---

## 📌 Priority

🔥 **High Priority Bug Fix**

* Impacts core playback UX
* Must be resolved before production release

---
