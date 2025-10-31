#!/bin/bash

# Setup Infrastructure for MCP Enhanced System
# This script sets up NATS, Redis, and PostgreSQL for the MCP system

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 MCP INFRASTRUCTURE SETUP"
echo "═══════════════════════════════════════════════════════════════"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Function to check if a container is running
container_running() {
    docker ps --format "table {{.Names}}" | grep -q "^$1$"
}

# Function to wait for a service to be ready
wait_for_service() {
    local service=$1
    local check_command=$2
    local max_attempts=30
    local attempt=1

    echo "⏳ Waiting for $service to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if eval "$check_command" > /dev/null 2>&1; then
            echo "✅ $service is ready!"
            return 0
        fi
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "❌ $service failed to start after $max_attempts attempts"
    return 1
}

# Start NATS
echo ""
echo "1️⃣ Starting NATS..."
if container_running "nats"; then
    echo "   NATS is already running"
else
    docker run -d --name nats \
        -p 4222:4222 \
        -p 8222:8222 \
        nats:latest -m 8222
fi
wait_for_service "NATS" "curl -s http://localhost:8222/healthz"

# Start Redis
echo ""
echo "2️⃣ Starting Redis..."
if container_running "redis"; then
    echo "   Redis is already running"
else
    docker run -d --name redis \
        -p 6379:6379 \
        redis:7-alpine
fi
wait_for_service "Redis" "docker exec redis redis-cli ping"

# Start PostgreSQL
echo ""
echo "3️⃣ Starting PostgreSQL..."
if container_running "postgres"; then
    echo "   PostgreSQL is already running"
else
    docker run -d --name postgres \
        -e POSTGRES_DB=mcp_manager \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -p 5432:5432 \
        postgres:15-alpine
fi
wait_for_service "PostgreSQL" "docker exec postgres pg_isready -U postgres"

# Give PostgreSQL a bit more time to fully initialize
echo "   Waiting for PostgreSQL to fully initialize..."
sleep 5

# Test connections
echo ""
echo "4️⃣ Testing connections..."

# Test NATS
echo -n "   Testing NATS... "
if curl -s http://localhost:8222/healthz > /dev/null; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

# Test Redis
echo -n "   Testing Redis... "
if docker exec redis redis-cli ping | grep -q PONG; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

# Test PostgreSQL
echo -n "   Testing PostgreSQL... "
if docker exec postgres psql -U postgres -d mcp_manager -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Infrastructure setup complete!"
echo ""
echo "Services running:"
echo "   - NATS: localhost:4222 (monitoring at http://localhost:8222)"
echo "   - Redis: localhost:6379"
echo "   - PostgreSQL: localhost:5432 (database: mcp_manager)"
echo ""
echo "To stop all services:"
echo "   docker stop nats redis postgres"
echo ""
echo "To remove all services:"
echo "   docker rm -f nats redis postgres"
echo "═══════════════════════════════════════════════════════════════"


# Setup Infrastructure for MCP Enhanced System
# This script sets up NATS, Redis, and PostgreSQL for the MCP system

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 MCP INFRASTRUCTURE SETUP"
echo "═══════════════════════════════════════════════════════════════"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Function to check if a container is running
container_running() {
    docker ps --format "table {{.Names}}" | grep -q "^$1$"
}

# Function to wait for a service to be ready
wait_for_service() {
    local service=$1
    local check_command=$2
    local max_attempts=30
    local attempt=1

    echo "⏳ Waiting for $service to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if eval "$check_command" > /dev/null 2>&1; then
            echo "✅ $service is ready!"
            return 0
        fi
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "❌ $service failed to start after $max_attempts attempts"
    return 1
}

# Start NATS
echo ""
echo "1️⃣ Starting NATS..."
if container_running "nats"; then
    echo "   NATS is already running"
else
    docker run -d --name nats \
        -p 4222:4222 \
        -p 8222:8222 \
        nats:latest -m 8222
fi
wait_for_service "NATS" "curl -s http://localhost:8222/healthz"

# Start Redis
echo ""
echo "2️⃣ Starting Redis..."
if container_running "redis"; then
    echo "   Redis is already running"
else
    docker run -d --name redis \
        -p 6379:6379 \
        redis:7-alpine
fi
wait_for_service "Redis" "docker exec redis redis-cli ping"

# Start PostgreSQL
echo ""
echo "3️⃣ Starting PostgreSQL..."
if container_running "postgres"; then
    echo "   PostgreSQL is already running"
else
    docker run -d --name postgres \
        -e POSTGRES_DB=mcp_manager \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_PASSWORD=postgres \
        -p 5432:5432 \
        postgres:15-alpine
fi
wait_for_service "PostgreSQL" "docker exec postgres pg_isready -U postgres"

# Give PostgreSQL a bit more time to fully initialize
echo "   Waiting for PostgreSQL to fully initialize..."
sleep 5

# Test connections
echo ""
echo "4️⃣ Testing connections..."

# Test NATS
echo -n "   Testing NATS... "
if curl -s http://localhost:8222/healthz > /dev/null; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

# Test Redis
echo -n "   Testing Redis... "
if docker exec redis redis-cli ping | grep -q PONG; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

# Test PostgreSQL
echo -n "   Testing PostgreSQL... "
if docker exec postgres psql -U postgres -d mcp_manager -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ OK"
else
    echo "❌ FAILED"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ Infrastructure setup complete!"
echo ""
echo "Services running:"
echo "   - NATS: localhost:4222 (monitoring at http://localhost:8222)"
echo "   - Redis: localhost:6379"
echo "   - PostgreSQL: localhost:5432 (database: mcp_manager)"
echo ""
echo "To stop all services:"
echo "   docker stop nats redis postgres"
echo ""
echo "To remove all services:"
echo "   docker rm -f nats redis postgres"
echo "═══════════════════════════════════════════════════════════════"

