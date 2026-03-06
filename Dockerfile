# ── Stage 1: deps ───────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests only — Docker caches this layer until they change
COPY package.json package-lock.json ./

# Install production dependencies only (skip devDependencies like nodemon)
RUN npm ci --omit=dev

# ── Stage 2: runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner

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
# Deployments can override /app/payment-config.json via bind mount if needed.
RUN cp payment-config.example.json payment-config.json

# Create the downloads directory and debug log file, then set correct ownership
# (generated plugin zips and local logs are written here at runtime)
RUN mkdir -p src/public/downloads && touch /app/app_debug.log && chown -R appuser:appgroup /app

USER appuser

# The port our Express server listens on
EXPOSE 3000

# Health check — Coolify / Docker will restart the container if this fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
