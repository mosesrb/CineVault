# Build Stage 1: Frontend
FROM node:24-bullseye-slim AS frontend-build
WORKDIR /app/frontend

# Install frontend dependencies and build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build Stage 2: Backend & Final Image
FROM node:24-bullseye-slim
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

# Expose backend port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Start the server
CMD ["npm", "start"]
