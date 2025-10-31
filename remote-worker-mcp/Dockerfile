# Production-Ready MCP Remote Worker
# Supports browser automation and OAST callbacks anywhere in the world

FROM node:20-slim

# Install dependencies for Chromium and curl
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    curl \
    ca-certificates \
    netcat-openbsd \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install Cursor using official installer
RUN curl https://cursor.com/install -fsS | bash || echo "⚠️ Cursor installation attempted"

# Add cursor-agent to PATH
ENV PATH="/root/.local/bin:${PATH}"

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --omit=dev

# Copy worker code
COPY remote-worker-mcp-client-simple.js ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Copy MCP configuration
COPY mcp-config.json ./

# Copy AI analytics prompt
COPY ai-analytics-prompt.txt ./

# Copy MCP configuration to cursor's expected location
RUN mkdir -p /root/.cursor && cp mcp-config.json /root/.cursor/mcp.json

# Copy MCP servers (domlogger-unified and mcp-worker)
COPY domlogger ./domlogger/
COPY mcp-worker ./mcp-worker/

# Environment variables - ALL WORKERS CONNECT TO CENTRAL MANAGER
ENV MANAGER_HOST="165.232.134.47"
ENV NATS_HOST="165.232.134.47"
ENV NATS_PORT="4222"
ENV REDIS_HOST="165.232.134.47"
ENV REDIS_PORT="6379"
ENV REDIS_PASSWORD="postgres"
ENV POSTGRES_HOST="165.232.134.47"
ENV POSTGRES_PORT="5432"
ENV POSTGRES_DB="mcp_manager"
ENV POSTGRES_USER="postgres"
ENV POSTGRES_PASSWORD="postgres"
ENV CURSOR_API_KEY="key_9e2c497c3c8bb4a332eaa0db49e9a537ca59531d5b9ac484e848906c84123f45"

# Worker configuration (can be customized per deployment)
ENV WORKER_ID=""
ENV HOSTNAME=""
ENV MAX_CONCURRENT_TASKS="5"
ENV MAX_MEMORY_MB="4096"
ENV WORKER_TAGS="mcp,docker,remote,enhanced,production"
ENV HEARTBEAT_INTERVAL_MS="10000"

# Chromium/Puppeteer settings
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('net').createConnection(process.env.NATS_PORT || 4222, process.env.NATS_HOST || 'manager').on('error', () => process.exit(1))"

# Entrypoint
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "remote-worker-mcp-client-simple.js"]
