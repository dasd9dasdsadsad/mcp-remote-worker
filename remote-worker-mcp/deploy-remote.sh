#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "═══════════════════════════════════════════════════════════════"
echo "🌍 MCP Remote Worker - Global Deployment Script"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Function to check if .env exists
check_env_file() {
    if [ ! -f ".env" ]; then
        echo -e "${RED}❌ No .env file found!${NC}"
        echo ""
        echo "Please create .env file from template:"
        echo "  cp env.template .env"
        echo "  vim .env  # Edit with your manager server details"
        echo ""
        exit 1
    fi
}

# Function to validate environment
validate_env() {
    source .env
    
    echo "🔍 Validating configuration..."
    echo ""
    
    # Check required variables
    if [ "$MANAGER_HOST" = "your.manager.server.ip" ] || [ -z "$MANAGER_HOST" ]; then
        echo -e "${RED}❌ MANAGER_HOST not configured!${NC}"
        echo "   Please edit .env and set MANAGER_HOST to your manager server IP"
        exit 1
    fi
    
    if [[ "$CURSOR_API_KEY" == "key_YOUR_ACTUAL_KEY_HERE" ]] || [ -z "$CURSOR_API_KEY" ]; then
        echo -e "${RED}❌ CURSOR_API_KEY not configured!${NC}"
        echo "   Please edit .env and set your actual Cursor API key"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Configuration validated${NC}"
    echo "   Manager Host: $MANAGER_HOST"
    echo "   Worker Number: ${WORKER_NUMBER:-1}"
    echo ""
}

# Function to test connectivity
test_connectivity() {
    echo "🔌 Testing connectivity to manager services..."
    echo ""
    
    source .env
    
    # Use environment variables or defaults
    NATS_HOST=${NATS_HOST:-$MANAGER_HOST}
    NATS_PORT=${NATS_PORT:-4222}
    REDIS_HOST=${REDIS_HOST:-$MANAGER_HOST}
    REDIS_PORT=${REDIS_PORT:-6379}
    POSTGRES_HOST=${POSTGRES_HOST:-$MANAGER_HOST}
    POSTGRES_PORT=${POSTGRES_PORT:-5432}
    
    # Test NATS
    echo -n "Testing NATS at $NATS_HOST:$NATS_PORT... "
    if nc -z -v -w5 $NATS_HOST $NATS_PORT 2>/dev/null; then
        echo -e "${GREEN}✅ Connected${NC}"
    else
        echo -e "${RED}❌ Failed${NC}"
        echo "   Make sure NATS is accessible on manager server"
    fi
    
    # Test Redis
    echo -n "Testing Redis at $REDIS_HOST:$REDIS_PORT... "
    if nc -z -v -w5 $REDIS_HOST $REDIS_PORT 2>/dev/null; then
        echo -e "${GREEN}✅ Connected${NC}"
    else
        echo -e "${RED}❌ Failed${NC}"
        echo "   Make sure Redis is accessible on manager server"
    fi
    
    # Test PostgreSQL
    echo -n "Testing PostgreSQL at $POSTGRES_HOST:$POSTGRES_PORT... "
    if nc -z -v -w5 $POSTGRES_HOST $POSTGRES_PORT 2>/dev/null; then
        echo -e "${GREEN}✅ Connected${NC}"
    else
        echo -e "${RED}❌ Failed${NC}"
        echo "   Make sure PostgreSQL is accessible on manager server"
    fi
    
    echo ""
}

# Function to deploy worker
deploy_worker() {
    echo "🚀 Deploying MCP Remote Worker..."
    echo ""
    
    # Build image
    echo "Building Docker image..."
    docker compose -f docker-compose.remote.yml build
    
    # Start container
    echo "Starting container..."
    docker compose -f docker-compose.remote.yml up -d
    
    echo ""
    echo -e "${GREEN}✅ Deployment complete!${NC}"
    echo ""
}

# Function to show status
show_status() {
    source .env
    WORKER_NAME="mcp-remote-worker-${WORKER_NUMBER:-1}"
    
    echo "📊 Worker Status"
    echo ""
    
    if docker ps --filter "name=$WORKER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}" | grep -q "$WORKER_NAME"; then
        docker ps --filter "name=$WORKER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"
        echo ""
        echo "Recent logs:"
        docker logs --tail=10 "$WORKER_NAME" 2>&1
    else
        echo -e "${YELLOW}⚠️  Worker not running${NC}"
    fi
}

# Main menu
case "${1:-deploy}" in
    setup)
        echo "📝 Setting up environment..."
        if [ ! -f ".env" ]; then
            cp env.template .env
            echo -e "${GREEN}✅ Created .env from template${NC}"
            echo ""
            echo "Next steps:"
            echo "1. Edit .env file with your manager server details"
            echo "2. Run: ./deploy-remote.sh test"
            echo "3. Run: ./deploy-remote.sh deploy"
        else
            echo ".env already exists"
        fi
        ;;
        
    test)
        check_env_file
        validate_env
        test_connectivity
        ;;
        
    deploy)
        check_env_file
        validate_env
        test_connectivity
        deploy_worker
        show_status
        ;;
        
    status)
        check_env_file
        show_status
        ;;
        
    logs)
        check_env_file
        source .env
        WORKER_NAME="mcp-remote-worker-${WORKER_NUMBER:-1}"
        docker logs -f "$WORKER_NAME"
        ;;
        
    stop)
        check_env_file
        echo "Stopping worker..."
        docker compose -f docker-compose.remote.yml down
        echo -e "${GREEN}✅ Worker stopped${NC}"
        ;;
        
    restart)
        check_env_file
        echo "Restarting worker..."
        docker compose -f docker-compose.remote.yml restart
        echo -e "${GREEN}✅ Worker restarted${NC}"
        ;;
        
    scale)
        check_env_file
        COUNT=${2:-3}
        echo "Scaling to $COUNT workers..."
        for i in $(seq 1 $COUNT); do
            WORKER_NUMBER=$i docker compose -f docker-compose.remote.yml up -d
        done
        echo -e "${GREEN}✅ Scaled to $COUNT workers${NC}"
        docker ps --filter "label=com.docker.compose.project" --format "table {{.Names}}\t{{.Status}}"
        ;;
        
    *)
        echo "Usage: $0 {setup|test|deploy|status|logs|stop|restart|scale}"
        echo ""
        echo "Commands:"
        echo "  setup    - Create .env file from template"
        echo "  test     - Test connectivity to manager services"
        echo "  deploy   - Build and deploy the worker"
        echo "  status   - Show worker status"
        echo "  logs     - Follow worker logs"
        echo "  stop     - Stop the worker"
        echo "  restart  - Restart the worker"
        echo "  scale N  - Scale to N workers"
        echo ""
        echo "Quick start:"
        echo "  1. ./deploy-remote.sh setup"
        echo "  2. Edit .env with your manager IP"
        echo "  3. ./deploy-remote.sh deploy"
        ;;
esac
