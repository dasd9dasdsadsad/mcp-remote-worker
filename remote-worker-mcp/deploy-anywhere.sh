#!/bin/bash
#
# MCP Worker - Deploy Anywhere Script
# Connects automatically to manager at 165.232.134.47
#
# Usage:
#   bash <(curl -s https://your-domain.com/deploy-anywhere.sh)
#   OR
#   ./deploy-anywhere.sh
#

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       🚀 MCP Remote Worker - One-Click Deploy 🚀            ║"
echo "║                                                              ║"
echo "║  Connects to Manager: 165.232.134.47                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Configuration
MANAGER_IP="165.232.134.47"
DOCKER_IMAGE="YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest"
WORKER_NAME="mcp-worker"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed!"
    echo ""
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    echo "✅ Docker installed!"
    echo ""
fi

# Test connectivity to manager
echo "🔍 Testing connectivity to manager (${MANAGER_IP})..."

if nc -z -w5 ${MANAGER_IP} 4222 2>/dev/null; then
    echo "   ✅ NATS (4222): Connected"
else
    echo "   ⚠️  NATS (4222): Cannot connect"
fi

if nc -z -w5 ${MANAGER_IP} 6379 2>/dev/null; then
    echo "   ✅ Redis (6379): Connected"
else
    echo "   ⚠️  Redis (6379): Cannot connect"
fi

if nc -z -w5 ${MANAGER_IP} 5432 2>/dev/null; then
    echo "   ✅ PostgreSQL (5432): Connected"
else
    echo "   ⚠️  PostgreSQL (5432): Cannot connect"
fi

echo ""

# Stop existing worker if running
if docker ps -a --format '{{.Names}}' | grep -q "^${WORKER_NAME}$"; then
    echo "🛑 Stopping existing worker..."
    docker stop ${WORKER_NAME} 2>/dev/null || true
    docker rm ${WORKER_NAME} 2>/dev/null || true
    echo "   ✅ Removed old worker"
fi

# Pull latest image
echo "📥 Pulling latest worker image..."
docker pull ${DOCKER_IMAGE}
echo "   ✅ Image pulled"
echo ""

# Generate worker ID
HOSTNAME=$(hostname)
WORKER_ID="worker-${HOSTNAME}-$(date +%s)"

# Deploy worker
echo "🚀 Deploying worker..."
echo "   Worker ID: ${WORKER_ID}"
echo "   Tags: production,${HOSTNAME}"
echo ""

docker run -d \
  --name ${WORKER_NAME} \
  --restart unless-stopped \
  -e WORKER_ID="${WORKER_ID}" \
  -e WORKER_TAGS="production,${HOSTNAME}" \
  -v /tmp/screenshots:/root \
  ${DOCKER_IMAGE}

# Wait a few seconds for worker to start
echo "⏳ Waiting for worker to start..."
sleep 5

# Check if worker is running
if docker ps --format '{{.Names}}' | grep -q "^${WORKER_NAME}$"; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              ✅ WORKER DEPLOYED SUCCESSFULLY! ✅             ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "📊 Worker Status:"
    docker ps | grep ${WORKER_NAME}
    echo ""
    echo "📋 Quick Commands:"
    echo "   View logs:    docker logs -f ${WORKER_NAME}"
    echo "   Stop worker:  docker stop ${WORKER_NAME}"
    echo "   Start worker: docker start ${WORKER_NAME}"
    echo "   Remove worker: docker rm -f ${WORKER_NAME}"
    echo ""
    echo "🔍 Last 20 log lines:"
    docker logs --tail 20 ${WORKER_NAME}
else
    echo ""
    echo "❌ Worker failed to start!"
    echo ""
    echo "🔍 Checking logs..."
    docker logs ${WORKER_NAME}
    exit 1
fi

