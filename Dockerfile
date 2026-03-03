# ── Stage 1: deps ───────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests only — Docker caches this layer until they change
COPY package.json package-lock.json ./

# Install app deps + OpenTelemetry auto-instrumentation & OTLP exporter
RUN npm ci --omit=dev && \
    npm install @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-logs-otlp-http

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

# Create the downloads directory and debug log file, then set correct ownership
# (generated plugin zips and local logs are written here at runtime)
RUN mkdir -p src/public/downloads && touch /app/app_debug.log && chown -R appuser:appgroup /app

USER appuser

# The port our Express server listens on
EXPOSE 3000

# Health check — Coolify / Docker will restart the container if this fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "--import", "@opentelemetry/auto-instrumentations-node/register", "src/server.js"]