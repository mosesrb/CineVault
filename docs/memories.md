# Project Memories & Architecture

This document serves as the persistent memory and architectural blueprint for the CineVault (Delatron) project. It contains critical invariants, development guidelines, and context that all future AI agents must strictly follow.

## Core Directives
- **Execution Quality**: Work like a surgeon. Do not prioritize speed over quality. Take as much time as needed to ensure work is high-quality, bug-free, and thoroughly verified.
- **Security First**: Never hardcode sensitive information (TMDB API keys, JWT secrets, MongoDB URIs). Rely on environment variables. `.env` and `.keystore` files must be strictly git-ignored.
- **Coding Standards**: `async/await` heavily preferred, `snake_case` for API models, `camelCase` for internal variables/components, and mandatory JSDoc for complex transformations.

## Tech Stack & Infrastructure
- **Backend**: Node.js, Express, MongoDB (Mongoose) for metadata, Redis for caching.
- **Frontend**: React 18, Vite, Lucide Icons, Vidstack (Video Player), Capacitor (Android).
- **Testing**: Jest (Backend - run sequentially with `--runInBand`), Vitest & React Testing Library (Frontend).
- **Deployment**: Multi-stage Docker & docker-compose. Media directories are dynamically volume-mounted to `/media`.

## Architectural Components
### Media Streaming (HLS) & Transcoding
- The system uses FFmpeg for real-time HLS transcoding, with segments stored in `hls-cache/`. 
- **Concurrency**: FFmpeg instances are managed via `async-mutex`. Requests queue up rather than drop when limits are reached.
- **Process Management**: Streaming sessions are tied to child process handlers to guarantee cleanup on client disconnect.

### Offline Sync & Storage
- **Task-ID Protocol**: Mobile offline storage uses a "Task-ID" protocol to manage active downloads, preventing UI ghosting during network drops.

### Metadata & Ingestion
- A background scanner watches the library and triggers the `metadataService`.
- Heuristic scoring matches files against TMDB.
- Admins configure TMDB keys dynamically via `/api/admin/settings/tmdb`.

## Android (Capacitor) Specific Rules
- **Safe Areas**: Always design edge-to-edge. Use `min-height: 100dvh` (not `100vh`), and utilize CSS environment variables like `env(safe-area-inset-bottom)` to clear navigation bars.
- **Hardware Back Button**: Android physical back button events are intercepted via `cv_hardware_back`. Any modals/overlays must handle this event and call `e.preventDefault()` to prevent unexpected app exits.
- **UI State & Touch**: 
  - The global `<Footer />` must be dynamically gated to prevent UI overlapping on auth screens (`/login`, `/register`).
  - Use cooldown guards on legal agreement buttons to reject delayed synthetic touch triggers on Android WebViews.
