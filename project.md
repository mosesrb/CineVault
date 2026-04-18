# 🎬 CineVault  
> **A Local-First Intelligent Streaming Platform — Your Personal Netflix, Powered by Your Own Files**

---

## 🚀 Overview

**CineVault** is a self-hosted, local-first media streaming platform that transforms your raw movie and TV show files into a rich, Netflix-like experience.

It scans your local directories, intelligently identifies media, fetches metadata from the internet, and presents everything in a beautiful, organized interface — all while keeping your data **100% private and local**.

---

## 🔥 Core Features

### 📂 Intelligent Media Scanner
Automatically scans your local directories and builds your library.

- Recursive folder scanning (`/Movies`, `/TV Shows`)
- Filename parsing using regex + heuristics
- Auto-detection:
  - Movie titles
  - Release year
  - TV seasons & episodes
- Incremental re-scan support (only new/changed files)

---

### 🌐 Metadata Enrichment Engine
Transforms raw files into rich media entries.

- Fetches data from external APIs (TMDB / OMDb)
- Auto-populates:
  - Posters & backdrops
  - Cast & crew
  - Genres
  - Ratings & summaries
- Fuzzy matching for imperfect filenames
- Manual override support (fix mismatches)

---

### 🧠 Local Media Database
Structured storage powered by MongoDB.

- Collections:
  - `Media` (Movies & Shows)
  - `Episodes`
  - `Genres`
  - `WatchSessions`
- Indexed for fast querying and filtering
- Persistent metadata cache (offline access)

---

### 🎥 Streaming Engine
Serve and stream media directly from your machine.

- HTTP range requests (seek support)
- High-performance local streaming
- Subtitle support (`.srt`, `.vtt`)
- Multi-format compatibility (`.mp4`, `.mkv`, `.avi`)

---

### 🖥️ Netflix-Style Frontend
Modern, responsive UI for browsing and playback.

- Home dashboard:
  - Continue Watching
  - Recently Added
  - Genre rows
- Media detail pages:
  - Poster, description, cast
  - Play / Resume controls
- Smooth navigation & animations

---

### ▶️ Watch Tracking System
Track user activity and playback progress.

- Resume from last watched position
- Watch history tracking
- Per-user profiles
- Playback state sync

---

## ⚡ Advanced Features

### 🔍 Smart Search (AI-Ready)
Natural language and intelligent filtering.

- Search by:
  - Title
  - Genre
  - Actor
- Future-ready:
  - “Show me dark sci-fi movies from the 2000s”

---

### 🧩 Auto Categorization
Dynamic grouping of content.

- Genre-based collections
- Smart rows:
  - “Action Nights”
  - “Top Rated”
  - “Recently Watched”

---

### 🕵️ Duplicate Detection
Optional deep scan for redundant files.

- Hash-based duplicate detection (MD5)
- Safe isolation before deletion
- Integration with file organizer system

---

### 🛠️ File Organizer Integration
Optional synergy with your organizer tool.

- Auto-rename files into clean format
- Move files into structured folders: