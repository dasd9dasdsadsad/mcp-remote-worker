#!/bin/bash

# Demo script for MCP Enhanced System
# This demonstrates the full workflow with analytics

echo "═══════════════════════════════════════════════════════════════"
echo "🎭 MCP Enhanced System Demo"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "This demo will:"
echo "1. Start the enhanced manager"
echo "2. Create a sample task"
echo "3. Monitor task progress"
echo "4. View analytics"
echo ""
echo "Press Enter to continue..."
read

# Check services
echo "Checking services..."
if ! curl -s http://localhost:8222/healthz > /dev/null 2>&1; then
    echo "❌ NATS not running - run ./setup-infrastructure.sh first"
    exit 1
fi

# Create demo script
cat > /tmp/demo-manager.js << 'EOF'
import { spawn } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🎯 MCP Manager Enhanced Demo\n');

const manager = spawn('node', ['mcp-manager/index-enhanced.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let requestId = 1;

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params
  };
  manager.stdin.write(JSON.stringify(request) + '\n');
}

function callTool(name, args) {
  sendRequest('tools/call', {
    name,
    arguments: args
  });
}

// Handle responses
manager.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      if (response.result?.content) {
        console.log('\n📨 Response:', response.result.content[0].text);
      }
    }
  } catch (e) {
    // Ignore parsing errors for non-JSON output
  }
});

// Initialize
console.log('Initializing manager...');
sendRequest('initialize', {
  protocolVersion: "0.1.0",
  capabilities: {},
  clientInfo: {
    name: "demo-client",
    version: "1.0.0"
  }
});

setTimeout(async () => {
  // Demo sequence
  console.log('\n1️⃣ Creating a demo task...');
  callTool('assign_task', {
    description: "Analyze code quality and generate comprehensive report",
    priority: "high",
    requirements: {
      analysis_types: ["complexity", "coverage", "security"],
      output_format: "markdown",
      include_recommendations: true
    },
    estimated_duration_ms: 300000
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n2️⃣ Listing active workers...');
  callTool('manage_workers', {
    action: "list"
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n3️⃣ Getting system analytics...');
  callTool('get_analytics', {
    entity_type: "system",
    analytics_type: "all",
    time_range: "hour"
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n4️⃣ Checking performance report...');
  callTool('performance_report', {
    report_type: "system",
    metrics: ["throughput", "latency", "resource_usage"]
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('\n✅ Demo complete!');
  console.log('\nThe manager is still running. You can:');
  console.log('- Start a worker to process the task');
  console.log('- Monitor progress with monitor_task');
  console.log('- View real-time streams');
  console.log('\nPress Ctrl+C to exit.');
  
}, 1000);

// Keep process alive
process.stdin.resume();
EOF

# Run the demo
cd /root/mcp-setup
node /tmp/demo-manager.js

# Cleanup
rm -f /tmp/demo-manager.js


# Demo script for MCP Enhanced System
# This demonstrates the full workflow with analytics

echo "═══════════════════════════════════════════════════════════════"
echo "🎭 MCP Enhanced System Demo"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "This demo will:"
echo "1. Start the enhanced manager"
echo "2. Create a sample task"
echo "3. Monitor task progress"
echo "4. View analytics"
echo ""
echo "Press Enter to continue..."
read

# Check services
echo "Checking services..."
if ! curl -s http://localhost:8222/healthz > /dev/null 2>&1; then
    echo "❌ NATS not running - run ./setup-infrastructure.sh first"
    exit 1
fi

# Create demo script
cat > /tmp/demo-manager.js << 'EOF'
import { spawn } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🎯 MCP Manager Enhanced Demo\n');

const manager = spawn('node', ['mcp-manager/index-enhanced.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let requestId = 1;

function sendRequest(method, params = {}) {
  const request = {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params
  };
  manager.stdin.write(JSON.stringify(request) + '\n');
}

function callTool(name, args) {
  sendRequest('tools/call', {
    name,
    arguments: args
  });
}

// Handle responses
manager.stdout.on('data', (data) => {
  try {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      const response = JSON.parse(line);
      if (response.result?.content) {
        console.log('\n📨 Response:', response.result.content[0].text);
      }
    }
  } catch (e) {
    // Ignore parsing errors for non-JSON output
  }
});

// Initialize
console.log('Initializing manager...');
sendRequest('initialize', {
  protocolVersion: "0.1.0",
  capabilities: {},
  clientInfo: {
    name: "demo-client",
    version: "1.0.0"
  }
});

setTimeout(async () => {
  // Demo sequence
  console.log('\n1️⃣ Creating a demo task...');
  callTool('assign_task', {
    description: "Analyze code quality and generate comprehensive report",
    priority: "high",
    requirements: {
      analysis_types: ["complexity", "coverage", "security"],
      output_format: "markdown",
      include_recommendations: true
    },
    estimated_duration_ms: 300000
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n2️⃣ Listing active workers...');
  callTool('manage_workers', {
    action: "list"
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n3️⃣ Getting system analytics...');
  callTool('get_analytics', {
    entity_type: "system",
    analytics_type: "all",
    time_range: "hour"
  });

  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('\n4️⃣ Checking performance report...');
  callTool('performance_report', {
    report_type: "system",
    metrics: ["throughput", "latency", "resource_usage"]
  });

  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('\n✅ Demo complete!');
  console.log('\nThe manager is still running. You can:');
  console.log('- Start a worker to process the task');
  console.log('- Monitor progress with monitor_task');
  console.log('- View real-time streams');
  console.log('\nPress Ctrl+C to exit.');
  
}, 1000);

// Keep process alive
process.stdin.resume();
EOF

# Run the demo
cd /root/mcp-setup
node /tmp/demo-manager.js

# Cleanup
rm -f /tmp/demo-manager.js

