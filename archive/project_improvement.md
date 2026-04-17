# 🎬 CineVault — Practical Enhancement Plan (Offline-First & UX-Focused)

**Scope:**
Single-user • Local-first • Privacy-focused • Low-maintenance

This document defines a **realistic, high-impact upgrade plan** based on selected focus areas:

* Smart Search (No AI)
* Player Improvements
* Mobile Experience
* UI/UX Enhancements
* Offline Mode + Downloads

---

# 🎯 Core Philosophy

> Fast > Fancy
> Local > Cloud
> Simple > Smart AI

CineVault should feel:

* ⚡ Instant
* 🧠 Intuitive
* 🔒 Private
* 📱 Reliable even without internet

---

# 🔍 1. Smart Lightweight Search & Filtering

## ✅ Objective

Enable **fast content discovery** without AI complexity.

## 🔧 Features

### Search Capabilities

* Search by:

  * Title
  * Actor
  * Genre
  * Year

### Advanced Filters

* Duration:

  * `< 90 min`
  * `< 2 hours`
* Rating:

  * `> 7`
* Release Year:

  * Range slider
* Recently Added
* Watched / Unwatched

### UX Behavior

* Instant filtering (no page reload)
* Combine filters (e.g., *Action + <2hr + Unwatched*)

---

# 🎬 2. Player Enhancements (High Impact, Low Complexity)

## ✅ Objective

Make playback feel **polished and frustration-free**

## 🔧 Features

### Playback Controls

* ⏪ Replay last 10 seconds
* ⏩ Skip forward (10–30 sec configurable)

### Subtitle Controls

* Adjust delay (+/-)
* Font size selector
* Color options
* Toggle background

### Audio Controls

* Audio delay sync (+/-)
* Track switching (already exists → refine UI)

### Keyboard Shortcuts (Desktop)

* Space → Play/Pause
* Arrow keys → Seek
* `S` → Toggle subtitles

---

# 📱 3. Mobile Experience (Practical, Not Overbuilt)

## ✅ Objective

Smooth experience on **low-end and offline devices**

## 🔧 Features

### Download System (Manual)

* Download button on:

  * Movie detail page
  * Episode list

### Storage Handling

* Show:

  * File size before download
  * Download progress
* Local storage directory:

  * `/CineVault/Downloads/`

### Playback

* Play downloaded content **without server**
* Resume playback locally

---

# 🌐 4. Offline Mode (Critical Feature)

## ✅ Objective

App should **work without internet/server connection**

---

## 🧠 Behavior Logic

### When Server is Available:

* Full library loads
* Streaming enabled
* Sync watch progress

### When Server is NOT Available:

* App switches to **Offline Mode**

---

## 🔧 Offline Mode Features

### Available:

* ✅ Downloaded Movies
* ✅ Downloaded Shows & Episodes
* ✅ Local playback
* ✅ Stored watch progress (local)

### Not Available:

* ❌ Streaming
* ❌ Metadata refresh
* ❌ Library scan

---

## 🖥️ Offline UI

### Entry Screen

Display:

```
⚠️ Offline Mode Active

No server connection detected.
Showing downloaded content only.
```

### Sections:

* Downloaded Movies
* Downloaded Shows
* Continue Watching (local)

---

## 🔄 Sync Behavior (When Back Online)

* Sync watch progress to server
* Refresh metadata silently
* Restore full library view

---

# 🎨 5. UI/UX Improvements (Usability > Looks)

## ✅ Objective

Reduce friction and clicks

---

## 🔧 Features

### Quick Actions

* ▶️ “Quick Play” button on cards
* ⭐ Favorite button

### Content Rows

* Continue Watching
* Recently Added
* Favorites
* Unwatched

### Interaction Improvements

* Max 2 clicks to play content
* Better spacing for mobile
* Smooth scroll performance

---

## 🔥 Optional (Nice-to-Have)

* Thumbnail preview on hover/scrub
* Auto-focus first playable item

---

# 📦 6. Download System (Detailed Behavior)

## 🔧 Download Flow

1. User clicks “Download”
2. App:

   * Checks storage availability
   * Starts file transfer
3. Show:

   * Progress bar
   * Pause / Cancel option

---

## 📁 Storage Rules

* Store original file (no transcoding)
* Maintain folder structure:

  ```
  Downloads/
    Movies/
    Shows/
      ShowName/
        Season 1/
  ```

---

## 🧠 Smart Handling

* Prevent duplicate downloads
* Allow delete from UI
* Show storage usage

---

# 🧩 7. State Management (Important for Offline)

## Local Storage Should Track:

* Downloaded files list
* Watch progress (offline)
* Last played timestamps

## Sync Strategy:

* Merge local → server when online
* Conflict rule:

  * Latest timestamp wins

---

# 🛠️ Implementation Notes

## Frontend

* Use:

  * IndexedDB (for offline metadata)
  * Service Worker (for offline detection)

## Backend

* No changes required for offline mode
* Optional:

  * Endpoint for progress sync

---

# 🧭 Development Priority

## 🥇 Phase 1

* Smart filters
* Player controls
* Quick play UI

## 🥈 Phase 2

* Download system
* Local playback support

## 🥉 Phase 3

* Offline mode detection
* Sync logic

---

# 🏁 Final Goal

CineVault should feel like:

> 🎬 “My personal Netflix — even without internet”

---

## Success Criteria

* App opens without internet ✅
* Downloaded content plays instantly ✅
* No confusion between online/offline states ✅
* Minimal setup, zero maintenance ✅

---

**End of Plan**
