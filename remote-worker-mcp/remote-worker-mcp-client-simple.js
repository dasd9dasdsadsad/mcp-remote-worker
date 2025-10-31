#!/usr/bin/env node
/**
 * MCP-Enabled Remote Worker Client - Simplified Version
 * Direct cursor-agent execution without wrapper scripts
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
    tags: (process.env.WORKER_TAGS || 'mcp,docker,remote,simple').split(','),
    mcpEnabled: true,
    mcpServers: ['mcp-worker-tools', 'domlogger-unified'],
  },
  
  // Health check
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000'),
};

console.error('═══════════════════════════════════════════════════════════════');
console.error('🌐 MCP-ENABLED REMOTE WORKER (SIMPLIFIED)');
console.error('═══════════════════════════════════════════════════════════════');
console.error(`Worker ID: ${CONFIG.workerId}`);
console.error(`Hostname: ${CONFIG.hostname}`);
console.error(`Manager: ${CONFIG.managerHost}`);
console.error('═══════════════════════════════════════════════════════════════');

// ══════════════════════════════════════════════════════════════════
// INFRASTRUCTURE CONNECTIONS
// ══════════════════════════════════════════════════════════════════

let natsConnection;
let redis;
let pgPool;
const activeTasks = new Map();

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
    pgPool = null;
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════
// WORKER REGISTRATION
// ══════════════════════════════════════════════════════════════════

async function registerWorker() {
  try {
    console.error('📝 Registering worker with manager...');
    
    const workerInfo = {
      worker_id: CONFIG.workerId,
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
      status: 'idle',
      registered_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      metadata: {
        mcp_enabled: true,
        mcp_servers: CONFIG.capabilities.mcpServers,
      }
    };
    
    // Register in PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO remote_workers (worker_id, hostname, manager_host, capabilities, system_info, status, metadata, registered_at, last_heartbeat)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (worker_id) DO UPDATE SET
           hostname = EXCLUDED.hostname,
           capabilities = EXCLUDED.capabilities,
           system_info = EXCLUDED.system_info,
           last_heartbeat = NOW(),
           updated_at = NOW()`,
        [
          CONFIG.workerId,
          CONFIG.hostname,
          CONFIG.managerHost,
          JSON.stringify(workerInfo.capabilities),
          JSON.stringify(workerInfo.system_info),
          'idle',
          JSON.stringify(workerInfo.metadata),
        ]
      );
      console.error('✅ Registered in PostgreSQL');
    }
    
    // Register in Redis
    await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify(workerInfo));
    await redis.sAdd('remote_workers:active', CONFIG.workerId);
    
    console.error(`✅ Worker registered: ${CONFIG.workerId}`);
    
  } catch (error) {
    console.error('❌ Registration failed:', error.message);
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
      system_info: {
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
      }
    };
    
    // Update Redis
    await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify({
      ...heartbeat,
      hostname: CONFIG.hostname,
      last_heartbeat: heartbeat.timestamp,
    }));
    
    // Update PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `UPDATE remote_workers 
         SET last_heartbeat = NOW(), status = $1, updated_at = NOW()
         WHERE worker_id = $2`,
        [heartbeat.status, CONFIG.workerId]
      );
    }
    
    // Publish to NATS
    natsConnection.publish(
      `worker.heartbeat.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(heartbeat))
    );
    
  } catch (error) {
    console.error('❌ Heartbeat error:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// TASK EXECUTION - DIRECT CURSOR-AGENT (NO WRAPPER)
// ══════════════════════════════════════════════════════════════════

async function executeTask(taskData) {
  const taskId = taskData.task_id || uuidv4();
  const taskDescription = taskData.task_description || taskData.description;
  const startTime = Date.now();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 Starting Task: ${taskId}`);
  console.log(`   Description: ${taskDescription.substring(0, 100)}...`);
  console.log('═══════════════════════════════════════════════════════════════');
  
  activeTasks.set(taskId, { startTime, taskData });
  
  try {
    // Load analytics prompt
    let analyticsPrompt = '';
    try {
      analyticsPrompt = fs.readFileSync('/app/ai-analytics-prompt.txt', 'utf8');
    } catch (e) {
      console.error('Warning: Could not load analytics prompt');
    }
    
    // Combine analytics prompt with task description
    const enhancedPrompt = analyticsPrompt + '\n\nTASK TO EXECUTE:\n' + taskDescription;
    
    // Execute cursor-agent DIRECTLY without wrapper script
    const cursorProcess = spawn('cursor-agent', [
      '--model', 'auto',
      '-p', enhancedPrompt,
      '--approve-mcps',
      '--force'
    ], {
      cwd: '/app',
      env: {
        ...process.env,
        CURSOR_API_KEY: CONFIG.cursorApiKey,
        HOME: process.env.HOME || '/root',
        TASK_ID: taskId,
        WORKER_ID: CONFIG.workerId,
        SESSION_ID: taskId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    cursorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output);
    });
    
    cursorProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(output);
    });
    
    // Wait for completion
    const exitCode = await new Promise((resolve) => {
      cursorProcess.on('close', resolve);
    });
    
    const executionTime = Date.now() - startTime;
    const success = exitCode === 0;
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Task completed: ${taskId}`);
    console.log(`   Exit code: ${exitCode}`);
    console.log(`   Duration: ${executionTime}ms`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    // Report completion
    await reportCompletion(taskId, success, {
      exit_code: exitCode,
      execution_time_ms: executionTime,
      stdout_length: stdout.length,
      stderr_length: stderr.length,
    });
    
  } catch (error) {
    console.error(`❌ Task failed: ${error.message}`);
    await reportCompletion(taskId, false, {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    activeTasks.delete(taskId);
  }
}

async function reportCompletion(taskId, success, analytics) {
  try {
    const completion = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      success,
      timestamp: new Date().toISOString(),
      analytics,
    };
    
    // Store in PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO remote_worker_events (worker_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [CONFIG.workerId, 'task_completed', JSON.stringify(completion)]
      );
    }
    
    // Publish to NATS
    natsConnection.publish(
      'task.completion',
      sc.encode(JSON.stringify(completion))
    );
    
    console.error(`✅ Completion reported for: ${taskId}`);
  } catch (error) {
    console.error(`❌ Failed to report completion: ${error.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════
// TASK LISTENER
// ══════════════════════════════════════════════════════════════════

async function startTaskListener() {
  console.error('📡 Setting up task listener...');
  
  const taskSub = natsConnection.subscribe(`worker.task.${CONFIG.workerId}`);
  
  console.error(`✅ Subscribed to: worker.task.${CONFIG.workerId}`);
  
  (async () => {
    for await (const msg of taskSub) {
      try {
        const taskData = JSON.parse(sc.decode(msg.data));
        console.error(`📨 Received task: ${taskData.task_id}`);
        
        // Execute task (non-blocking)
        executeTask(taskData).catch(err => {
          console.error(`❌ Task execution error: ${err.message}`);
        });
        
      } catch (error) {
        console.error('❌ Error processing task message:', error.message);
      }
    }
  })();
}

// ══════════════════════════════════════════════════════════════════
// MAIN STARTUP
// ══════════════════════════════════════════════════════════════════

async function main() {
  try {
    // Connect to infrastructure
    await connectNATS();
    await connectRedis();
    await connectPostgreSQL();
    
    // Register worker
    await registerWorker();
    
    // Start task listener
    await startTaskListener();
    
    // Start heartbeat
    setInterval(sendHeartbeat, CONFIG.heartbeatIntervalMs);
    
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('✅ Worker ready and waiting for tasks!');
    console.error('═══════════════════════════════════════════════════════════════');
    
  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('\n🛑 Shutting down...');
  if (redis) await redis.quit();
  if (pgPool) await pgPool.end();
  if (natsConnection) await natsConnection.close();
  process.exit(0);
});

// Start the worker
main();


