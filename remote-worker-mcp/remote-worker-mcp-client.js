#!/usr/bin/env node
/**
 * MCP-Enabled Remote Worker Client
 * 
 * This enhanced worker runs MCP servers inside the Docker container,
 * allowing it to use MCP tools for dynamic reporting and task execution.
 */

import { spawn } from 'child_process';
import { connect, StringCodec } from 'nats';
import { createClient } from 'redis';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const sc = StringCodec();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════

const CONFIG = {
  // Worker identity
  workerId: process.env.WORKER_ID || `mcp-worker-${os.hostname()}-${uuidv4().substring(0, 8)}`,
  hostname: process.env.HOSTNAME || os.hostname(),
  
  // Concurrency settings
  maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '5'),
  
  // Manager connection
  managerHost: process.env.MANAGER_HOST || 'localhost',
  
  // NATS configuration
  nats: {
    host: process.env.NATS_HOST || process.env.MANAGER_HOST || 'localhost',
    port: parseInt(process.env.NATS_PORT || '4222'),
  },
  
  // Redis configuration  
  redis: {
    host: process.env.REDIS_HOST || process.env.MANAGER_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',
  },
  
  // PostgreSQL configuration
  postgres: {
    host: process.env.POSTGRES_HOST || process.env.MANAGER_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'mcp_manager',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  
  // Cursor API configuration
  cursorApiKey: process.env.CURSOR_API_KEY || '',
  
  // Worker capabilities
  capabilities: {
    maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '5'),
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || '4096'),
    tags: (process.env.WORKER_TAGS || 'mcp,docker,remote,enhanced').split(','),
    mcpEnabled: true,
    mcpServers: ['mcp-worker', 'domlogger-unified'],
  },
  
  // Health check
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000'),
};

console.error('═══════════════════════════════════════════════════════════════');
console.error('🌐 MCP-ENABLED REMOTE WORKER CLIENT');
console.error('═══════════════════════════════════════════════════════════════');
console.error(`Worker ID: ${CONFIG.workerId}`);
console.error(`Hostname: ${CONFIG.hostname}`);
console.error(`Manager: ${CONFIG.managerHost}`);
console.error(`MCP Servers: ${CONFIG.capabilities.mcpServers.join(', ')}`);
console.error('═══════════════════════════════════════════════════════════════');

// ══════════════════════════════════════════════════════════════════
// INFRASTRUCTURE CONNECTIONS
// ══════════════════════════════════════════════════════════════════

let natsConnection;
let redis;
let pgPool;
const activeTasks = new Map(); // taskId -> { process, startTime, taskData }
let taskCounter = 0;
const mcpProcesses = new Map();

// Connect to NATS
async function connectNATS() {
  try {
    const natsUrl = `nats://${CONFIG.nats.host}:${CONFIG.nats.port}`;
    console.error(`Connecting to NATS at ${natsUrl}...`);
    
    natsConnection = await connect({
      servers: [natsUrl],
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    });
    
    console.error('✅ Connected to NATS');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to NATS:', error.message);
    return false;
  }
}

// Connect to Redis
async function connectRedis() {
  try {
    console.error(`Connecting to Redis at ${CONFIG.redis.host}:${CONFIG.redis.port}...`);
    
    redis = createClient({
      socket: {
        host: CONFIG.redis.host,
        port: CONFIG.redis.port,
      },
      password: CONFIG.redis.password || undefined,
    });
    
    await redis.connect();
    console.error('✅ Connected to Redis');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error.message);
    return false;
  }
}

// Connect to PostgreSQL
async function connectPostgreSQL() {
  try {
    console.error(`Connecting to PostgreSQL at ${CONFIG.postgres.host}:${CONFIG.postgres.port}...`);
    
    pgPool = new Pool(CONFIG.postgres);
    const client = await pgPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    console.error('✅ Connected to PostgreSQL');
    return true;
  } catch (error) {
    console.error('⚠️  WARNING: Failed to connect to PostgreSQL:', error.message);
    console.error('   Worker will continue with limited functionality (no persistent storage)');
    pgPool = null; // Set to null so we can check before using
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════
// MCP SERVER MANAGEMENT
// ══════════════════════════════════════════════════════════════════

/**
 * Start MCP servers inside the container
 */
async function startMCPServers() {
  console.error('');
  console.error('🚀 Starting MCP servers...');
  
  // Create MCP configuration for the worker
  const mcpConfig = {
    mcpServers: {
      "mcp-worker": {
        command: "node",
        args: ["/app/mcp-worker/index-interactive.js"],
        env: {
          WORKER_ID: CONFIG.workerId,
          SESSION_ID: `session-${uuidv4()}`,
          NATS_HOST: CONFIG.nats.host,
          REDIS_HOST: CONFIG.redis.host,
          POSTGRES_HOST: CONFIG.postgres.host,
        },
      },
      "domlogger-unified": {
        command: "node", 
        args: ["/app/domlogger/server.js"],
        autoRun: true,
      }
    }
  };
  
  // Write MCP config for this worker
  const mcpConfigPath = '/tmp/worker-mcp.json';
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  
  // Start each MCP server
  for (const [name, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
    try {
      console.error(`  Starting ${name}...`);
      
      const mcpProcess = spawn(serverConfig.command, serverConfig.args, {
        env: {
          ...process.env,
          ...serverConfig.env,
            // Override with actual connection details
            NATS_HOST: CONFIG.nats.host,
          REDIS_HOST: CONFIG.redis.host,
          POSTGRES_HOST: CONFIG.postgres.host,
          POSTGRES_PORT: CONFIG.postgres.port.toString(),
          POSTGRES_USER: CONFIG.postgres.user,
          POSTGRES_PASSWORD: CONFIG.postgres.password,
          POSTGRES_DB: CONFIG.postgres.database,
          CURSOR_API_KEY: CONFIG.cursorApiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      mcpProcess.stdout.on('data', (data) => {
        console.log(`[${name}] ${data.toString().trim()}`);
      });
      
      mcpProcess.stderr.on('data', (data) => {
        console.error(`[${name}] ${data.toString().trim()}`);
      });
      
      mcpProcess.on('error', (error) => {
        console.error(`[${name}] Process error:`, error);
      });
      
      mcpProcess.on('exit', (code, signal) => {
        console.error(`[${name}] Process exited with code ${code}, signal ${signal}`);
        mcpProcesses.delete(name);
      });
      
      mcpProcesses.set(name, mcpProcess);
      console.error(`  ✅ ${name} started`);
      
    } catch (error) {
      console.error(`  ❌ Failed to start ${name}:`, error.message);
    }
  }
  
  console.error('');
}

// ══════════════════════════════════════════════════════════════════
// WORKER REGISTRATION
// ══════════════════════════════════════════════════════════════════

async function registerWorker() {
  try {
    console.error('📝 Registering MCP-enabled worker with manager...');
    
    // Skip PostgreSQL registration if not connected
    if (!pgPool) {
      console.error('   Skipping PostgreSQL registration (not connected)');
    }
    
    const workerInfo = {
      hostname: CONFIG.hostname,
      manager_host: CONFIG.managerHost,
      capabilities: CONFIG.capabilities,
      system_info: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        nodeVersion: process.version,
      },
      mcp_enabled: true,
      mcp_servers: CONFIG.capabilities.mcpServers,
    };
    
    // Register in PostgreSQL if connected
    if (pgPool) {
      const response = await pgPool.query(
        `INSERT INTO remote_workers (worker_id, hostname, manager_host, capabilities, system_info, registered_at, last_heartbeat, status, metadata)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7)
         ON CONFLICT (worker_id) DO UPDATE SET
           hostname = EXCLUDED.hostname,
           manager_host = EXCLUDED.manager_host,
           capabilities = EXCLUDED.capabilities,
           system_info = EXCLUDED.system_info,
           last_heartbeat = NOW(),
           status = EXCLUDED.status,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
         RETURNING *`,
        [
          CONFIG.workerId,
          CONFIG.hostname,
          CONFIG.managerHost,
          JSON.stringify(workerInfo.capabilities),
          JSON.stringify(workerInfo.system_info),
          'idle',
          JSON.stringify({ mcp_enabled: true, mcp_servers: CONFIG.capabilities.mcpServers }),
        ]
      );
      
      console.error("✅ MCP Worker registered in PostgreSQL");
      console.error(`   Worker ID: ${response.rows[0].worker_id}`);
      console.error(`   MCP Enabled: ${response.rows[0].metadata?.mcp_enabled}`);
    }
    
    // Also update Redis
    await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify({
      worker_id: CONFIG.workerId,
      hostname: CONFIG.hostname,
      status: 'idle',
      last_heartbeat: new Date().toISOString(),
      tags: CONFIG.capabilities.tags,
      system_info: workerInfo.system_info,
      mcp_enabled: true,
      mcp_servers: CONFIG.capabilities.mcpServers,
    }));
    
    await redis.sAdd('remote_workers:active', CONFIG.workerId);
    
    console.error("✅ MCP Worker registered successfully");
    console.error(`   Worker ID: ${CONFIG.workerId}`);
    console.error(`   Status: Ready (NATS + Redis${pgPool ? ' + PostgreSQL' : ''})`);
    
  } catch (error) {
    console.error("❌ Failed to register worker:", error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// REAL-TIME PROGRESS REPORTING
// ══════════════════════════════════════════════════════════════════

async function reportTaskProgress(taskId, status, percentComplete, currentOperation, analyticsData = {}) {
  try {
    const progressReport = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      status: status,
      percent_complete: percentComplete,
      current_operation: currentOperation,
      analytics: {
        elapsed_time_ms: Date.now() - (activeTasks.get(taskId)?.started_at ? new Date(activeTasks.get(taskId).started_at).getTime() : Date.now()),
        memory_usage_mb: Math.floor((os.totalmem() - os.freemem()) / 1024 / 1024),
        cpu_load: os.loadavg()[0],
        active_tasks_count: activeTasks.size,
        ...analyticsData
      }
    };
    
    // Publish to NATS for real-time streaming
    await natsConnection.publish(
      `task.progress.${taskId}`,
      sc.encode(JSON.stringify(progressReport))
    );
    
    // Also publish to worker-specific channel
    await natsConnection.publish(
      `worker.progress.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(progressReport))
    );
    
    console.error(`📊 Progress Report: ${percentComplete}% - ${currentOperation}`);
    
  } catch (error) {
    console.error('❌ Failed to report progress:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// HEARTBEAT
// ══════════════════════════════════════════════════════════════════

async function sendHeartbeat() {
  try {
    const heartbeat = {
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      status: activeTasks.size > 0 ? 'busy' : 'idle',
      active_tasks: activeTasks.size,
      mcp_servers_running: Array.from(mcpProcesses.keys()),
      system_info: {
        freeMemoryMB: Math.floor(os.freemem() / 1024 / 1024),
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
      },
    };
    
    // Update Redis
    await redis.set(
      `remote_worker:${CONFIG.workerId}`,
      JSON.stringify(heartbeat),
      { EX: 60 }
    );
    
    // Update PostgreSQL if connected
    if (pgPool) {
      await pgPool.query(
        `UPDATE remote_workers 
         SET last_heartbeat = $1, status = $2, updated_at = NOW()
         WHERE worker_id = $3`,
        [new Date(), heartbeat.status, CONFIG.workerId]
      );
    }
    
    // Publish heartbeat to NATS
    natsConnection.publish(
      `worker.heartbeat.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(heartbeat))
    );
    
  } catch (error) {
    console.error('❌ Heartbeat failed:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// TASK EXECUTION WITH MCP
// ══════════════════════════════════════════════════════════════════

async function executeTaskWithMCP(taskData) {
  const taskId = taskData.task_id || uuidv4();
  const taskDescription = taskData.task_description || taskData.description;
  const startTime = Date.now();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 Starting MCP-Enabled Task: ${taskId}`);
  console.log(`   Description: ${taskDescription}`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  // Initialize task tracking with detailed analytics
  const taskAnalytics = {
    task_id: taskId,
    description: taskDescription,
    started_at: new Date().toISOString(),
    status: 'running',
    progress_updates: [],
    tool_calls: [],
    pages_visited: 0,
    screenshots_taken: 0,
    network_requests: 0,
    total_tool_calls: 0
  };
  
  activeTasks.set(taskId, taskAnalytics);
  
  // Report task start with initial analytics
  await reportTaskProgress(taskId, 'started', 0, 'Task initialization complete', {
    worker_id: CONFIG.workerId,
    mcp_servers_available: Array.from(mcpProcesses.keys()),
    start_time: new Date().toISOString(),
    timeout_ms: taskData.timeout_ms || 300000
  });
  
  try {
    // Update status to busy
    await updateWorkerStatus('busy', taskId);
    
    // Create a special MCP task execution script
    const mcpTaskScript = `
import { spawn } from 'child_process';

// Execute task using MCP tools
async function executeMCPTask() {
  const taskDescription = ${JSON.stringify(taskDescription)};
  const taskId = ${JSON.stringify(taskId)};
  
  console.log('Executing task with MCP tools...');
  
  // Use cursor-agent with environment variable for MCP config
  const cursorProcess = spawn('cursor-agent', [
    '--model', 'auto',
    '-p', taskDescription,
    '--approve-mcps',
    '--force'
  ], {
    env: {
      ...process.env,
      CURSOR_API_KEY: '${CONFIG.cursorApiKey}',
      TASK_ID: taskId,
      WORKER_ID: '${CONFIG.workerId}',
    },
    stdio: 'pipe'
  });
  
  // Capture stdout for real-time analytics
  let outputBuffer = '';
  let toolCallCount = 0;
  let pagesVisited = 0;
  let screenshotsTaken = 0;
  
  cursorProcess.stdout.on('data', (data) => {
    const output = data.toString();
    outputBuffer += output;
    process.stdout.write(output);
    
    // Parse for MCP tool usage analytics
    if (output.includes('browser_navigate')) pagesVisited++;
    if (output.includes('browser_screenshot') || output.includes('screenshot')) screenshotsTaken++;
    if (output.includes('Tool:') || output.includes('mcp_')) toolCallCount++;
  });
  
  cursorProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  return new Promise((resolve, reject) => {
    cursorProcess.on('exit', (code) => {
      if (code === 0) {
        resolve({ success: true, exitCode: code });
      } else {
        reject(new Error(\`Process exited with code \${code}\`));
      }
    });
    
    cursorProcess.on('error', reject);
  });
}

executeMCPTask()
  .then(result => {
    console.log('Task completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Task failed:', error);
    process.exit(1);
  });
`;

    // Write the script to a temporary file
    const scriptPath = `/tmp/mcp-task-${taskId}.mjs`;
    fs.writeFileSync(scriptPath, mcpTaskScript);
    
    // Execute the script
    console.log('Executing MCP-enabled task...');
    const taskProcess = spawn('node', [scriptPath], {
      env: {
        ...process.env,
        CURSOR_API_KEY: CONFIG.cursorApiKey,
        TASK_ID: taskId,
        WORKER_ID: CONFIG.workerId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    taskProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output);
    });
    
    taskProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(output);
    });
    
    // Wait for completion
    const exitCode = await new Promise((resolve, reject) => {
      taskProcess.on('exit', (code) => resolve(code));
      taskProcess.on('error', (err) => reject(err));
    });
    
    // Clean up script
    fs.unlinkSync(scriptPath);
    
    console.log(`Task completed with exit code: ${exitCode}`);
    
    // Report completion
    await reportCompletion(taskId, {
      success: exitCode === 0,
      result: {
        message: exitCode === 0 ? 'MCP task completed successfully' : 'MCP task failed',
        output: stdout,
        error: stderr || undefined,
        exit_code: exitCode,
        mcp_enabled: true,
      },
      analytics: {
        total_execution_time_ms: Date.now() - new Date(activeTasks.get(taskId).started_at).getTime(),
        mcp_servers_used: CONFIG.capabilities.mcpServers,
      },
    });
    
    activeTasks.delete(taskId);
    
    if (activeTasks.size === 0) {
      await updateWorkerStatus('idle');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ MCP Task Completed: ${taskId}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (error) {
    console.error(`❌ MCP Task failed: ${error.message}`);
    
    await reportCompletion(taskId, {
      success: false,
      result: {
        message: 'MCP task execution failed',
        error: error.message,
        stack: error.stack,
        mcp_enabled: true,
      },
    });
    
    activeTasks.delete(taskId);
    
    if (activeTasks.size === 0) {
      await updateWorkerStatus('idle');
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// REPORTING FUNCTIONS
// ══════════════════════════════════════════════════════════════════

async function updateWorkerStatus(status, currentTaskId = null) {
  try {
    const update = {
      worker_id: CONFIG.workerId,
      status,
      current_task_id: currentTaskId,
      updated_at: new Date().toISOString(),
      mcp_enabled: true,
    };
    
    await redis.set(
      `remote_worker:${CONFIG.workerId}:status`,
      JSON.stringify(update)
    );
    
    if (pgPool) {
      await pgPool.query(
        `UPDATE remote_workers SET status = $1, updated_at = NOW() WHERE worker_id = $2`,
        [status, CONFIG.workerId]
      );
    }
    
    natsConnection.publish(
      `worker.status.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(update))
    );
  } catch (error) {
    console.error('❌ Failed to update worker status:', error.message);
  }
}

async function reportCompletion(taskId, completionData) {
  try {
    const completion = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      ...completionData,
    };
    
    // Store in Redis
    await redis.set(`task:${taskId}:result`, JSON.stringify(completion), { EX: 3600 });
    
    // Publish to NATS
    natsConnection.publish(
      `task.completed.${taskId}`,
      sc.encode(JSON.stringify(completion))
    );
    
    // Publish completion to NATS (manager will update database)
    natsConnection.publish(
      'task.completion',
      sc.encode(JSON.stringify({
        task_id: taskId,
        worker_id: CONFIG.workerId,
        success: completionData.success || false,
        result_data: completionData.result,
        error_message: completionData.result?.error || null,
        total_tool_calls: completionData.analytics?.toolCallCount || 0,
        pages_visited: completionData.analytics?.pagesVisited || 0,
        screenshots_taken: completionData.analytics?.screenshotsTaken || 0,
        network_requests_captured: completionData.analytics?.networkRequests || 0,
        mcp_tools_used: completionData.analytics?.toolsUsed || [],
        metadata: completionData.analytics || {},
        timestamp: new Date().toISOString()
      }))
    );
    
    console.error(`✅ Task completion reported: ${taskId}`);
  } catch (error) {
    console.error('❌ Failed to report completion:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// NATS SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════════════

async function setupNATSSubscriptions() {
  try {
    console.error('📡 Setting up NATS subscriptions...');
    
    // Subscribe to task assignments
    const taskSub = natsConnection.subscribe(`worker.task.${CONFIG.workerId}`);
    (async () => {
      for await (const msg of taskSub) {
        try {
          const taskData = JSON.parse(sc.decode(msg.data));
          console.error(`📨 Received task assignment:`, taskData.task_id);
          
          // Check if we can accept more tasks
          if (activeTasks.size >= CONFIG.maxConcurrentTasks) {
            console.error(`❌ Rejecting task ${taskData.task_id}: Maximum concurrent tasks (${CONFIG.maxConcurrentTasks}) reached`);
            continue;
          }
          
          // Execute task asynchronously (non-blocking)
          executeTaskWithMCP(taskData).catch(error => {
            console.error(`❌ Error executing task ${taskData.task_id}:`, error);
          });
          
        } catch (error) {
          console.error('❌ Error processing task message:', error);
        }
      }
    })();
    
    console.error(`✅ Subscribed to worker.task.${CONFIG.workerId}`);
    
  } catch (error) {
    console.error('❌ Failed to setup NATS subscriptions:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// MAIN INITIALIZATION
// ══════════════════════════════════════════════════════════════════

async function main() {
  try {
    // Connect to infrastructure
    const natsOk = await connectNATS();
    const redisOk = await connectRedis();
    const pgOk = await connectPostgreSQL();
    
    if (!natsOk || !redisOk) {
      console.error('❌ Failed to connect to essential services (NATS/Redis)');
      process.exit(1);
    }
    
    if (!pgOk) {
      console.error('⚠️  Continuing without PostgreSQL - some features may be limited');
    }
    
    // Start MCP servers
    await startMCPServers();
    
    // Register worker
    await registerWorker();
    
    // Setup NATS subscriptions
    await setupNATSSubscriptions();
    
    // Start heartbeat
    setInterval(sendHeartbeat, CONFIG.heartbeatIntervalMs);
    await sendHeartbeat(); // Send first heartbeat immediately
    
    console.error('');
    console.error('✅ MCP-Enabled Worker ready!');
    console.error('   Waiting for task assignments...');
    console.error('');
    
  } catch (error) {
    console.error('❌ Fatal error during initialization:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGTERM', async () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  
  // Stop MCP servers
  for (const [name, proc] of mcpProcesses) {
    console.error(`Stopping ${name}...`);
    proc.kill('SIGTERM');
  }
  
  // Close connections
  if (natsConnection) await natsConnection.close();
  if (redis) await redis.quit();
  if (pgPool) await pgPool.end();
  
  process.exit(0);
});

// Start the worker
main().catch(console.error);
