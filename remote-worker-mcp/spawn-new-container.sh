#!/bin/bash

# Generate unique container ID
CONTAINER_NUM=$(date +%s | tail -c 4)
CONTAINER_NAME="mcp-remote-worker-enhanced-${CONTAINER_NUM}"

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 Spawning New MCP-Enabled Docker Container"
echo "═══════════════════════════════════════════════════════════════"
echo "Container Name: ${CONTAINER_NAME}"
echo ""

# Run the container with unique name
docker run -d \
  --name "${CONTAINER_NAME}" \
  --hostname "${CONTAINER_NAME}" \
  --network host \
  -e MANAGER_HOST=localhost \
  -e NATS_HOST=localhost \
  -e NATS_PORT=4222 \
  -e REDIS_HOST=localhost \
  -e REDIS_PORT=6379 \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=mcp_manager \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e CURSOR_API_KEY=key_b152ee53835f22ffbefaa5164ff763a27426cbdfe4b4d2c394123d3b9c229939 \
  -e WORKER_TAGS=mcp,docker,remote,enhanced,spawned \
  -e MCP_ENABLED=true \
  -e MCP_SERVERS=mcp-worker,domlogger-unified \
  -e NODE_ENV=production \
  --security-opt seccomp=unconfined \
  --shm-size 2gb \
  -v "${CONTAINER_NAME}-logs:/var/log/worker" \
  -v "${CONTAINER_NAME}-chrome:/root/.config/chromium" \
  remote-worker-mcp-mcp-remote-worker:latest

if [ $? -eq 0 ]; then
  echo "✅ Container spawned successfully!"
  echo ""
  echo "📊 Container Details:"
  docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
  echo ""
  echo "📝 To check logs:"
  echo "   docker logs -f ${CONTAINER_NAME}"
  echo ""
  echo "🔍 To verify MCP config:"
  echo "   docker exec ${CONTAINER_NAME} cat /root/.cursor/mcp.json"
  echo ""
  echo "💡 To enter shell:"
  echo "   docker exec -it ${CONTAINER_NAME} bash"
else
  echo "❌ Failed to spawn container"
fi
