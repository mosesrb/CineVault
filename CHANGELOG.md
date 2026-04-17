# Changelog

All notable changes to the CineVault project will be documented in this file.

## [1.1.0] - 2026-04-17

### Added
- **Fuzzy Search Engine**: Migrated backend search logic from strict MongoDB `$text` search to case-insensitive `$regex` matching. This enables finding media by partial names (e.g., typing "star" for *Interstellar*).
- **Dedicated Search Page**: Implemented a new `/search` route that provides a full-screen discovery experience when pressing "Enter" in any search input.
- **Mobile-Responsive Search View**: Search results now intelligently switch layouts based on the device:
  - **Web**: High-density cinematic grid for rapid scanning.
  - **Android/Phone**: Native-style vertical list view optimized for touch and one-handed use.
- **Production Details Hardening**: Added grid safety and responsive typography to the "Production Details" section on the media detail page to prevent text overlap on mobile.

### Fixed
- **Navigation Crash**: Resolved a `ReferenceError` in `MobileNav.jsx` that caused the app to crash when using the search interface.
- **Empty Matches Error**: Fixed an invalid MongoDB sort call (`textScore`) that prevented fuzzy search results from appearing.
- **Blank Page Rendering**: Resolved issues where undefined CSS variables and missing style imports caused the search results page to appear blank.
- **Header Congestion**: Hidden the top search bar on small screens (< 768px) to consolidate navigation into the mobile-friendly bottom bar.

### Changed
- Bumped version to `1.1.0`.
- Standardized search redirection across `Navbar` and `MobileNav` to use the new dedicated results page.

## [1.0.0] - 2026-04-11
- Initial production-ready release of CineVault.
- Proof of concept with basic library management, playback, and TMDb integration.
