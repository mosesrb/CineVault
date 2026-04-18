# Changelog

All notable changes to the CineVault project will be documented in this file.

## [1.2.8] - 2026-04-18

### Fixed
- **Download Progress Flicker**: Implemented native thread isolation (forging a tracking code into the URL) to prevent "Ghost tasks" from overlapping and overwriting the UI when a download is canceled and restarted.
- **File Collisions**: Saved downloads use uniquely hashed file names to prevent native threads from clashing inside the mobile storage layer.
- **UI Dropdowns**: Implemented click-outside detection for the User Menu inside `Navbar.jsx`, so menus collapse responsively when the user taps elsewhere.
- **Premium Detail Sizing**: Refined `.download-btn--detail` so that Download/Saving indicators securely adopt full-width 100% sizing, perfectly aligning with auxiliary controls like 'Resume Movie'.

### Changed
- Refactored `OfflineStorageService` natively, abandoning generic Capacitor global progress listeners for scoped, isolated identifiers.

## [1.2.0] - 2026-04-17

### Added
- **Fuzzy Search Engine**: Migrated backend search logic from strict MongoDB `$text` search to case-insensitive `$regex` matching. This enables finding media by partial names (e.g., typing "star" for *Interstellar*).
- **Dedicated Search Page**: Implemented a new `/search` route that provides a full-screen discovery experience when pressing "Enter" in any search input.
- **Mobile-Responsive Search View**: Search results now intelligently switch layouts based on the device:
  - **Web**: High-density cinematic grid for rapid scanning.
  - **Android/Phone**: Native-style vertical list view optimized for touch and one-handed use.
- **One-Click Launcher**: Added `launch_cinevault.bat` for quick full-stack startup on Windows.

### Fixed
- **Player Stability (Fullscreen Seek)**: Resolved an issue where seeking or switching tracks would force the player out of fullscreen.
- **Poster flickering**: Fixed a bug where the movie poster would reappear briefly during seeks/forwards.
- **Local Network Media Streaming**: Resolved issues where media failed to play on Android devices via local IP addresses by implementing **Private Network Access (PNA)** support, exposing `Content-Range` headers, and adding **Android Network Security** configurations.
- **ReferenceError**: Fixed a crash in `MobileNav.jsx` during search interactions.
- **Mongo Sort Error**: Fixed an invalid `$meta: textScore` sort that broke fuzzy search results.

### Changed
- Bumped version to `1.2.0`.
- Standardized search redirection across `Navbar` and `MobileNav`.

## [1.0.0] - 2026-04-11
- Initial production-ready release of CineVault.
- Proof of concept with basic library management, playback, and TMDb integration.
