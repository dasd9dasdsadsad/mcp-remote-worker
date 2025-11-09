#!/usr/bin/env node
/**
 * MCP-Enabled Remote Worker Client - Simplified Version
 * Direct cursor-agent execution without wrapper scripts
 */

import { spawn } from 'child_process';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const { Pool } = pg;
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
  
  // REST API configuration
  api: {
    url: process.env.API_URL || `http://${process.env.API_HOST || process.env.MANAGER_HOST || 'localhost'}:${process.env.API_PORT || '4001'}`,
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000'),
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

let pgPool;
const activeTasks = new Map();

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

async function apiPost(path, payload) {
  const url = `${CONFIG.api.url}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API POST ${path} failed: ${response.status} ${text}`);
  }

  try {
    return await response.json();
  } catch (error) {
    return { success: true };
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

    await apiPost('/api/workers/register', workerInfo);
    
    // Register in Redis
    // This section is removed as per the edit hint to remove NATS/Redis settings.
    // await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify(workerInfo));
    // await redis.sAdd('remote_workers:active', CONFIG.workerId);
    
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
    // This section is removed as per the edit hint to remove NATS/Redis settings.
    // await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify({
    //   ...heartbeat,
    //   hostname: CONFIG.hostname,
    //   last_heartbeat: heartbeat.timestamp,
    // }));
    
    // Update PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `UPDATE remote_workers 
         SET last_heartbeat = NOW(), status = $1, updated_at = NOW()
         WHERE worker_id = $2`,
        [heartbeat.status, CONFIG.workerId]
      );
    }
    
    await apiPost('/api/workers/heartbeat', {
      worker_id: CONFIG.workerId,
      status: heartbeat.status,
      active_tasks: heartbeat.active_tasks,
      health: heartbeat.system_info,
    });
    
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
    // Use task description directly - analytics prompt causes MCP tool errors in print mode
    // TODO: Fix MCP tool initialization in print mode to re-enable analytics
    const enhancedPrompt = taskDescription;
    
    // Execute cursor-agent DIRECTLY without wrapper script
    // CRITICAL FIX: Use -p (print mode) for non-interactive output, REMOVE --approve-mcps (causes hang)
    console.log('🔍 DEBUG: About to spawn cursor-agent (with MCP tools support)');
    console.log('🔍 DEBUG: Command:', 'cursor-agent');
    console.log('🔍 DEBUG: Args:', ['-p', enhancedPrompt, '--force']);
    console.log('🔍 DEBUG: CWD:', '/app');
    console.log('🔍 DEBUG: Prompt length:', enhancedPrompt.length);
    console.log('🔍 DEBUG: HOME:', process.env.HOME || '/root');
    
    const cursorProcess = spawn('cursor-agent', [
      '-p',                    // Enable print/headless mode for non-interactive use
      enhancedPrompt,          // Prompt as first positional argument after -p
      '--force'                // Force allow commands
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
      stdio: ['inherit', 'pipe', 'pipe'], // Use inherit for stdin to simulate -it behavior
    });
    
    console.log('🔍 DEBUG: cursor-agent spawned, PID:', cursorProcess.pid);
    
    let stdout = '';
    let stderr = '';
    
    cursorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('📤 STDOUT:', output);
    });
    
    cursorProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error('📤 STDERR:', output);
    });
    
    cursorProcess.on('error', (error) => {
      console.error('❌ Process Error:', error);
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
    console.log(`   STDOUT captured: ${stdout.length} bytes`);
    console.log(`   STDERR captured: ${stderr.length} bytes`);
    console.log('═══════════════════════════════════════════════════════════════');
    
    if (stdout.length > 0) {
      console.log('📋 STDOUT CONTENT:');
      console.log(stdout);
    }
    
    if (stderr.length > 0) {
      console.log('📋 STDERR CONTENT:');
      console.error(stderr);
    }
    
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
    
    // Store in PostgreSQL for audit trail
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO remote_worker_events (worker_id, event_type, event_data)
         VALUES ($1, $2, $3)`,
        [CONFIG.workerId, 'task_completed', JSON.stringify(completion)]
      );
    }
    
    await apiPost('/api/completions', {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      status: success ? 'completed' : 'failed',
      summary: analytics,
      analytics,
    });
    
    console.error(`✅ Completion reported for: ${taskId}`);
  } catch (error) {
    console.error(`❌ Failed to report completion: ${error.message}`);
  }
}

async function pollForTask() {
  if (activeTasks.size >= CONFIG.maxConcurrentTasks) {
    return;
  }

  try {
    const response = await apiPost('/api/task-queue/next', {
      worker_id: CONFIG.workerId,
    });

    if (response.success && response.task) {
      console.error(`📨 Received task: ${response.task.task_id}`);
      executeTask(response.task).catch((err) => {
        console.error(`❌ Task execution error: ${err.message}`);
      });
    }
  } catch (error) {
    console.error(`❌ Task polling error: ${error.message}`);
  }
}

async function startTaskListener() {
  console.error('📡 Starting REST task polling...');

  const poll = async () => {
    await pollForTask();
  };

  await poll();
  setInterval(poll, CONFIG.api.pollIntervalMs);
}

// ══════════════════════════════════════════════════════════════════
// MAIN STARTUP
// ══════════════════════════════════════════════════════════════════

async function main() {
  try {
    // Connect to infrastructure
    // This section is removed as per the edit hint to remove NATS/Redis settings.
    // await connectNATS();
    // await connectRedis();
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
  // This section is removed as per the edit hint to remove NATS/Redis settings.
  // if (redis) await redis.quit();
  if (pgPool) await pgPool.end();
  // This section is removed as per the edit hint to remove NATS/Redis settings.
  // if (natsConnection) await natsConnection.close();
  process.exit(0);
});

// Start the worker
main();


