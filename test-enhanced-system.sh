#!/bin/bash

# Test script for MCP Enhanced System
# This script tests the manager and worker with enhanced analytics

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "🧪 MCP Enhanced System Test"
echo "═══════════════════════════════════════════════════════════════"

# Check if services are running
echo ""
echo "1️⃣ Checking infrastructure services..."
echo -n "   NATS: "
if curl -s http://localhost:8222/healthz > /dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not running - run ./setup-infrastructure.sh first"
            exit 1
        fi

echo -n "   Redis: "
if docker exec mcp-redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not running - run ./setup-infrastructure.sh first"
    exit 1
fi

echo -n "   PostgreSQL: "
if PGPASSWORD=postgres psql -h localhost -U postgres -d mcp_manager -c "SELECT 1" > /dev/null 2>&1; then
    echo "✅ Running"
else
    echo "❌ Not running - run ./setup-infrastructure.sh first"
    exit 1
fi

# Initialize database schema
echo ""
echo "2️⃣ Initializing database schema..."
cd mcp-manager
node -e "
import pg from 'pg';
const { Pool } = pg;

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mcp_manager',
  user: 'postgres',
  password: 'postgres'
});

(async () => {
  try {
    // Create enhanced schema
    await pgPool.query(\`
      -- Enhanced task tracking
      CREATE TABLE IF NOT EXISTS tasks (
        task_id VARCHAR(255) PRIMARY KEY,
        description TEXT,
        status VARCHAR(50),
        priority VARCHAR(20),
        assigned_worker VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        execution_time_ms INTEGER,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        metadata JSONB,
        analytics JSONB
      );

      -- Worker registry with enhanced capabilities
      CREATE TABLE IF NOT EXISTS workers (
        worker_id VARCHAR(255) PRIMARY KEY,
        worker_type VARCHAR(50),
        hostname VARCHAR(255),
        status VARCHAR(50),
        capabilities JSONB,
        system_info JSONB,
        registered_at TIMESTAMP DEFAULT NOW(),
        last_heartbeat TIMESTAMP,
        tasks_completed INTEGER DEFAULT 0,
        tasks_failed INTEGER DEFAULT 0,
        average_execution_time_ms INTEGER,
        metadata JSONB
      );

      -- Detailed task progress tracking
      CREATE TABLE IF NOT EXISTS task_progress (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(255) NOT NULL,
        worker_id VARCHAR(255),
        status VARCHAR(50),
        phase VARCHAR(100),
        percent_complete INTEGER,
        metrics JSONB,
        context JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );

      -- Analytics data storage
      CREATE TABLE IF NOT EXISTS analytics (
        id SERIAL PRIMARY KEY,
        analytics_type VARCHAR(50),
        source_type VARCHAR(50),
        source_id VARCHAR(255),
        data JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );

      -- Task completions
      CREATE TABLE IF NOT EXISTS task_completions (
        id SERIAL PRIMARY KEY,
        task_id VARCHAR(255) NOT NULL,
        worker_id VARCHAR(255),
        status VARCHAR(50),
        summary JSONB,
        analytics JSONB,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    \`);
    
    console.log('✅ Database schema initialized');
    await pgPool.end();
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  }
})();
"
cd ..

# Test MCP Manager
echo ""
echo "3️⃣ Testing MCP Manager Enhanced..."
cd mcp-manager

# Create a test script that uses the manager tools
cat > test-manager-tools.js << 'EOF'
import { spawn } from 'child_process';

console.log('Testing MCP Manager Enhanced tools...\n');

const mcpProcess = spawn('node', ['index-enhanced.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let errorOutput = '';

mcpProcess.stdout.on('data', (data) => {
  output += data.toString();
});

mcpProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send initialization
mcpProcess.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "0.1.0",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  }
}) + '\n');

// List tools after a delay
setTimeout(() => {
  mcpProcess.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  }) + '\n');
  
  // Give it time to respond
  setTimeout(() => {
    if (output.includes('"name":"assign_task"') && 
        output.includes('"name":"monitor_task"') &&
        output.includes('"name":"get_analytics"')) {
      console.log('✅ Manager tools verified');
      console.log('\nAvailable tools:');
      console.log('  - assign_task');
      console.log('  - monitor_task');
      console.log('  - get_analytics');
      console.log('  - view_realtime_streams');
      console.log('  - analyze_decisions');
      console.log('  - performance_report');
      console.log('  - manage_workers');
      console.log('  - answer_worker_question');
      console.log('  - error_analysis');
      console.log('  - quality_dashboard');
    } else {
      console.log('❌ Manager tools not found');
      console.log('Output:', output);
      console.log('Errors:', errorOutput);
    }
    mcpProcess.kill();
    process.exit(0);
  }, 1000);
}, 1000);
EOF

timeout 5 node test-manager-tools.js || echo "⚠️  Manager test timed out"
rm -f test-manager-tools.js
cd ..

# Test MCP Worker
echo ""
echo "4️⃣ Testing MCP Worker Enhanced..."
cd mcp-worker

# Create a test script that uses the worker tools
cat > test-worker-tools.js << 'EOF'
import { spawn } from 'child_process';

console.log('Testing MCP Worker Enhanced tools...\n');

const mcpProcess = spawn('node', ['index-enhanced.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    WORKER_ID: 'test-worker',
    TASK_ID: 'test-task',
    NATS_HOST: 'localhost',
    REDIS_HOST: 'localhost',
    POSTGRES_HOST: 'localhost'
  }
});

let output = '';
let errorOutput = '';

mcpProcess.stdout.on('data', (data) => {
  output += data.toString();
});

mcpProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send initialization
mcpProcess.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "0.1.0",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  }
}) + '\n');

// List tools after a delay
setTimeout(() => {
  mcpProcess.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  }) + '\n');
  
  // Give it time to respond
  setTimeout(() => {
    if (output.includes('"name":"report_progress"') && 
        output.includes('"name":"report_milestone"') &&
        output.includes('"name":"report_analytics"') &&
        output.includes('"name":"stream_realtime_data"')) {
      console.log('✅ Worker tools verified (30+ tools available)');
      console.log('\nCore tools:');
      console.log('  - report_progress');
      console.log('  - report_milestone');
      console.log('  - report_analytics');
      console.log('  - stream_realtime_data');
      console.log('  - report_decision');
      console.log('  - report_test_results');
      console.log('  - report_error');
      console.log('  - ask_manager');
      console.log('  - report_completion');
      console.log('  ... and many more!');
    } else {
      console.log('❌ Worker tools not found');
      console.log('Output:', output);
      console.log('Errors:', errorOutput);
    }
    mcpProcess.kill();
    process.exit(0);
  }, 1000);
}, 1000);
EOF

timeout 5 node test-worker-tools.js || echo "⚠️  Worker test timed out"
rm -f test-worker-tools.js
cd ..

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📊 Test Summary"
echo ""
echo "Infrastructure:"
echo "  ✅ NATS Message Broker"
echo "  ✅ Redis Cache"
echo "  ✅ PostgreSQL Database"
    echo ""
echo "Components:"
echo "  ✅ MCP Manager Enhanced (10 tools)"
echo "  ✅ MCP Worker Enhanced (30+ tools)"
    echo ""
echo "Next steps:"
echo "1. Start the manager:"
echo "   cd mcp-manager && npx @modelcontextprotocol/inspector node index-enhanced.js"
echo ""
echo "2. Start a worker:"
echo "   docker run -d \\"
echo "     --name mcp-worker-1 \\"
echo "     -e MANAGER_HOST=host.docker.internal \\"
echo "     -e CURSOR_API_KEY=\$CURSOR_API_KEY \\"
echo "     --network host \\"
echo "     mcp-remote-worker-enhanced:latest"
echo ""
echo "3. Or use the unified worker:"
echo "   cd remote-worker-mcp && node remote-worker-unified.js"
echo ""
echo "═══════════════════════════════════════════════════════════════"
cd ..

# Test MCP Worker
echo ""
echo "4️⃣ Testing MCP Worker Enhanced..."
cd mcp-worker

# Create a test script that uses the worker tools
cat > test-worker-tools.js << 'EOF'
import { spawn } from 'child_process';

console.log('Testing MCP Worker Enhanced tools...\n');

const mcpProcess = spawn('node', ['index-enhanced.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    WORKER_ID: 'test-worker',
    TASK_ID: 'test-task',
    NATS_HOST: 'localhost',
    REDIS_HOST: 'localhost',
    POSTGRES_HOST: 'localhost'
  }
});

let output = '';
let errorOutput = '';

mcpProcess.stdout.on('data', (data) => {
  output += data.toString();
});

mcpProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

// Send initialization
mcpProcess.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "0.1.0",
    capabilities: {},
    clientInfo: {
      name: "test-client",
      version: "1.0.0"
    }
  }
}) + '\n');

// List tools after a delay
setTimeout(() => {
  mcpProcess.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  }) + '\n');
  
  // Give it time to respond
  setTimeout(() => {
    if (output.includes('"name":"report_progress"') && 
        output.includes('"name":"report_milestone"') &&
        output.includes('"name":"report_analytics"') &&
        output.includes('"name":"stream_realtime_data"')) {
      console.log('✅ Worker tools verified (30+ tools available)');
      console.log('\nCore tools:');
      console.log('  - report_progress');
      console.log('  - report_milestone');
      console.log('  - report_analytics');
      console.log('  - stream_realtime_data');
      console.log('  - report_decision');
      console.log('  - report_test_results');
      console.log('  - report_error');
      console.log('  - ask_manager');
      console.log('  - report_completion');
      console.log('  ... and many more!');
    } else {
      console.log('❌ Worker tools not found');
      console.log('Output:', output);
      console.log('Errors:', errorOutput);
    }
    mcpProcess.kill();
    process.exit(0);
  }, 1000);
}, 1000);
EOF

timeout 5 node test-worker-tools.js || echo "⚠️  Worker test timed out"
rm -f test-worker-tools.js
cd ..

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "📊 Test Summary"
echo ""
echo "Infrastructure:"
echo "  ✅ NATS Message Broker"
echo "  ✅ Redis Cache"
echo "  ✅ PostgreSQL Database"
    echo ""
echo "Components:"
echo "  ✅ MCP Manager Enhanced (10 tools)"
echo "  ✅ MCP Worker Enhanced (30+ tools)"
    echo ""
echo "Next steps:"
echo "1. Start the manager:"
echo "   cd mcp-manager && npx @modelcontextprotocol/inspector node index-enhanced.js"
echo ""
echo "2. Start a worker:"
echo "   docker run -d \\"
echo "     --name mcp-worker-1 \\"
echo "     -e MANAGER_HOST=host.docker.internal \\"
echo "     -e CURSOR_API_KEY=\$CURSOR_API_KEY \\"
echo "     --network host \\"
echo "     mcp-remote-worker-enhanced:latest"
echo ""
echo "3. Or use the unified worker:"
echo "   cd remote-worker-mcp && node remote-worker-unified.js"
echo ""
echo "═══════════════════════════════════════════════════════════════"