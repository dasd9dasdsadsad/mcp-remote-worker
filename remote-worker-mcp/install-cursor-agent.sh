#!/bin/bash
# Install cursor-agent in the Docker container
# Usage: ./install-cursor-agent.sh <container_name>

set -e

CONTAINER_NAME=${1:-mcp-worker}

echo "═══════════════════════════════════════════════════════════════"
echo "Installing cursor-agent in container: $CONTAINER_NAME"
echo "═══════════════════════════════════════════════════════════════"

# Check if cursor-agent exists on host
if ! command -v cursor-agent &> /dev/null; then
    echo "❌ cursor-agent not found on host system!"
    echo "Please install cursor-agent first:"
    echo "  curl -fsSL https://cursor.sh/install-agent | bash"
    exit 1
fi

echo "✅ Found cursor-agent on host"

# Get cursor-agent path
CURSOR_AGENT_SYMLINK=$(which cursor-agent)
CURSOR_AGENT_PATH=$(readlink -f $CURSOR_AGENT_SYMLINK)
CURSOR_AGENT_DIR=$(dirname $CURSOR_AGENT_PATH)
CURSOR_AGENT_VERSION=$(basename $(dirname $CURSOR_AGENT_PATH))

echo "   Path: $CURSOR_AGENT_PATH"
echo "   Version: $CURSOR_AGENT_VERSION"

# Create archive
echo "📦 Creating archive..."
tar -czf /tmp/cursor-agent-install.tar.gz -C $CURSOR_AGENT_DIR .

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "❌ Container $CONTAINER_NAME is not running!"
    exit 1
fi

echo "✅ Container is running"

# Copy to container
echo "📋 Copying to container..."
docker cp /tmp/cursor-agent-install.tar.gz $CONTAINER_NAME:/tmp/

# Install in container
echo "🔧 Installing in container..."
docker exec $CONTAINER_NAME bash -c "
    mkdir -p /root/.local/share/cursor-agent/versions/$CURSOR_AGENT_VERSION && \
    cd /root/.local/share/cursor-agent/versions/$CURSOR_AGENT_VERSION && \
    tar -xzf /tmp/cursor-agent-install.tar.gz && \
    chmod +x cursor-agent && \
    ln -sf /root/.local/share/cursor-agent/versions/$CURSOR_AGENT_VERSION/cursor-agent /usr/local/bin/cursor-agent && \
    rm /tmp/cursor-agent-install.tar.gz
"

# Clean up
rm /tmp/cursor-agent-install.tar.gz

# Verify
echo "✅ Verifying installation..."
if docker exec $CONTAINER_NAME cursor-agent --version; then
    echo "═══════════════════════════════════════════════════════════════"
    echo "✅ cursor-agent successfully installed!"
    echo "═══════════════════════════════════════════════════════════════"
else
    echo "❌ Installation verification failed!"
    exit 1
fi


