# CineVault 🎥 🍿

CineVault is a premium, local-first media streaming platform rebuilt from a legacy node-express application. It features a modern, Netflix-style interface, generic file validation, active streaming capabilities via HTTP range requests, a comprehensive media vault processing engine for autonomous ingestion and TMDB auto-metadata population, and role-based access control.

## Stack
* **Database**: MongoDB & Mongoose
* **Backend**: Node.js & Express.js
* **Frontend**: React 18 & Vite (Glassmorphism + CSS Vars)

## Quick Start
1. Ensure MongoDB is actively running (`mongodb://localhost/cinevault_dev`).
2. Install frontend dependencies: `cd frontend && npm install`
3. Install backend dependencies: `npm install`
4. Set Environment Variables:
   * See `.env.sample`. Export `delatron_jwtPrivateKey` as it is strictly required. 
   * You may export `delatron_TMDB_API_KEY` for movie and series metadata integration.
5. In development, start both Node and Vite together:
   `npm run fullstack`

## End-to-End Test and Media Ingestion
1. Start the server via `npm run fullstack`.
2. Browse to the landing page, and create an Admin user in MongoDB or login if an account exists. (In MongoDB, set `isAdmin: true` on your user document).
3. Log into CineVault as an Admin. 
4. Open the **Admin Panel** -> **Library**. Configure the `Vault Root Path` and `Inbox Path` to point to a valid folder on your computer.
5. Ingest a Movie:
   - Provide an absolute path to a known local video file (e.g. `C:\Downloads\The.Matrix.mp4`).
   - The file will be moved to the Inbox. 
   - Perform a library scan via the Dashboard!
6. The video file will auto-populate as a Movie (or TV Show depending on parsing) via TMDB APIs and stream effortlessly!