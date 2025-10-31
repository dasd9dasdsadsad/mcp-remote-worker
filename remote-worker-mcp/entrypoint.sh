#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════════════"
echo "       MCP REMOTE WORKER - PRODUCTION DEPLOYMENT"
echo "═══════════════════════════════════════════════════════════════"

# Generate worker ID if not provided
if [ -z "$WORKER_ID" ]; then
  export WORKER_ID="mcp-worker-$(hostname)-$(cat /proc/sys/kernel/random/uuid | cut -d'-' -f1)"
  echo "Generated Worker ID: $WORKER_ID"
fi

# Set hostname if not provided
if [ -z "$HOSTNAME" ]; then
  export HOSTNAME=$(hostname)
fi

echo "Worker ID:      $WORKER_ID"
echo "Hostname:       $HOSTNAME"
echo "Manager Host:   $MANAGER_HOST"
echo "NATS:           $NATS_HOST:$NATS_PORT"
echo "Redis:          $REDIS_HOST:$REDIS_PORT"
echo "PostgreSQL:     $POSTGRES_HOST:$POSTGRES_PORT"
echo "═══════════════════════════════════════════════════════════════"

# Wait for NATS to be available
echo "Waiting for NATS..."
timeout 60 bash -c 'until nc -z $NATS_HOST $NATS_PORT 2>/dev/null; do sleep 1; done' || {
  echo "ERROR: NATS not available at $NATS_HOST:$NATS_PORT"
  exit 1
}
echo "✓ NATS is available"

# Wait for Redis to be available
echo "Waiting for Redis..."
timeout 60 bash -c 'until nc -z $REDIS_HOST $REDIS_PORT 2>/dev/null; do sleep 1; done' || {
  echo "ERROR: Redis not available at $REDIS_HOST:$REDIS_PORT"
  exit 1
}
echo "✓ Redis is available"

# Wait for PostgreSQL to be available
echo "Waiting for PostgreSQL..."
timeout 60 bash -c 'until nc -z $POSTGRES_HOST $POSTGRES_PORT 2>/dev/null; do sleep 1; done' || {
  echo "ERROR: PostgreSQL not available at $POSTGRES_HOST:$POSTGRES_PORT"
  exit 1
}
echo "✓ PostgreSQL is available"

echo "═══════════════════════════════════════════════════════════════"
echo "Starting MCP Remote Worker..."
echo "═══════════════════════════════════════════════════════════════"

# Execute the main command
exec "$@"
