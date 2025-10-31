#!/usr/bin/env node
/**
 * MCP-Enabled Remote Worker Client with REAL-TIME ANALYTICS
 * 
 * This enhanced worker provides real-time streaming analytics and progress updates
 * back to the manager during task execution.
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
    tags: (process.env.WORKER_TAGS || 'mcp,docker,remote,enhanced,realtime').split(','),
    mcpEnabled: true,
    mcpServers: ['mcp-worker', 'domlogger-unified'],
    realtimeAnalytics: true,
  },
  
  // Health check and reporting
  heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000'),
  progressReportIntervalMs: parseInt(process.env.PROGRESS_REPORT_INTERVAL_MS || '5000'),
};

console.error('═══════════════════════════════════════════════════════════════');
console.error('🌐 MCP-ENABLED REMOTE WORKER CLIENT (REAL-TIME ANALYTICS)');
console.error('═══════════════════════════════════════════════════════════════');
console.error(`Worker ID: ${CONFIG.workerId}`);
console.error(`Hostname: ${CONFIG.hostname}`);
console.error(`Manager: ${CONFIG.managerHost}`);
console.error(`MCP Servers: ${CONFIG.capabilities.mcpServers.join(', ')}`);
console.error(`Real-Time Analytics: ENABLED`);
console.error('═══════════════════════════════════════════════════════════════');

// ══════════════════════════════════════════════════════════════════
// INFRASTRUCTURE CONNECTIONS
// ══════════════════════════════════════════════════════════════════

let natsConnection;
let redis;
let pgPool;
const activeTasks = new Map(); // taskId -> { process, startTime, taskData, analytics }
let taskCounter = 0;
const mcpProcesses = new Map();

// Connect to NATS
async function connectNATS() {
  try {
    const natsUrl = `nats://${CONFIG.nats.host}:${CONFIG.nats.port}`;
    console.error(`Connecting to NATS at ${natsUrl}...`);
    natsConnection = await connect({ servers: natsUrl });
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
    
    // Test connection
    await pgPool.query('SELECT NOW()');
    console.error('✅ Connected to PostgreSQL');
    return true;
  } catch (error) {
    console.error('⚠️  WARNING: Failed to connect to PostgreSQL:', error.message);
    console.error('   Worker will continue with limited functionality (no persistent storage)');
    console.error('⚠️  Continuing without PostgreSQL - some features may be limited');
    pgPool = null;
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════
// REAL-TIME ANALYTICS REPORTING
// ══════════════════════════════════════════════════════════════════

// Stream real-time progress updates to manager
async function streamProgressUpdate(taskId, updateData) {
  try {
    const progressMessage = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      timestamp: new Date().toISOString(),
      ...updateData
    };
    
    // Publish to NATS for real-time streaming
    await natsConnection.publish(
      `worker.progress.realtime.${CONFIG.workerId}`,
      sc.encode(JSON.stringify(progressMessage))
    );
    
    // Also publish to general progress channel
    await natsConnection.publish(
      `task.progress.${taskId}`,
      sc.encode(JSON.stringify(progressMessage))
    );
    
    // Update Redis cache for quick access
    await redis.set(`task:progress:${taskId}`, JSON.stringify(progressMessage), {
      EX: 3600 // Expire after 1 hour
    });
    
    console.error(`📊 Real-time progress: ${updateData.status} - ${updateData.message || ''}`);
  } catch (error) {
    console.error('❌ Failed to stream progress:', error.message);
  }
}

// Report detailed task analytics
async function reportTaskProgress(taskId, status, percent, message, analytics = {}) {
  try {
    const progressData = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      status,
      percent_complete: percent,
      message,
      timestamp: new Date().toISOString(),
      analytics: {
        ...analytics,
        free_memory_mb: Math.round(os.freemem() / 1024 / 1024),
        load_average: os.loadavg(),
        uptime: os.uptime(),
      }
    };
    
    // Stream via NATS
    await streamProgressUpdate(taskId, progressData);
    
    console.error(`📈 Progress: ${percent}% - ${message}`);
  } catch (error) {
    console.error('❌ Failed to report progress:', error.message);
  }
}

// Update worker status with analytics
async function updateWorkerStatus(status, taskId = null) {
  try {
    const systemInfo = {
      freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      loadAverage: os.loadavg(),
      uptime: os.uptime(),
    };
    
    const statusUpdate = {
      worker_id: CONFIG.workerId,
      status,
      active_tasks: activeTasks.size,
      timestamp: new Date().toISOString(),
      system_info: systemInfo,
      mcp_servers_running: Array.from(mcpProcesses.keys()),
      current_task_id: taskId,
    };
    
    // Update PostgreSQL if connected
    if (pgPool) {
      await pgPool.query(`
        UPDATE remote_workers 
        SET status = $1, updated_at = NOW(), system_info = $2
        WHERE worker_id = $3
      `, [status, JSON.stringify(systemInfo), CONFIG.workerId]);
    }
    
    // Update Redis
    await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify(statusUpdate));
    
    // Send heartbeat via NATS
    await natsConnection.publish(
      'remote.worker.heartbeat',
      sc.encode(JSON.stringify(statusUpdate))
    );
    
  } catch (error) {
    console.error('❌ Failed to update worker status:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// ENHANCED TASK EXECUTION WITH REAL-TIME ANALYTICS
// ══════════════════════════════════════════════════════════════════

async function executeTaskWithMCP(taskData) {
  const taskId = taskData.task_id || uuidv4();
  const taskDescription = taskData.task_description || taskData.description;
  const startTime = Date.now();
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`🚀 Starting MCP-Enabled Task with Real-Time Analytics: ${taskId}`);
  console.log(`   Description: ${taskDescription.substring(0, 100)}...`);
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
    total_tool_calls: 0,
    mcp_tools_used: new Set(),
  };
  
  activeTasks.set(taskId, taskAnalytics);
  
  // Report task start with initial analytics
  await reportTaskProgress(taskId, 'started', 0, 'Task initialization complete', {
    worker_id: CONFIG.workerId,
    mcp_servers_available: Array.from(mcpProcesses.keys()),
    start_time: new Date().toISOString(),
    timeout_ms: taskData.timeout_ms || 300000
  });
  
  // Start real-time progress monitoring
  const progressMonitor = setInterval(async () => {
    const taskInfo = activeTasks.get(taskId);
    if (taskInfo) {
      const elapsed = Date.now() - startTime;
      const percentComplete = Math.min(95, Math.floor((elapsed / 120000) * 100)); // Estimate based on time
      
      await reportTaskProgress(taskId, 'in_progress', percentComplete, 
        `Executing MCP tools... (${Math.floor(elapsed/1000)}s elapsed)`, {
        tool_calls: taskInfo.total_tool_calls,
        pages_visited: taskInfo.pages_visited,
        screenshots_taken: taskInfo.screenshots_taken,
        mcp_tools_used: Array.from(taskInfo.mcp_tools_used),
        elapsed_ms: elapsed
      });
    }
  }, CONFIG.progressReportIntervalMs);
  
  try {
    // Update status to busy
    await updateWorkerStatus('busy', taskId);
    
    // Report progress: Starting execution
    await reportTaskProgress(taskId, 'executing', 10, 'Launching cursor-agent with MCP tools');
    
    // Create enhanced MCP task execution script with real-time analytics
    const mcpTaskScript = `
import { spawn } from 'child_process';
import { connect, StringCodec } from 'nats';

const sc = StringCodec();

// Connect to NATS for real-time reporting
const natsConnection = await connect({ servers: '${CONFIG.nats.host}:${CONFIG.nats.port}' });

// Real-time analytics streaming
async function streamAnalytics(data) {
  try {
    await natsConnection.publish(
      'worker.analytics.realtime.${CONFIG.workerId}',
      sc.encode(JSON.stringify({
        task_id: '${taskId}',
        worker_id: '${CONFIG.workerId}',
        timestamp: new Date().toISOString(),
        ...data
      }))
    );
  } catch (error) {
    console.error('Failed to stream analytics:', error.message);
  }
}

// Execute task using MCP tools
async function executeMCPTask() {
  const taskDescription = ${JSON.stringify(taskDescription)};
  const taskId = '${taskId}';
  
  console.log('Executing task with MCP tools and real-time analytics...');
  
  await streamAnalytics({ status: 'started', message: 'Launching cursor-agent' });
  
  // Use cursor-agent with environment variable for MCP config
  const cursorProcess = spawn('cursor-agent', [
    taskDescription,
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
  
  // Real-time analytics tracking
  let outputBuffer = '';
  let toolCallCount = 0;
  let pagesVisited = 0;
  let screenshotsTaken = 0;
  let networkRequests = 0;
  const toolsUsed = new Set();
  let lastReportTime = Date.now();
  
  cursorProcess.stdout.on('data', async (data) => {
    const output = data.toString();
    outputBuffer += output;
    process.stdout.write(output);
    
    // Parse for MCP tool usage analytics (real-time)
    if (output.includes('browser_navigate')) {
      pagesVisited++;
      toolsUsed.add('browser_navigate');
      await streamAnalytics({ 
        event: 'tool_call', 
        tool: 'browser_navigate', 
        pages_visited: pagesVisited,
        message: 'Navigating to URL...'
      });
    }
    
    if (output.includes('browser_screenshot') || output.includes('screenshot')) {
      screenshotsTaken++;
      toolsUsed.add('browser_screenshot');
      await streamAnalytics({ 
        event: 'tool_call', 
        tool: 'browser_screenshot', 
        screenshots_taken: screenshotsTaken,
        message: 'Capturing screenshot...'
      });
    }
    
    if (output.includes('browser_get_page_content')) {
      toolsUsed.add('browser_get_page_content');
      await streamAnalytics({ 
        event: 'tool_call', 
        tool: 'browser_get_page_content',
        message: 'Extracting page content...'
      });
    }
    
    if (output.includes('list_network_requests') || output.includes('network')) {
      networkRequests++;
      toolsUsed.add('list_network_requests');
      await streamAnalytics({ 
        event: 'tool_call', 
        tool: 'list_network_requests',
        network_requests: networkRequests,
        message: 'Capturing network requests...'
      });
    }
    
    if (output.includes('Tool:') || output.includes('mcp_')) {
      toolCallCount++;
      
      // Stream periodic analytics (every 5 seconds)
      if (Date.now() - lastReportTime > 5000) {
        await streamAnalytics({
          status: 'in_progress',
          tool_calls: toolCallCount,
          pages_visited: pagesVisited,
          screenshots_taken: screenshotsTaken,
          network_requests: networkRequests,
          tools_used: Array.from(toolsUsed),
          message: \`Executing... (\${toolCallCount} tool calls)\`
        });
        lastReportTime = Date.now();
      }
    }
  });
  
  cursorProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  return new Promise((resolve, reject) => {
    cursorProcess.on('exit', async (code) => {
      // Final analytics report
      await streamAnalytics({
        status: code === 0 ? 'completed' : 'failed',
        success: code === 0,
        exit_code: code,
        final_metrics: {
          total_tool_calls: toolCallCount,
          pages_visited: pagesVisited,
          screenshots_taken: screenshotsTaken,
          network_requests: networkRequests,
          tools_used: Array.from(toolsUsed),
          output_length: outputBuffer.length
        },
        message: code === 0 ? 'Task completed successfully' : \`Task failed with code \${code}\`
      });
      
      await natsConnection.close();
      
      if (code === 0) {
        resolve({ success: true, exitCode: code, analytics: {
          toolCallCount, pagesVisited, screenshotsTaken, networkRequests, toolsUsed: Array.from(toolsUsed)
        }});
      } else {
        reject(new Error(\`Process exited with code \${code}\`));
      }
    });
    
    cursorProcess.on('error', reject);
  });
}

executeMCPTask()
  .then(result => {
    console.log('✅ Task completed successfully');
    console.log('📊 Final Analytics:', JSON.stringify(result.analytics, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Task failed:', error);
    process.exit(1);
  });
`;

    // Write the script to a temporary file
    const scriptPath = `/tmp/mcp-task-realtime-${taskId}.mjs`;
    fs.writeFileSync(scriptPath, mcpTaskScript);
    
    // Report progress: Script ready
    await reportTaskProgress(taskId, 'executing', 20, 'Task script created, starting execution');
    
    // Execute the script
    console.log('Executing MCP-enabled task with real-time analytics...');
    const taskProcess = spawn('node', [scriptPath], {
      cwd: '/app',
      env: {
        ...process.env,
        NODE_PATH: '/app/node_modules',
        CURSOR_API_KEY: CONFIG.cursorApiKey,
        TASK_ID: taskId,
        WORKER_ID: CONFIG.workerId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    let lastOutputTime = Date.now();
    
    // Stream stdout with analytics
    taskProcess.stdout.on('data', async (data) => {
      const output = data.toString();
      stdout += output;
      console.log(output);
      
      // Update task analytics based on output
      const taskInfo = activeTasks.get(taskId);
      if (taskInfo) {
        // Parse for tool calls in real-time
        if (output.includes('browser_navigate')) taskInfo.pages_visited++;
        if (output.includes('screenshot')) taskInfo.screenshots_taken++;
        if (output.includes('network')) taskInfo.network_requests++;
        if (output.includes('mcp_') || output.includes('Tool:')) taskInfo.total_tool_calls++;
        
        // Extract tool names
        const toolMatch = output.match(/mcp_[\w-]+_[\w-]+/g);
        if (toolMatch) {
          toolMatch.forEach(tool => taskInfo.mcp_tools_used.add(tool));
        }
        
        // Stream update if significant time passed
        if (Date.now() - lastOutputTime > 3000) {
          await streamProgressUpdate(taskId, {
            status: 'executing',
            message: 'Processing with MCP tools',
            tool_calls: taskInfo.total_tool_calls,
            pages_visited: taskInfo.pages_visited,
            screenshots: taskInfo.screenshots_taken,
            tools_used: Array.from(taskInfo.mcp_tools_used)
          });
          lastOutputTime = Date.now();
        }
      }
    });
    
    taskProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(output);
    });
    
    // Store process for tracking
    activeTasks.get(taskId).process = taskProcess;
    
    // Wait for completion
    const exitCode = await new Promise((resolve, reject) => {
      taskProcess.on('exit', (code) => resolve(code));
      taskProcess.on('error', (err) => reject(err));
    });
    
    clearInterval(progressMonitor);
    
    // Clean up script
    try {
      fs.unlinkSync(scriptPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    const endTime = Date.now();
    const executionTime = endTime - startTime;
    
    console.log(`✅ Task completed with exit code: ${exitCode}`);
    console.log(`⏱️  Total execution time: ${executionTime}ms`);
    
    // Get final analytics from task tracking
    const finalAnalytics = activeTasks.get(taskId);
    
    // Report completion with comprehensive analytics
    await reportTaskCompletion(taskId, exitCode === 0, {
      exit_code: exitCode,
      execution_time_ms: executionTime,
      stdout_length: stdout.length,
      stderr_length: stderr.length,
      tool_calls: finalAnalytics.total_tool_calls,
      pages_visited: finalAnalytics.pages_visited,
      screenshots_taken: finalAnalytics.screenshots_taken,
      network_requests: finalAnalytics.network_requests,
      mcp_tools_used: Array.from(finalAnalytics.mcp_tools_used),
    });
    
    // Clean up
    activeTasks.delete(taskId);
    await updateWorkerStatus('idle');
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ MCP Task Completed: ${taskId}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (error) {
    clearInterval(progressMonitor);
    console.error('❌ Task execution error:', error);
    
    await reportTaskCompletion(taskId, false, {
      error: error.message,
      error_stack: error.stack,
    });
    
    activeTasks.delete(taskId);
    await updateWorkerStatus('idle');
  }
}

// Report task completion with final analytics
async function reportTaskCompletion(taskId, success, analytics = {}) {
  try {
    const completionData = {
      task_id: taskId,
      worker_id: CONFIG.workerId,
      success,
      timestamp: new Date().toISOString(),
      analytics,
    };
    
    // Publish completion via NATS
    await natsConnection.publish(
      'task.completion',
      sc.encode(JSON.stringify(completionData))
    );
    
    // Also stream final analytics
    await streamProgressUpdate(taskId, {
      status: success ? 'completed' : 'failed',
      success,
      final_analytics: analytics,
      message: success ? 'Task completed successfully' : 'Task failed'
    });
    
    console.error(`✅ Task completion reported: ${taskId}`);
  } catch (error) {
    console.error('❌ Failed to report completion:', error.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// START MCP SERVERS
// ══════════════════════════════════════════════════════════════════

async function startMCPServers() {
  console.error('\n🚀 Starting MCP servers...');
  
  const mcpConfig = JSON.parse(fs.readFileSync('/root/.cursor/mcp.json', 'utf8'));
  
  for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
    console.error(`  Starting ${serverName}...`);
    
    const mcpProcess = spawn(serverConfig.command, serverConfig.args, {
      env: {
        ...process.env,
        // Pass infrastructure connection details
        NATS_HOST: CONFIG.nats.host,
        NATS_PORT: CONFIG.nats.port.toString(),
        REDIS_HOST: CONFIG.redis.host,
        REDIS_PORT: CONFIG.redis.port.toString(),
        POSTGRES_HOST: CONFIG.postgres.host,
        POSTGRES_PORT: CONFIG.postgres.port.toString(),
        POSTGRES_DB: CONFIG.postgres.database,
        POSTGRES_USER: CONFIG.postgres.user,
        POSTGRES_PASSWORD: CONFIG.postgres.password,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    mcpProcess.stdout.on('data', (data) => {
      console.error(`[${serverName}] ${data.toString().trim()}`);
    });
    
    mcpProcess.stderr.on('data', (data) => {
      console.error(`[${serverName}] ${data.toString().trim()}`);
    });
    
    mcpProcesses.set(serverName, mcpProcess);
    console.error(`  ✅ ${serverName} started`);
  }
}

// ══════════════════════════════════════════════════════════════════
// WORKER REGISTRATION
// ══════════════════════════════════════════════════════════════════

async function registerWorker() {
  console.error('\n📝 Registering MCP-enabled worker with manager...');
  
  const registrationData = {
    worker_id: CONFIG.workerId,
    hostname: CONFIG.hostname,
    manager_host: CONFIG.managerHost,
    status: 'idle',
    active_tasks: 0,
    capabilities: CONFIG.capabilities,
    system_info: {
      arch: os.arch(),
      cpus: os.cpus().length,
      platform: os.platform(),
      nodeVersion: process.version,
      totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    },
    mcp_servers_running: Array.from(mcpProcesses.keys()),
    metadata: {
      mcp_enabled: true,
      mcp_servers: CONFIG.capabilities.mcpServers,
      realtime_analytics: true,
    },
  };
  
  // Register via NATS
  await natsConnection.publish(
    'remote.worker.register',
    sc.encode(JSON.stringify(registrationData))
  );
  
  // Update Redis
  await redis.set(`remote_worker:${CONFIG.workerId}`, JSON.stringify(registrationData));
  
  console.error('✅ MCP Worker registered successfully');
  console.error(`   Worker ID: ${CONFIG.workerId}`);
  console.error(`   MCP Enabled: true`);
  console.error(`   Real-Time Analytics: ENABLED`);
  console.error(`   Status: Ready (NATS + Redis ${pgPool ? '+ PostgreSQL' : ''})`);
}

// ══════════════════════════════════════════════════════════════════
// TASK SUBSCRIPTION
// ══════════════════════════════════════════════════════════════════

async function setupTaskSubscription() {
  console.error('📡 Setting up NATS subscriptions...');
  
  const taskSub = natsConnection.subscribe(`worker.task.${CONFIG.workerId}`);
  console.error(`✅ Subscribed to worker.task.${CONFIG.workerId}`);
  
  (async () => {
    for await (const msg of taskSub) {
      try {
        const taskData = JSON.parse(sc.decode(msg.data));
        console.error(`\n📨 Received task assignment: ${taskData.task_id}`);
        
        // Check capacity
        if (activeTasks.size >= CONFIG.maxConcurrentTasks) {
          console.error(`⚠️  Worker at capacity (${activeTasks.size}/${CONFIG.maxConcurrentTasks})`);
          
          // Send rejection via NATS
          await natsConnection.publish(
            `task.rejected.${taskData.task_id}`,
            sc.encode(JSON.stringify({
              worker_id: CONFIG.workerId,
              task_id: taskData.task_id,
              reason: 'Worker at maximum capacity',
              max_capacity: CONFIG.maxConcurrentTasks,
              current_tasks: activeTasks.size,
            }))
          );
          continue;
        }
        
        // Execute task asynchronously with real-time analytics
        executeTaskWithMCP(taskData).catch(error => {
          console.error(`❌ Task execution failed: ${error.message}`);
        });
        
      } catch (error) {
        console.error('❌ Error processing task:', error);
      }
    }
  })();
  
  console.error('\n✅ MCP-Enabled Worker ready!');
  console.error('   Waiting for task assignments with real-time analytics streaming...\n');
}

// ══════════════════════════════════════════════════════════════════
// HEARTBEAT
// ══════════════════════════════════════════════════════════════════

function startHeartbeat() {
  setInterval(async () => {
    try {
      await updateWorkerStatus(activeTasks.size > 0 ? 'busy' : 'idle');
    } catch (error) {
      console.error('❌ Heartbeat failed:', error.message);
    }
  }, CONFIG.heartbeatIntervalMs);
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

async function main() {
  // Connect to infrastructure
  const natsOk = await connectNATS();
  const redisOk = await connectRedis();
  const pgOk = await connectPostgreSQL();
  
  if (!natsOk || !redisOk) {
    console.error('❌ Critical services unavailable. Exiting.');
    process.exit(1);
  }
  
  // Start MCP servers
  await startMCPServers();
  
  // Wait a moment for MCP servers to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Register worker
  await registerWorker();
  
  // Setup task subscription
  await setupTaskSubscription();
  
  // Start heartbeat
  startHeartbeat();
}

main().catch(error => {
  console.error('❌ Worker failed to start:', error);
  process.exit(1);
});

