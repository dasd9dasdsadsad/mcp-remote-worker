#!/usr/bin/env node
/**
 * Unified MCP-Enabled Remote Worker
 * Complete integration with enhanced MCP worker for comprehensive analytics
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

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Worker identity
  workerId: process.env.WORKER_ID || `unified-worker-${os.hostname()}-${uuidv4().substring(0, 8)}`,
  hostname: process.env.HOSTNAME || os.hostname(),
  workerType: "unified-mcp",
  version: "2.0.0",

  // Concurrency settings
  maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '3'),
  taskQueueSize: parseInt(process.env.TASK_QUEUE_SIZE || '10'),

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

  // Cursor/Agent configuration
  cursorApiKey: process.env.CURSOR_API_KEY || '',
  cursorModel: process.env.CURSOR_MODEL || 'auto',

  // Worker capabilities
  capabilities: {
    maxConcurrentTasks: 3,
    maxMemoryMB: parseInt(process.env.MAX_MEMORY_MB || '8192'),
    tags: ['unified', 'mcp', 'analytics', 'realtime', 'docker'],
    mcpEnabled: true,
    mcpServers: ['mcp-worker-enhanced', 'domlogger-unified'],
    analyticsEnabled: true,
    features: [
      'real-time-streaming',
      'detailed-analytics',
      'performance-profiling',
      'test-automation',
      'code-quality',
      'resource-monitoring',
      'collaborative-work',
      'error-recovery',
    ],
  },

  // Health & Monitoring
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000'),
  metricsIntervalMs: parseInt(process.env.METRICS_INTERVAL_MS || '10000'),

  // Task execution
  taskTimeout: parseInt(process.env.TASK_TIMEOUT_MS || '3600000'), // 1 hour default
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
};

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 UNIFIED MCP-ENABLED REMOTE WORKER v2.0');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Worker ID: ${CONFIG.workerId}`);
console.log(`Hostname: ${CONFIG.hostname}`);
console.log(`Manager: ${CONFIG.managerHost}`);
console.log(`Capabilities: ${CONFIG.capabilities.features.join(', ')}`);
console.log('═══════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════

let natsConnection;
let redis;
let pgPool;

const activeTasks = new Map();
const taskQueue = [];
const workerMetrics = {
  startTime: Date.now(),
  tasksCompleted: 0,
  tasksFailed: 0,
  totalExecutionTime: 0,
  averageExecutionTime: 0,
  resourceUsage: [],
  errorLog: [],
};

// ═══════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════

async function connectNATS() {
  try {
    const natsUrl = `nats://${CONFIG.nats.host}:${CONFIG.nats.port}`;
    console.log(`Connecting to NATS at ${natsUrl}...`);

    natsConnection = await connect({
      servers: [natsUrl],
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    });

    console.log('✅ Connected to NATS');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to NATS:', error.message);
    return false;
  }
}

async function connectRedis() {
  try {
    console.log(`Connecting to Redis at ${CONFIG.redis.host}:${CONFIG.redis.port}...`);

    redis = createClient({
      socket: {
        host: CONFIG.redis.host,
        port: CONFIG.redis.port,
      },
      password: CONFIG.redis.password || undefined,
    });

    await redis.connect();
    console.log('✅ Connected to Redis');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error.message);
    return false;
  }
}

async function connectPostgreSQL() {
  try {
    console.log(`Connecting to PostgreSQL at ${CONFIG.postgres.host}:${CONFIG.postgres.port}...`);

    pgPool = new Pool(CONFIG.postgres);
    const client = await pgPool.connect();
    await client.query('SELECT NOW()');
    client.release();

    console.log('✅ Connected to PostgreSQL');
    return true;
  } catch (error) {
    console.error('⚠️  PostgreSQL connection failed:', error.message);
    pgPool = null;
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// WORKER REGISTRATION & LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════

async function registerWorker() {
  try {
    console.log('📝 Registering unified worker with manager...');

    const workerInfo = {
      worker_id: CONFIG.workerId,
      worker_type: CONFIG.workerType,
      version: CONFIG.version,
      hostname: CONFIG.hostname,
      manager_host: CONFIG.managerHost,
      capabilities: CONFIG.capabilities,
      system_info: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpu_model: os.cpus()[0]?.model,
        totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        freeMemoryGB: Math.round(os.freemem() / 1024 / 1024 / 1024),
        nodeVersion: process.version,
        uptime: os.uptime(),
      },
      status: 'initializing',
      registered_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      metadata: {
        mcp_enabled: true,
        mcp_servers: CONFIG.capabilities.mcpServers,
        analytics_enabled: CONFIG.capabilities.analyticsEnabled,
        features: CONFIG.capabilities.features,
      }
    };

    // Register in PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO remote_workers (
          worker_id, hostname, manager_host, capabilities,
          system_info, status, metadata, registered_at, last_heartbeat
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (worker_id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          capabilities = EXCLUDED.capabilities,
          system_info = EXCLUDED.system_info,
          metadata = EXCLUDED.metadata,
          status = 'idle',
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
      console.log('✅ Registered in PostgreSQL');
    }

    // Register in Redis
    await redis.set(`worker:${CONFIG.workerId}`, JSON.stringify(workerInfo));
    await redis.sAdd('workers:active', CONFIG.workerId);
    await redis.sAdd('workers:unified', CONFIG.workerId);

    // Publish registration event
    await natsConnection.publish(
      'worker.registered',
      sc.encode(JSON.stringify(workerInfo))
    );

    console.log(`✅ Unified worker registered: ${CONFIG.workerId}`);

  } catch (error) {
    console.error('❌ Registration failed:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// MCP SERVER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

async function startMCPServers() {
  console.log('🔧 Starting MCP servers...');

  // Start enhanced MCP worker server
  const mcpWorkerPath = path.join(dirname(__dirname), 'mcp-worker', 'index-enhanced.js');
  const mcpWorkerProcess = spawn('node', [mcpWorkerPath], {
    env: {
      ...process.env,
      WORKER_ID: CONFIG.workerId,
      WORKER_TYPE: CONFIG.workerType,
      NATS_HOST: CONFIG.nats.host,
      NATS_PORT: CONFIG.nats.port.toString(),
      REDIS_HOST: CONFIG.redis.host,
      REDIS_PORT: CONFIG.redis.port.toString(),
      POSTGRES_HOST: CONFIG.postgres.host,
      POSTGRES_PORT: CONFIG.postgres.port.toString(),
    },
    stdio: 'pipe',
  });

  mcpWorkerProcess.stderr.on('data', (data) => {
    const output = data.toString();
    if (output.includes('Ready') || output.includes('✅')) {
      console.log(`MCP Worker: ${output.trim()}`);
    }
  });

  // Create MCP configuration for cursor-agent
  const mcpConfig = {
    mcpServers: {
      "mcp-worker-enhanced": {
        command: "node",
        args: [mcpWorkerPath],
        env: {
          WORKER_ID: CONFIG.workerId,
          NATS_HOST: CONFIG.nats.host.toString(),
          REDIS_HOST: CONFIG.redis.host.toString(),
          POSTGRES_HOST: CONFIG.postgres.host.toString(),
        }
      },
      "domlogger-unified": {
        command: "npx",
        args: ["-y", "@mcp-get-fork/server-puppeteer"],
      }
    }
  };

  // Write MCP config to file
  const mcpConfigPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  await fs.promises.mkdir(path.dirname(mcpConfigPath), { recursive: true });
  await fs.promises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

  console.log('✅ MCP servers configured');

  return { mcpWorkerProcess };
}

// ═══════════════════════════════════════════════════════════════════════
// TASK EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════════════

async function executeTask(taskData) {
  const taskId = taskData.task_id || uuidv4();
  const sessionId = uuidv4();
  const taskDescription = taskData.task_description || taskData.description;
  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🎯 Starting Task: ${taskId}`);
  console.log(`📝 Description: ${taskDescription.substring(0, 200)}...`);
  console.log(`🔧 Session: ${sessionId}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Add to active tasks
  activeTasks.set(taskId, {
    startTime,
    taskData,
    sessionId,
    status: 'initializing',
    metrics: {
      progress: 0,
      errors: 0,
      warnings: 0,
    },
  });

  try {
    // Report task start
    await reportTaskEvent(taskId, 'started', {
      description: taskDescription,
      sessionId,
      estimatedDuration: taskData.estimated_duration_ms,
    });

    // Setup MCP servers for this task
    const { mcpWorkerProcess } = await startMCPServers();

    // Prepare cursor-agent command with enhanced prompt
    const enhancedPrompt = `
${taskDescription}

IMPORTANT: You have access to MCP tools for reporting. Use them frequently:
- Use report_progress regularly to update status (every major step)
- Use report_milestone when completing significant parts
- Use stream_realtime_data for important decisions and reasoning
- Use report_analytics for performance and code metrics
- Use report_test_results after running tests
- Use report_error for any errors encountered
- Use ask_manager if you need clarification
- Use report_completion when done with detailed summary

Be verbose in your reporting. The manager needs detailed real-time updates.
`;

    // Execute cursor-agent with MCP integration
    const cursorProcess = spawn('cursor-agent', [
      '--model', CONFIG.cursorModel,
      '-p', enhancedPrompt,
      '--approve-mcps',
      '--force'
    ], {
      cwd: taskData.working_directory || '/app',
      env: {
        ...process.env,
        CURSOR_API_KEY: CONFIG.cursorApiKey,
        TASK_ID: taskId,
        WORKER_ID: CONFIG.workerId,
        SESSION_ID: sessionId,
        HOME: process.env.HOME || '/root',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Stream output processing
    cursorProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[AGENT] ${output}`);

      // Parse and forward streaming data
      parseAndStreamOutput(taskId, output, 'stdout');
    });

    cursorProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[AGENT-ERR] ${output}`);

      // Parse and forward error data
      parseAndStreamOutput(taskId, output, 'stderr');
    });

    // Monitor task progress via NATS subscriptions
    const progressSub = natsConnection.subscribe(`worker.progress.${CONFIG.workerId}`);
    const milestoneSub = natsConnection.subscribe(`worker.milestone.${CONFIG.workerId}`);
    const analyticsSub = natsConnection.subscribe(`worker.analytics.*`);

    // Handle progress updates
    (async () => {
      for await (const msg of progressSub) {
        const progress = JSON.parse(sc.decode(msg.data));
        const task = activeTasks.get(progress.task_id);
        if (task) {
          task.status = progress.status;
          task.metrics.progress = progress.metrics.percent_complete;
          console.log(`📊 Progress: ${progress.metrics.percent_complete}% - ${progress.metrics.current_operation}`);
        }
      }
    })();

    // Wait for completion with timeout
    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cursorProcess.kill('SIGTERM');
        reject(new Error('Task timeout exceeded'));
      }, CONFIG.taskTimeout);

      cursorProcess.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    // Clean up subscriptions
    progressSub.unsubscribe();
    milestoneSub.unsubscribe();
    analyticsSub.unsubscribe();

    // Clean up MCP server
    mcpWorkerProcess.kill();

    const executionTime = Date.now() - startTime;
    const success = exitCode === 0;
    const task = activeTasks.get(taskId);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`${success ? '✅' : '❌'} Task completed: ${taskId}`);
    console.log(`   Exit code: ${exitCode}`);
    console.log(`   Duration: ${executionTime}ms`);
    console.log(`   Progress: ${task.metrics.progress}%`);
    console.log(`   Errors: ${task.metrics.errors}`);
    console.log('═══════════════════════════════════════════════════════════════');

    // Report completion
    await reportTaskCompletion(taskId, success, {
      exit_code: exitCode,
      execution_time_ms: executionTime,
      final_progress: task.metrics.progress,
      errors_count: task.metrics.errors,
      warnings_count: task.metrics.warnings,
      stdout_length: stdout.length,
      stderr_length: stderr.length,
    });

    // Update metrics
    workerMetrics.tasksCompleted++;
    workerMetrics.totalExecutionTime += executionTime;
    workerMetrics.averageExecutionTime =
      workerMetrics.totalExecutionTime / workerMetrics.tasksCompleted;

    return { success, exitCode, executionTime };

  } catch (error) {
    console.error(`❌ Task failed: ${error.message}`);
    workerMetrics.tasksFailed++;
    workerMetrics.errorLog.push({
      taskId,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    await reportTaskCompletion(taskId, false, {
      error: error.message,
      stack: error.stack,
    });

    throw error;

  } finally {
    activeTasks.delete(taskId);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// OUTPUT PARSING & STREAMING
// ═══════════════════════════════════════════════════════════════════════

function parseAndStreamOutput(taskId, output, source) {
  // Parse output for important information
  const lines = output.split('\n');

  for (const line of lines) {
    // Detect tool calls
    if (line.includes('Tool:') || line.includes('calling')) {
      natsConnection.publish(
        `worker.stream.tool_call.${CONFIG.workerId}`,
        sc.encode(JSON.stringify({
          task_id: taskId,
          source,
          content: line,
          timestamp: new Date().toISOString(),
        }))
      );
    }

    // Detect errors
    if (line.toLowerCase().includes('error') || line.includes('❌')) {
      const task = activeTasks.get(taskId);
      if (task) task.metrics.errors++;
    }

    // Detect warnings
    if (line.toLowerCase().includes('warning') || line.includes('⚠️')) {
      const task = activeTasks.get(taskId);
      if (task) task.metrics.warnings++;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// REPORTING FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

async function reportTaskEvent(taskId, eventType, data) {
  const event = {
    task_id: taskId,
    worker_id: CONFIG.workerId,
    event_type: eventType,
    data,
    timestamp: new Date().toISOString(),
  };

  await natsConnection.publish(
    `task.event.${eventType}`,
    sc.encode(JSON.stringify(event))
  );

  if (pgPool) {
    await pgPool.query(
      `INSERT INTO task_events (task_id, worker_id, event_type, event_data, timestamp)
       VALUES ($1, $2, $3, $4, NOW())`,
      [taskId, CONFIG.workerId, eventType, JSON.stringify(data)]
    );
  }
}

async function reportTaskCompletion(taskId, success, analytics) {
  const completion = {
    task_id: taskId,
    worker_id: CONFIG.workerId,
    success,
    analytics,
    timestamp: new Date().toISOString(),
  };

  await natsConnection.publish(
    'task.completion',
    sc.encode(JSON.stringify(completion))
  );

  // Update task status in Redis
  await redis.hSet(`task:${taskId}`, {
    status: success ? 'completed' : 'failed',
    completed_at: new Date().toISOString(),
    worker_id: CONFIG.workerId,
    analytics: JSON.stringify(analytics),
  });

  // Store in PostgreSQL
  if (pgPool) {
    await pgPool.query(
      `UPDATE tasks SET
        status = $1,
        completed_at = NOW(),
        analytics = $2,
        worker_id = $3
       WHERE task_id = $4`,
      [success ? 'completed' : 'failed', JSON.stringify(analytics), CONFIG.workerId, taskId]
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// HEARTBEAT & MONITORING
// ═══════════════════════════════════════════════════════════════════════

async function sendHeartbeat() {
  try {
    const systemInfo = {
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      loadAverage: os.loadavg(),
      cpuUsage: process.cpuUsage(),
      uptime: os.uptime(),
      processUptime: process.uptime(),
    };

    const heartbeat = {
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      status: activeTasks.size > 0 ? 'busy' : 'idle',
      active_tasks: activeTasks.size,
      queued_tasks: taskQueue.length,
      metrics: workerMetrics,
      system_info: systemInfo,
      capabilities: CONFIG.capabilities,
    };

    // Update Redis
    await redis.set(
      `worker:${CONFIG.workerId}:heartbeat`,
      JSON.stringify(heartbeat),
      { EX: 30 } // Expire after 30 seconds
    );

    // Update PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `UPDATE remote_workers
         SET last_heartbeat = NOW(),
             status = $1,
             system_info = $2,
             updated_at = NOW()
         WHERE worker_id = $3`,
        [heartbeat.status, JSON.stringify(systemInfo), CONFIG.workerId]
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

async function sendMetrics() {
  try {
    const metrics = {
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      performance: {
        tasks_completed: workerMetrics.tasksCompleted,
        tasks_failed: workerMetrics.tasksFailed,
        average_execution_time_ms: workerMetrics.averageExecutionTime,
        uptime_ms: Date.now() - workerMetrics.startTime,
      },
      resources: {
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cpu_usage: process.cpuUsage(),
        active_handles: process._getActiveHandles?.()?.length || 0,
        active_requests: process._getActiveRequests?.()?.length || 0,
      },
      queue: {
        active: activeTasks.size,
        pending: taskQueue.length,
        capacity: CONFIG.maxConcurrentTasks - activeTasks.size,
      },
    };

    await natsConnection.publish(
      `worker.metrics.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(metrics))
    );

    // Store recent metrics in Redis
    await redis.lPush(
      `worker:${CONFIG.workerId}:metrics`,
      JSON.stringify(metrics)
    );
    await redis.lTrim(`worker:${CONFIG.workerId}:metrics`, 0, 100);

  } catch (error) {
    console.error('❌ Metrics error:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TASK QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

async function processTaskQueue() {
  while (taskQueue.length > 0 && activeTasks.size < CONFIG.maxConcurrentTasks) {
    const task = taskQueue.shift();

    console.log(`📦 Processing queued task: ${task.task_id}`);

    // Execute task (non-blocking)
    executeTask(task).catch(err => {
      console.error(`❌ Task execution error: ${err.message}`);
    });

    // Small delay between task starts
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TASK LISTENER
// ═══════════════════════════════════════════════════════════════════════

async function startTaskListener() {
  console.log('📡 Setting up task listeners...');

  // Direct task assignment
  const directTaskSub = natsConnection.subscribe(`worker.task.${CONFIG.workerId}`);

  // Broadcast task pool (for any available worker)
  const broadcastTaskSub = natsConnection.subscribe('task.broadcast');

  // Priority tasks
  const priorityTaskSub = natsConnection.subscribe('task.priority');

  console.log('✅ Subscribed to task channels');

  // Handle direct tasks
  (async () => {
    for await (const msg of directTaskSub) {
      try {
        const taskData = JSON.parse(sc.decode(msg.data));
        console.log(`📨 Received direct task: ${taskData.task_id}`);

        if (activeTasks.size < CONFIG.maxConcurrentTasks) {
          executeTask(taskData).catch(err => {
            console.error(`Task execution error: ${err.message}`);
          });
        } else if (taskQueue.length < CONFIG.taskQueueSize) {
          taskQueue.push(taskData);
          console.log(`📥 Task queued (queue size: ${taskQueue.length})`);
        } else {
          console.log(`❌ Task rejected - queue full`);
          // Notify manager that task was rejected
          await reportTaskEvent(taskData.task_id, 'rejected', {
            reason: 'queue_full',
            worker_id: CONFIG.workerId,
          });
        }
      } catch (error) {
        console.error('Error processing task:', error.message);
      }
    }
  })();

  // Handle broadcast tasks (claim if available)
  (async () => {
    for await (const msg of broadcastTaskSub) {
      try {
        if (activeTasks.size >= CONFIG.maxConcurrentTasks) continue;

        const taskData = JSON.parse(sc.decode(msg.data));

        // Try to claim the task
        const claimed = await redis.setNX(
          `task:${taskData.task_id}:claimed`,
          CONFIG.workerId,
          { EX: 60 }
        );

        if (claimed) {
          console.log(`🎯 Claimed broadcast task: ${taskData.task_id}`);
          executeTask(taskData).catch(err => {
            console.error(`Task execution error: ${err.message}`);
          });
        }
      } catch (error) {
        console.error('Error processing broadcast task:', error.message);
      }
    }
  })();

  // Handle priority tasks
  (async () => {
    for await (const msg of priorityTaskSub) {
      try {
        const taskData = JSON.parse(sc.decode(msg.data));
        console.log(`🚨 Received priority task: ${taskData.task_id}`);

        // Priority tasks go to front of queue
        taskQueue.unshift(taskData);
        processTaskQueue();
      } catch (error) {
        console.error('Error processing priority task:', error.message);
      }
    }
  })();
}

// ═══════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════

async function setupCommandHandlers() {
  console.log('🎮 Setting up command handlers...');

  // Handle worker commands
  const commandSub = natsConnection.subscribe(`worker.command.${CONFIG.workerId}`);

  (async () => {
    for await (const msg of commandSub) {
      try {
        const command = JSON.parse(sc.decode(msg.data));
        console.log(`📟 Received command: ${command.type}`);

        switch (command.type) {
          case 'pause':
            // Pause processing new tasks
            CONFIG.maxConcurrentTasks = 0;
            console.log('⏸️  Worker paused');
            break;

          case 'resume':
            // Resume processing
            CONFIG.maxConcurrentTasks = parseInt(command.max_tasks || '3');
            processTaskQueue();
            console.log('▶️  Worker resumed');
            break;

          case 'stop':
            // Graceful shutdown
            console.log('🛑 Shutdown requested');
            await gracefulShutdown();
            break;

          case 'update_config':
            // Update configuration
            Object.assign(CONFIG, command.config);
            console.log('🔧 Configuration updated');
            break;

          case 'clear_queue':
            // Clear task queue
            taskQueue.length = 0;
            console.log('🗑️  Queue cleared');
            break;

          case 'status':
            // Report current status
            await sendDetailedStatus();
            break;

          default:
            console.log(`Unknown command: ${command.type}`);
        }
      } catch (error) {
        console.error('Command error:', error.message);
      }
    }
  })();

  console.log('✅ Command handlers ready');
}

async function sendDetailedStatus() {
  const status = {
    worker_id: CONFIG.workerId,
    timestamp: new Date().toISOString(),
    state: {
      active_tasks: Array.from(activeTasks.entries()).map(([id, task]) => ({
        task_id: id,
        status: task.status,
        progress: task.metrics.progress,
        duration_ms: Date.now() - task.startTime,
      })),
      queued_tasks: taskQueue.map(t => t.task_id),
      capacity: CONFIG.maxConcurrentTasks - activeTasks.size,
    },
    metrics: workerMetrics,
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
    },
  };

  await natsConnection.publish(
    `worker.status.response.${CONFIG.workerId}`,
    sc.encode(JSON.stringify(status))
  );
}

// ═══════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════

async function gracefulShutdown() {
  console.log('🛑 Starting graceful shutdown...');

  // Stop accepting new tasks
  CONFIG.maxConcurrentTasks = 0;

  // Wait for active tasks to complete (with timeout)
  const shutdownTimeout = setTimeout(() => {
    console.log('⚠️  Shutdown timeout - forcing exit');
    process.exit(1);
  }, 30000);

  while (activeTasks.size > 0) {
    console.log(`Waiting for ${activeTasks.size} active tasks...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  clearTimeout(shutdownTimeout);

  // Unregister worker
  if (redis) {
    await redis.sRem('workers:active', CONFIG.workerId);
    await redis.sRem('workers:unified', CONFIG.workerId);
    await redis.del(`worker:${CONFIG.workerId}`);
  }

  if (pgPool) {
    await pgPool.query(
      `UPDATE remote_workers SET status = 'offline', last_heartbeat = NOW() WHERE worker_id = $1`,
      [CONFIG.workerId]
    );
  }

  // Close connections
  if (redis) await redis.quit();
  if (pgPool) await pgPool.end();
  if (natsConnection) await natsConnection.close();

  console.log('✅ Graceful shutdown complete');
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN STARTUP
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  try {
    // Connect to infrastructure
    await connectNATS();
    await connectRedis();
    await connectPostgreSQL();

    // Register worker
    await registerWorker();

    // Setup listeners and handlers
    await startTaskListener();
    await setupCommandHandlers();

    // Start monitoring
    setInterval(sendHeartbeat, CONFIG.heartbeatIntervalMs);
    setInterval(sendMetrics, CONFIG.metricsIntervalMs);
    setInterval(processTaskQueue, 5000);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ UNIFIED WORKER READY');
    console.log('📊 Analytics: Enabled');
    console.log('🔄 Real-time Streaming: Active');
    console.log('🎯 Waiting for tasks...');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Error handlers
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  workerMetrics.errorLog.push({
    type: 'uncaught_exception',
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  workerMetrics.errorLog.push({
    type: 'unhandled_rejection',
    reason: reason?.toString(),
    timestamp: new Date().toISOString(),
  });
});

// Start the unified worker
main();