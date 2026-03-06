# ── Stage 1: deps ───────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests only — Docker caches this layer until they change
COPY package.json package-lock.json ./

# Install production dependencies only (skip devDependencies)
RUN npm ci --omit=dev

# ── Stage 2: runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner

# 1. Define a default port environment variable
ENV PORT=3000

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy installed deps from Stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY package.json ./
COPY payment-config.example.json ./payment-config.example.json

# Seed runtime payment config from the committed example.
RUN cp payment-config.example.json payment-config.json

# Create the downloads directory and debug log file, then set correct ownership
RUN mkdir -p src/public/downloads && touch /app/app_debug.log && chown -R appuser:appgroup /app

USER appuser

# 2. Reference the variable in EXPOSE (for documentation)
EXPOSE $PORT

# 3. Dynamic Health check — Reference the variable in the URL
# If the app moves to port 4000, this will automatically check port 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:${PORT}/health || exit 1

# Start the application
CMD ["node", "src/server.js"]