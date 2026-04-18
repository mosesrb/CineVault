# CineVault Setup Guide

Welcome to **CineVault**! This guide will walk you through setting up the server locally, exposing it for mobile testing using Cloudflare Tunnels, and configuring your Android application.

---

## 1. Prerequisites
Before you begin, ensure you have the following installed on your machine:
- **Node.js** (v18 or higher recommended)
- **MongoDB** (Running locally on the default port `27017`)
- **Git**

## 2. Server Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mosesrb/CineVault.git
   cd CineVault
   ```

2. **Install backend dependencies:**
   ```bash
   npm install
   ```

3. **Install frontend dependencies:**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

4. **Start the application:**
   The project uses a `fullstack` command to run both the Node.js backend and the Vite React frontend simultaneously.
   ```bash
   npm run fullstack
   ```
   *Your server is now running on `http://localhost:3000` and your local frontend is running locally.*

---

## 3. Exposing the Server (Cloudflare Tunnel)

Currently, we use **Cloudflare Tunnels** to expose the local backend to the internet so that the Android app can communicate with it securely during testing and development.

1. Download and install [Cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Run the following command in a new terminal window to expose your local port `3000`:
   ```bash
   cloudflared tunnel --protocol http2 --url http://localhost:3000
   ```
3. Cloudflare will generate a temporary URL in the terminal output (e.g., `https://random-words.trycloudflare.com`). 
4. **Copy this URL**. You will need it to connect the Android app to your server.

---

## 4. Connecting the Mobile App

When you launch the CineVault app on your Android device (or from the frontend web environment), you need to tell the app where your server is hosted.

1. **Login Screen:** 
   When you first open the app, you will be prompted to enter a **Server URL**. Paste the `trycloudflare.com` URL you copied in the previous step here. 
2. **Login/Register:** 
   Once the URL is set, proceed to register an account or log in.
3. **Changing the Server URL:** 
   If your Cloudflare tunnel restarts and assigns you a new URL, you can easily update it! Just navigate to the **Profile** section inside the app, scroll to the connection settings, and update your Server URL.

---

## 5. Building the Android App (Optional)

If you have Android Studio installed and want to test directly on a physical device or emulator:

1. Ensure the frontend is built and Capacitor is synced:
   ```bash
   cd frontend
   npm run build
   npx cap sync
   ```
2. Open the project in Android Studio:
   ```bash
   npx cap open android
   ```
3. Click the **Run** button to install the app on your device or emulator!
