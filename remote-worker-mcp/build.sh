#!/bin/bash

# Build script for MCP Remote Worker Enhanced
# This script prepares and builds the Docker image with enhanced MCP worker

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 Building MCP Remote Worker Enhanced"
echo "═══════════════════════════════════════════════════════════════"

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Create mcp-worker directory if it doesn't exist
if [ ! -d "mcp-worker" ]; then
    echo "📁 Creating mcp-worker directory..."
    mkdir -p mcp-worker
fi

# Copy enhanced worker files
echo "📋 Copying enhanced worker files..."
cp ../mcp-worker/index-enhanced.js mcp-worker/ 2>/dev/null || echo "⚠️  Enhanced worker not found, using existing"
cp ../mcp-worker/package.json mcp-worker/ 2>/dev/null || echo "⚠️  Worker package.json not found"

# Update mcp-config.json to ensure it uses the enhanced worker
echo "🔧 Updating MCP configuration..."
cat > mcp-config.json << 'EOF'
{
  "mcpServers": {
    "mcp-worker-enhanced": {
      "command": "node",
      "args": [
        "/app/mcp-worker/index-enhanced.js"
      ],
      "env": {
        "WORKER_TYPE": "enhanced",
        "NATS_HOST": "${NATS_HOST:-host.docker.internal}",
        "REDIS_HOST": "${REDIS_HOST:-host.docker.internal}",
        "POSTGRES_HOST": "${POSTGRES_HOST:-host.docker.internal}"
      },
      "description": "MCP Worker Enhanced - Advanced Analytics & Reporting with 30+ tools"
    },
    "domlogger-unified": {
      "command": "node",
      "args": [
        "/app/domlogger/server.js"
      ],
      "alwaysAllow": [
        "*"
      ],
      "autoRun": true,
      "description": "DOM Logger for web automation and monitoring"
    }
  }
}
EOF

# Build the Docker image
echo "🐳 Building Docker image..."
docker build -t mcp-remote-worker-enhanced:latest .

echo ""
echo "✅ Build complete!"
echo ""
echo "To run the worker:"
echo "  docker run -d \\"
echo "    --name mcp-worker-1 \\"
echo "    -e MANAGER_HOST=host.docker.internal \\"
echo "    -e CURSOR_API_KEY=\$CURSOR_API_KEY \\"
echo "    mcp-remote-worker-enhanced:latest"
echo ""
echo "═══════════════════════════════════════════════════════════════"


# Build script for MCP Remote Worker Enhanced
# This script prepares and builds the Docker image with enhanced MCP worker

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 Building MCP Remote Worker Enhanced"
echo "═══════════════════════════════════════════════════════════════"

# Ensure we're in the right directory
cd "$(dirname "$0")"

# Create mcp-worker directory if it doesn't exist
if [ ! -d "mcp-worker" ]; then
    echo "📁 Creating mcp-worker directory..."
    mkdir -p mcp-worker
fi

# Copy enhanced worker files
echo "📋 Copying enhanced worker files..."
cp ../mcp-worker/index-enhanced.js mcp-worker/ 2>/dev/null || echo "⚠️  Enhanced worker not found, using existing"
cp ../mcp-worker/package.json mcp-worker/ 2>/dev/null || echo "⚠️  Worker package.json not found"

# Update mcp-config.json to ensure it uses the enhanced worker
echo "🔧 Updating MCP configuration..."
cat > mcp-config.json << 'EOF'
{
  "mcpServers": {
    "mcp-worker-enhanced": {
      "command": "node",
      "args": [
        "/app/mcp-worker/index-enhanced.js"
      ],
      "env": {
        "WORKER_TYPE": "enhanced",
        "NATS_HOST": "${NATS_HOST:-host.docker.internal}",
        "REDIS_HOST": "${REDIS_HOST:-host.docker.internal}",
        "POSTGRES_HOST": "${POSTGRES_HOST:-host.docker.internal}"
      },
      "description": "MCP Worker Enhanced - Advanced Analytics & Reporting with 30+ tools"
    },
    "domlogger-unified": {
      "command": "node",
      "args": [
        "/app/domlogger/server.js"
      ],
      "alwaysAllow": [
        "*"
      ],
      "autoRun": true,
      "description": "DOM Logger for web automation and monitoring"
    }
  }
}
EOF

# Build the Docker image
echo "🐳 Building Docker image..."
docker build -t mcp-remote-worker-enhanced:latest .

echo ""
echo "✅ Build complete!"
echo ""
echo "To run the worker:"
echo "  docker run -d \\"
echo "    --name mcp-worker-1 \\"
echo "    -e MANAGER_HOST=host.docker.internal \\"
echo "    -e CURSOR_API_KEY=\$CURSOR_API_KEY \\"
echo "    mcp-remote-worker-enhanced:latest"
echo ""
echo "═══════════════════════════════════════════════════════════════"

