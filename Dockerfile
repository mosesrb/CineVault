# Build Stage 1: Frontend
FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend

# Install frontend dependencies and build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build Stage 2: Backend & Final Image
FROM node:24-bookworm-slim
WORKDIR /app

# Install FFmpeg for video transcoding
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy backend source code
COPY . .

# Copy compiled frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create runtime directories and set ownership for non-root node user
RUN mkdir -p hls-cache && chown -R node:node /app

# Expose backend port
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Set production environment
ENV NODE_ENV=production \
    NODE_CONFIG_ENV=container
ENV PORT=3000

# Switch to non-root user
USER node

STOPSIGNAL SIGTERM

# Start the server
CMD ["node", "index.js"]
