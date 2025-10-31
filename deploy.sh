#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}     MCP MANAGER AND REMOTE WORKER - FULL DEPLOYMENT${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

# Check if running as root (recommended for Docker)
if [ "$EUID" -ne 0 ] && [ ! -f /.dockerenv ]; then 
  echo -e "${YELLOW}Warning: Not running as root. You may need sudo for Docker commands.${NC}"
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for service
wait_for_service() {
    local host=$1
    local port=$2
    local service=$3
    local max_attempts=30
    local attempt=1
    
    echo -e "${YELLOW}Waiting for $service at $host:$port...${NC}"
    while ! nc -z $host $port >/dev/null 2>&1; do
        if [ $attempt -ge $max_attempts ]; then
            echo -e "${RED}✗ $service failed to start after $max_attempts attempts${NC}"
            return 1
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done
    echo -e "\n${GREEN}✓ $service is ready${NC}"
    return 0
}

# Check prerequisites
echo -e "\n${BLUE}Checking prerequisites...${NC}"

if ! command_exists docker; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is installed${NC}"

if command_exists $DOCKER_COMPOSE; then
    DOCKER_COMPOSE="$DOCKER_COMPOSE"
    echo -e "${GREEN}✓ Docker Compose v1 is installed${NC}"
elif docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
    echo -e "${GREEN}✓ Docker Compose v2 is installed${NC}"
else
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file from template...${NC}"
    if [ -f "env.example" ]; then
        cp env.example .env
        echo -e "${YELLOW}⚠️  Please edit .env and add your CURSOR_API_KEY${NC}"
        echo -e "${YELLOW}   Then run this script again.${NC}"
        exit 1
    else
        echo -e "${RED}✗ env.example not found${NC}"
        exit 1
    fi
fi

# Check if CURSOR_API_KEY is set
source .env
if [ -z "$CURSOR_API_KEY" ] || [ "$CURSOR_API_KEY" = "your_cursor_api_key_here" ]; then
    echo -e "${RED}✗ CURSOR_API_KEY not set in .env file${NC}"
    echo -e "${YELLOW}  Please edit .env and add your API key${NC}"
    exit 1
fi
echo -e "${GREEN}✓ CURSOR_API_KEY is configured${NC}"

# Parse command line arguments
COMMAND=${1:-"up"}
SCALE_WORKERS=${2:-1}

case $COMMAND in
    "up"|"start")
        echo -e "\n${BLUE}Starting MCP system...${NC}"
        
        # Stop any existing containers
        echo -e "${YELLOW}Stopping existing containers...${NC}"
        $DOCKER_COMPOSE down --remove-orphans >/dev/null 2>&1 || true
        
        # Build images
        echo -e "\n${BLUE}Building Docker images...${NC}"
        $DOCKER_COMPOSE build --quiet
        
        # Start infrastructure services first
        echo -e "\n${BLUE}Starting infrastructure services...${NC}"
        $DOCKER_COMPOSE up -d nats redis postgres
        
        # Wait for services to be ready
        wait_for_service localhost 4222 "NATS" || exit 1
        wait_for_service localhost 6379 "Redis" || exit 1
        wait_for_service localhost 5432 "PostgreSQL" || exit 1
        
        # Initialize database schema
        echo -e "\n${BLUE}Initializing database schema...${NC}"
        sleep 2  # Give PostgreSQL a moment to fully initialize
        
        # Create complete schema
        $DOCKER_COMPOSE exec -T postgres psql -U postgres -d mcp_manager <<EOF
-- Workers table (main)
CREATE TABLE IF NOT EXISTS workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255) UNIQUE NOT NULL,
    worker_name VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    total_execution_time_ms INTEGER,
    startup_time_ms INTEGER,
    processing_time_ms INTEGER,
    peak_memory_mb FLOAT,
    cpu_seconds FLOAT,
    last_progress_percent INTEGER DEFAULT 0,
    last_operation VARCHAR(1000),
    result TEXT,
    error_message TEXT,
    error_stack TEXT,
    metadata JSONB,
    environment JSONB,
    mcp_tools_available TEXT[],
    session_id VARCHAR(255)
);

-- Task updates table
CREATE TABLE IF NOT EXISTS task_updates (
    update_id SERIAL PRIMARY KEY,
    worker_id VARCHAR(255),
    task_id VARCHAR(255),
    timestamp TIMESTAMP DEFAULT NOW(),
    status VARCHAR(50),
    progress_percent INTEGER,
    operation VARCHAR(1000),
    details JSONB,
    session_id VARCHAR(255),
    FOREIGN KEY (worker_id) REFERENCES workers(worker_id)
);

-- Remote workers table
CREATE TABLE IF NOT EXISTS remote_workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    hostname VARCHAR(255),
    ip_address VARCHAR(45),
    status VARCHAR(50) DEFAULT 'registering',
    capabilities JSONB,
    active_tasks INTEGER DEFAULT 0,
    total_tasks_completed INTEGER DEFAULT 0,
    total_execution_time_ms BIGINT DEFAULT 0,
    last_heartbeat TIMESTAMP DEFAULT NOW(),
    registered_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB,
    environment JSONB
);

-- Docker task analytics table
CREATE TABLE IF NOT EXISTS docker_task_analytics (
    task_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'assigned',
    assigned_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    result JSONB,
    error TEXT,
    execution_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (worker_id) REFERENCES remote_workers(worker_id)
);

-- Real-time analytics table
CREATE TABLE IF NOT EXISTS realtime_analytics (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255),
    worker_id VARCHAR(255),
    timestamp TIMESTAMP DEFAULT NOW(),
    event_type VARCHAR(100),
    event_data JSONB,
    FOREIGN KEY (task_id) REFERENCES docker_task_analytics(task_id),
    FOREIGN KEY (worker_id) REFERENCES remote_workers(worker_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_workers_created_at ON workers(created_at);
CREATE INDEX IF NOT EXISTS idx_task_updates_worker_id ON task_updates(worker_id);
CREATE INDEX IF NOT EXISTS idx_task_updates_timestamp ON task_updates(timestamp);
CREATE INDEX IF NOT EXISTS idx_remote_workers_status ON remote_workers(status);
CREATE INDEX IF NOT EXISTS idx_remote_workers_last_heartbeat ON remote_workers(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_docker_task_analytics_status ON docker_task_analytics(status);
CREATE INDEX IF NOT EXISTS idx_docker_task_analytics_worker_id ON docker_task_analytics(worker_id);
CREATE INDEX IF NOT EXISTS idx_realtime_analytics_task_id ON realtime_analytics(task_id);
CREATE INDEX IF NOT EXISTS idx_realtime_analytics_timestamp ON realtime_analytics(timestamp);

-- Archived tasks table
CREATE TABLE IF NOT EXISTS archived_tasks (
    task_id UUID PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL,
    progress_history JSONB,
    metadata JSONB,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archived_tasks_worker_id ON archived_tasks(worker_id);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_status ON archived_tasks(status);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_created_at ON archived_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_archived_at ON archived_tasks(archived_at);
EOF
        
        echo -e "${GREEN}✓ Database schema initialized${NC}"
        
        # Start workers
        echo -e "\n${BLUE}Starting $SCALE_WORKERS worker(s)...${NC}"
        $DOCKER_COMPOSE up -d --scale worker=$SCALE_WORKERS worker
        
        # Show status
        echo -e "\n${BLUE}System Status:${NC}"
        $DOCKER_COMPOSE ps
        
        # Wait a moment for workers to register
        echo -e "\n${YELLOW}Waiting for workers to register...${NC}"
        sleep 5
        
        # Check worker registration
        echo -e "\n${BLUE}Registered Workers:${NC}"
        $DOCKER_COMPOSE exec postgres psql -U postgres -d mcp_manager -t -c \
            "SELECT worker_id, status, hostname FROM remote_workers ORDER BY registered_at DESC;" || true
        
        echo -e "\n${GREEN}✅ MCP system is running!${NC}"
        echo -e "\n${BLUE}Useful commands:${NC}"
        echo -e "  ${YELLOW}View logs:${NC} $DOCKER_COMPOSE logs -f worker"
        echo -e "  ${YELLOW}Scale workers:${NC} $DOCKER_COMPOSE up -d --scale worker=3"
        echo -e "  ${YELLOW}Check status:${NC} $DOCKER_COMPOSE ps"
        echo -e "  ${YELLOW}Stop system:${NC} ./deploy.sh down"
        ;;
        
    "down"|"stop")
        echo -e "\n${BLUE}Stopping MCP system...${NC}"
        $DOCKER_COMPOSE down
        echo -e "${GREEN}✓ MCP system stopped${NC}"
        ;;
        
    "restart")
        echo -e "\n${BLUE}Restarting MCP system...${NC}"
        $0 down
        sleep 2
        $0 up $SCALE_WORKERS
        ;;
        
    "logs")
        $DOCKER_COMPOSE logs -f ${2:-""}
        ;;
        
    "status")
        echo -e "\n${BLUE}System Status:${NC}"
        $DOCKER_COMPOSE ps
        
        echo -e "\n${BLUE}Worker Status:${NC}"
        $DOCKER_COMPOSE exec postgres psql -U postgres -d mcp_manager -x -c \
            "SELECT worker_id, status, hostname, active_tasks, total_tasks_completed, 
             last_heartbeat, registered_at 
             FROM remote_workers 
             ORDER BY last_heartbeat DESC;" || echo "No workers registered"
        
        echo -e "\n${BLUE}Recent Tasks:${NC}"
        $DOCKER_COMPOSE exec postgres psql -U postgres -d mcp_manager -x -c \
            "SELECT task_id, worker_id, status, assigned_at, completed_at 
             FROM docker_task_analytics 
             ORDER BY assigned_at DESC 
             LIMIT 5;" || echo "No tasks found"
        ;;
        
    "clean")
        echo -e "\n${BLUE}Cleaning up MCP system...${NC}"
        $DOCKER_COMPOSE down -v --remove-orphans
        echo -e "${GREEN}✓ System cleaned${NC}"
        ;;
        
    "test")
        echo -e "\n${BLUE}Running system test...${NC}"
        
        # Check if system is running
        if ! $DOCKER_COMPOSE ps | grep -q "Up"; then
            echo -e "${RED}✗ System is not running. Start it first with: ./deploy.sh up${NC}"
            exit 1
        fi
        
        echo -e "${GREEN}✓ System is running${NC}"
        
        # Test NATS
        echo -e "\n${YELLOW}Testing NATS connection...${NC}"
        $DOCKER_COMPOSE exec nats nc -zv localhost 4222 && echo -e "${GREEN}✓ NATS is accessible${NC}"
        
        # Test Redis
        echo -e "\n${YELLOW}Testing Redis connection...${NC}"
        $DOCKER_COMPOSE exec redis redis-cli ping | grep -q PONG && echo -e "${GREEN}✓ Redis is responding${NC}"
        
        # Test PostgreSQL
        echo -e "\n${YELLOW}Testing PostgreSQL connection...${NC}"
        $DOCKER_COMPOSE exec postgres pg_isready -U postgres && echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
        
        # Check workers
        echo -e "\n${YELLOW}Checking registered workers...${NC}"
        WORKER_COUNT=$($DOCKER_COMPOSE exec postgres psql -U postgres -d mcp_manager -t -c \
            "SELECT COUNT(*) FROM remote_workers WHERE status != 'offline';" | tr -d ' ')
        echo -e "${GREEN}✓ Found $WORKER_COUNT active worker(s)${NC}"
        
        echo -e "\n${GREEN}✅ All tests passed!${NC}"
        ;;
        
    *)
        echo "Usage: $0 {up|down|restart|logs|status|clean|test} [scale_workers]"
        echo ""
        echo "Commands:"
        echo "  up [n]     - Start the system with n workers (default: 1)"
        echo "  down       - Stop the system"
        echo "  restart    - Restart the system"
        echo "  logs       - View logs (optionally specify service)"
        echo "  status     - Show system status"
        echo "  clean      - Clean up all containers and volumes"
        echo "  test       - Run system tests"
        echo ""
        echo "Examples:"
        echo "  $0 up 3          # Start with 3 workers"
        echo "  $0 logs worker   # View worker logs"
        exit 1
        ;;
esac
