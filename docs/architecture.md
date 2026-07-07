# CineVault Architecture

## Overview
CineVault is a personal media sanctuary built with a monolithic Node.js/Express backend and a React frontend. The application is designed as a mobile-first experience and packaged via Capacitor for Android deployment.

## Core Stack
- **Backend:** Node.js, Express
- **Frontend:** React, Capacitor (Android wrapping), Vidstack (Video Player)
- **Database:** MongoDB (Library metadata)
- **Caching:** Redis (API Response caching)
- **Media Engine:** FFmpeg (Transcoding)

## Key Components & Architecture

### Backend Modules
The backend follows a modular structure:
- **`routes/`**: API endpoints (versioned under `/api/v1`), including `movies`, `tvshows`, and `stream`.
- **`services/`**: Core business logic.
  - `transcoderService`: Manages FFmpeg spawning for HLS generation.
  - `metadataService`: Implements a heuristic scoring system to match files against TMDB.
- **`middleware/`**: Shared request handlers, including a Redis caching layer for GET requests.

### Media Streaming (HLS)
The system leverages adaptive HTTP Live Streaming (HLS). Instead of buffering entire files, the backend uses FFmpeg for real-time, on-the-fly transcoding and segment generation, stored temporarily in `hls-cache/`. 
- **Concurrency Queue**: FFmpeg transcoding instances are managed via an asynchronous semaphore (`async-mutex`) limit. If limits are exceeded, incoming requests are queued rather than immediately dropped, ensuring smooth client-side loading states.

### Offline Sync & Storage
Designed for mobile, the system features robust offline downloading.
- **Task-ID Protocol**: The offline storage service uses a "Task-ID" identity tracking protocol to manage active downloads. This prevents UI ghosting and flickering during network drops or rapid restart/cancel cycles.

### Background Ingestion
A background scanner watches the library folder. When a file is dropped in, it automatically triggers the metadata service to fetch cast, crew, trailers, and posters, seamlessly adding it to the collection.

## Coding Principles & UI/UX
- **Mobile Discovery**: Content grids on mobile breakpoints use flexible list-based layouts to ensure stability on narrow screens.
- **Touch-First**: Interactive elements have a minimum hit target of 44x44px.
- **State Management**: Atomic, globally synchronized state to avoid local-only changes requiring page refreshes.
- **Backend Standards**: `async/await` heavily preferred, `snake_case` for API models, `camelCase` for internal variables/components, and mandatory JSDoc for complex transformations.

## Testing & Quality Assurance
- **Backend**: Uses Jest with sequential execution (`--runInBand`) to avoid MongoDB conflicts.
- **Frontend**: Uses Vitest and React Testing Library, fully integrated with Vite for near-instant test execution, alongside `fake-indexeddb` for simulating offline browser capabilities.

## Deployment & DevOps
- **Docker & Orchestration**: The application is fully containerized using a multi-stage `Dockerfile`. `docker-compose.yml` orchestrates the Node.js backend (including FFmpeg via `bullseye-slim`) alongside the MongoDB database container.
- **Media Binding**: External host media directories are dynamically injected into the container via volume mounts and mapped to `/media` internally, allowing the application to scale across different environments without hardcoded paths.
