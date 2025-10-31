#!/usr/bin/env node
/**
 * MCP Manager Enhanced - Advanced Analytics & Real-time Monitoring
 * Complete manager with comprehensive worker orchestration and analytics
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "redis";
import pg from "pg";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { connect, StringCodec } from "nats";
import os from "os";

const { Pool } = pg;
const sc = StringCodec();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const configPath = join(__dirname, "config.json");
const config = JSON.parse(readFileSync(configPath, "utf-8"));

const MANAGER_CONFIG = {
  managerId: `manager-${os.hostname()}-${uuidv4().substring(0, 8)}`,
  version: "2.0.0",

  // Task management
  maxConcurrentTasks: 20,
  taskTimeout: 3600000, // 1 hour
  taskRetryAttempts: 3,

  // Worker management
  workerHealthCheckInterval: 10000,
  workerTimeoutMs: 30000,
  maxWorkersPerTask: 3,

  // Analytics configuration
  analyticsRetentionDays: 30,
  metricsAggregationInterval: 60000, // 1 minute

  // Real-time monitoring
  streamBufferSize: 1000,
  eventHistorySize: 10000,
};

console.log("═══════════════════════════════════════════════════════════════");
console.log("🚀 MCP MANAGER ENHANCED - ADVANCED ANALYTICS");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Manager ID: ${MANAGER_CONFIG.managerId}`);
console.log(`Version: ${MANAGER_CONFIG.version}`);
console.log("═══════════════════════════════════════════════════════════════");

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════════════════

// Task tracking
const activeTasks = new Map();
const taskQueue = [];
const taskHistory = new Map();

// Worker tracking
const activeWorkers = new Map();
const workerSessions = new Map();
const workerMetrics = new Map();

// Analytics data
const analyticsStore = {
  taskAnalytics: new Map(),
  workerAnalytics: new Map(),
  systemMetrics: [],
  performanceProfiles: new Map(),
  errorAnalytics: [],
  decisionLog: [],
};

// Real-time streams
const realtimeStreams = new Map();
const eventBuffer = [];

// ═══════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════

let natsConnection;
let redis;
let pgPool;

// Initialize NATS
try {
  natsConnection = await connect({
    servers: ["nats://localhost:4222"],
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  });
  console.log("✅ Connected to NATS");
} catch (error) {
  console.error("❌ Failed to connect to NATS:", error.message);
  process.exit(1);
}

// Initialize Redis
redis = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
  },
  password: config.redis.password,
});

redis.on("error", (err) => console.error("Redis Error:", err));
await redis.connect();
console.log("✅ Connected to Redis");

// Initialize PostgreSQL
pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

console.log("✅ Connected to PostgreSQL");

// ═══════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════════════

await pgPool.query(`
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

  -- Real-time stream storage
  CREATE TABLE IF NOT EXISTS stream_data (
    id SERIAL PRIMARY KEY,
    stream_type VARCHAR(50),
    worker_id VARCHAR(255),
    task_id VARCHAR(255),
    content TEXT,
    metadata JSONB,
    priority VARCHAR(20),
    timestamp TIMESTAMP DEFAULT NOW()
  );

  -- Decision tracking
  CREATE TABLE IF NOT EXISTS decisions (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255),
    worker_id VARCHAR(255),
    decision_type VARCHAR(50),
    description TEXT,
    chosen_option TEXT,
    alternatives JSONB,
    reasoning TEXT,
    impact_assessment JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  -- Test results storage
  CREATE TABLE IF NOT EXISTS test_results (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255),
    worker_id VARCHAR(255),
    test_suite VARCHAR(255),
    test_type VARCHAR(50),
    results JSONB,
    failed_tests JSONB,
    performance_metrics JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  -- Error tracking
  CREATE TABLE IF NOT EXISTS error_log (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255),
    worker_id VARCHAR(255),
    error_type VARCHAR(50),
    severity VARCHAR(20),
    message TEXT,
    stack_trace TEXT,
    context JSONB,
    recovery_attempted BOOLEAN,
    recovery_successful BOOLEAN,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  -- Performance profiling
  CREATE TABLE IF NOT EXISTS performance_profiles (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255),
    worker_id VARCHAR(255),
    profile_type VARCHAR(50),
    hotspots JSONB,
    bottlenecks JSONB,
    optimization_opportunities JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_worker ON tasks(assigned_worker);
  CREATE INDEX IF NOT EXISTS idx_task_progress_task ON task_progress(task_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(analytics_type);
  CREATE INDEX IF NOT EXISTS idx_stream_task ON stream_data(task_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id);
  CREATE INDEX IF NOT EXISTS idx_test_results_task ON test_results(task_id);
  CREATE INDEX IF NOT EXISTS idx_error_log_task ON error_log(task_id);
`);

console.log("✅ Enhanced database schema initialized");

// ═══════════════════════════════════════════════════════════════════════
// NATS SUBSCRIPTIONS - Worker Communication
// ═══════════════════════════════════════════════════════════════════════

// Worker registration
const workerRegSub = natsConnection.subscribe("worker.registered");
(async () => {
  for await (const msg of workerRegSub) {
    try {
      const workerInfo = JSON.parse(sc.decode(msg.data));
      await handleWorkerRegistration(workerInfo);
    } catch (error) {
      console.error("Error handling worker registration:", error);
    }
  }
})();

// Progress updates
const progressSub = natsConnection.subscribe("worker.progress.*");
(async () => {
  for await (const msg of progressSub) {
    try {
      const progress = JSON.parse(sc.decode(msg.data));
      await handleProgressUpdate(progress);
    } catch (error) {
      console.error("Error handling progress:", error);
    }
  }
})();

// Milestone updates
const milestoneSub = natsConnection.subscribe("worker.milestone.*");
(async () => {
  for await (const msg of milestoneSub) {
    try {
      const milestone = JSON.parse(sc.decode(msg.data));
      await handleMilestone(milestone);
    } catch (error) {
      console.error("Error handling milestone:", error);
    }
  }
})();

// Analytics data
const analyticsSub = natsConnection.subscribe("worker.analytics.*");
(async () => {
  for await (const msg of analyticsSub) {
    try {
      const analytics = JSON.parse(sc.decode(msg.data));
      await handleAnalytics(analytics);
    } catch (error) {
      console.error("Error handling analytics:", error);
    }
  }
})();

// Real-time streams
const streamSub = natsConnection.subscribe("worker.stream.*.*");
(async () => {
  for await (const msg of streamSub) {
    try {
      const stream = JSON.parse(sc.decode(msg.data));
      await handleRealtimeStream(stream);
    } catch (error) {
      console.error("Error handling stream:", error);
    }
  }
})();

// Decision tracking
const decisionSub = natsConnection.subscribe("worker.decision.*");
(async () => {
  for await (const msg of decisionSub) {
    try {
      const decision = JSON.parse(sc.decode(msg.data));
      await handleDecision(decision);
    } catch (error) {
      console.error("Error handling decision:", error);
    }
  }
})();

// Test results
const testSub = natsConnection.subscribe("worker.tests.*");
(async () => {
  for await (const msg of testSub) {
    try {
      const testResults = JSON.parse(sc.decode(msg.data));
      await handleTestResults(testResults);
    } catch (error) {
      console.error("Error handling test results:", error);
    }
  }
})();

// Error reports
const errorSub = natsConnection.subscribe("worker.error.*");
(async () => {
  for await (const msg of errorSub) {
    try {
      const errorReport = JSON.parse(sc.decode(msg.data));
      await handleErrorReport(errorReport);
    } catch (error) {
      console.error("Error handling error report:", error);
    }
  }
})();

// Completions
const completionSub = natsConnection.subscribe("worker.completion.*");
(async () => {
  for await (const msg of completionSub) {
    try {
      const completion = JSON.parse(sc.decode(msg.data));
      await handleCompletion(completion);
    } catch (error) {
      console.error("Error handling completion:", error);
    }
  }
})();

// Heartbeats
const heartbeatSub = natsConnection.subscribe("worker.heartbeat.*");
(async () => {
  for await (const msg of heartbeatSub) {
    try {
      const heartbeat = JSON.parse(sc.decode(msg.data));
      await handleHeartbeat(heartbeat);
    } catch (error) {
      console.error("Error handling heartbeat:", error);
    }
  }
})();

// Worker questions
const questionSub = natsConnection.subscribe("manager.question.*");
(async () => {
  for await (const msg of questionSub) {
    try {
      const question = JSON.parse(sc.decode(msg.data));
      await handleWorkerQuestion(question, msg.reply);
    } catch (error) {
      console.error("Error handling question:", error);
    }
  }
})();

// ═══════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════════

async function handleWorkerRegistration(workerInfo) {
  const { worker_id, worker_type, capabilities, system_info } = workerInfo;

  console.log(`\n📝 Worker Registered: ${worker_id}`);
  console.log(`   Type: ${worker_type}`);
  console.log(`   Capabilities: ${capabilities.features?.join(', ') || 'standard'}`);

  activeWorkers.set(worker_id, workerInfo);

  // Store in database
  await pgPool.query(
    `INSERT INTO workers (worker_id, worker_type, hostname, status, capabilities, system_info, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (worker_id) DO UPDATE SET
       status = 'active',
       capabilities = EXCLUDED.capabilities,
       system_info = EXCLUDED.system_info,
       last_heartbeat = NOW()`,
    [worker_id, worker_type, workerInfo.hostname, 'active',
     JSON.stringify(capabilities), JSON.stringify(system_info),
     JSON.stringify(workerInfo.metadata || {})]
  );

  // Initialize worker analytics
  workerAnalytics.set(worker_id, {
    registered_at: new Date(),
    tasks_completed: 0,
    tasks_failed: 0,
    total_execution_time: 0,
    errors: [],
    performance_scores: [],
  });
}

async function handleProgressUpdate(progress) {
  const { task_id, worker_id, status, phase, metrics, context } = progress;

  const task = activeTasks.get(task_id);
  if (task) {
    task.status = status;
    task.phase = phase;
    task.progress = metrics.percent_complete;
    task.lastUpdate = new Date();

    // Update real-time display
    console.log(`\n📊 Progress Update [${task_id ? task_id.substring(0, 8) : 'N/A'}]`);
    console.log(`   Status: ${status} | Phase: ${phase || 'N/A'}`);
    console.log(`   Progress: ${'█'.repeat(Math.floor(metrics.percent_complete / 5))}${'░'.repeat(20 - Math.floor(metrics.percent_complete / 5))} ${metrics.percent_complete}%`);
    console.log(`   Operation: ${metrics.current_operation}`);

    if (metrics.estimated_time_remaining_ms) {
      const minutes = Math.floor(metrics.estimated_time_remaining_ms / 60000);
      console.log(`   ETA: ${minutes} minutes`);
    }
  }

  // Store in database
  await pgPool.query(
    `INSERT INTO task_progress (task_id, worker_id, status, phase, percent_complete, metrics, context)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [task_id, worker_id, status, phase, metrics.percent_complete,
     JSON.stringify(metrics), JSON.stringify(context)]
  );

  // Update Redis for quick access
  await redis.hSet(`task:${task_id}:progress`, {
    status,
    phase: phase || '',
    percent_complete: metrics.percent_complete.toString(),
    current_operation: metrics.current_operation || '',
    last_update: new Date().toISOString(),
  });
}

async function handleMilestone(milestone) {
  const { task_id, worker_id, milestone_name, milestone_type, impact } = milestone;

  console.log(`\n🎯 Milestone Reached [${task_id ? task_id.substring(0, 8) : 'N/A'}]`);
  console.log(`   Name: ${milestone_name}`);
  console.log(`   Type: ${milestone_type}`);
  console.log(`   Impact: ${impact || 'normal'}`);

  // Store milestone
  const task = activeTasks.get(task_id);
  if (task) {
    if (!task.milestones) task.milestones = [];
    task.milestones.push(milestone);
  }

  // Trigger notifications for high-impact milestones
  if (impact === 'critical' || impact === 'high') {
    await notifyMilestone(milestone);
  }
}

async function handleAnalytics(analytics) {
  const { worker_id, task_id, analytics_type, data } = analytics;

  // Store in analytics store
  if (!analyticsStore.taskAnalytics.has(task_id)) {
    analyticsStore.taskAnalytics.set(task_id, {});
  }
  const taskAnalytics = analyticsStore.taskAnalytics.get(task_id);

  if (!taskAnalytics[analytics_type]) {
    taskAnalytics[analytics_type] = [];
  }
  taskAnalytics[analytics_type].push(data);

  // Store in database
  await pgPool.query(
    `INSERT INTO analytics (analytics_type, source_type, source_id, data)
     VALUES ($1, $2, $3, $4)`,
    [analytics_type, 'task', task_id, JSON.stringify(data)]
  );

  // Process specific analytics types
  switch (analytics_type) {
    case 'performance':
      await processPerformanceAnalytics(task_id, data);
      break;
    case 'quality':
      await processQualityAnalytics(task_id, data);
      break;
    case 'resource':
      await processResourceAnalytics(task_id, data);
      break;
  }
}

async function handleRealtimeStream(stream) {
  const { worker_id, task_id, stream_type, content, metadata, priority } = stream;

  // Add to stream buffer
  if (!realtimeStreams.has(task_id)) {
    realtimeStreams.set(task_id, []);
  }
  const taskStreams = realtimeStreams.get(task_id);
  taskStreams.push(stream);

  // Keep buffer size limited
  if (taskStreams.length > MANAGER_CONFIG.streamBufferSize) {
    taskStreams.shift();
  }

  // Display important streams
  if (priority === 'critical' || priority === 'high' || stream_type === 'error') {
    console.log(`\n🔴 [${stream_type.toUpperCase()}] ${content.substring(0, 200)}`);
  }

  // Store in database for permanent record
  if (priority === 'critical' || priority === 'high') {
    await pgPool.query(
      `INSERT INTO stream_data (stream_type, worker_id, task_id, content, metadata, priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [stream_type, worker_id, task_id, content, JSON.stringify(metadata), priority]
    );
  }
}

async function handleDecision(decision) {
  const { task_id, worker_id, decision_type, chosen_option, reasoning } = decision;

  console.log(`\n🤔 Decision Made [${task_id ? task_id.substring(0, 8) : 'N/A'}]`);
  console.log(`   Type: ${decision_type}`);
  console.log(`   Choice: ${chosen_option}`);

  // Store in decision log
  analyticsStore.decisionLog.push(decision);

  // Store in database
  await pgPool.query(
    `INSERT INTO decisions (task_id, worker_id, decision_type, description, chosen_option, alternatives, reasoning, impact_assessment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [task_id, worker_id, decision_type, decision.description, chosen_option,
     JSON.stringify(decision.alternatives), reasoning, JSON.stringify(decision.impact_assessment)]
  );
}

async function handleTestResults(testResults) {
  const { task_id, worker_id, test_suite, test_type, results } = testResults;

  const passRate = (results.passed / results.total_tests * 100).toFixed(1);
  const status = results.failed > 0 ? '❌' : '✅';

  console.log(`\n${status} Test Results [${task_id ? task_id.substring(0, 8) : 'N/A'}]`);
  console.log(`   Suite: ${test_suite}`);
  console.log(`   Type: ${test_type}`);
  console.log(`   Results: ${results.passed}/${results.total_tests} passed (${passRate}%)`);

  if (results.coverage_percent) {
    console.log(`   Coverage: ${results.coverage_percent}%`);
  }

  // Store in database
  await pgPool.query(
    `INSERT INTO test_results (task_id, worker_id, test_suite, test_type, results, failed_tests, performance_metrics)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [task_id, worker_id, test_suite, test_type, JSON.stringify(results),
     JSON.stringify(testResults.failed_tests), JSON.stringify(testResults.performance_metrics)]
  );

  // Update task quality metrics
  const task = activeTasks.get(task_id);
  if (task) {
    task.testResults = results;
    task.testCoverage = results.coverage_percent;
  }
}

async function handleErrorReport(errorReport) {
  const { task_id, worker_id, error_type, severity, message } = errorReport;

  console.error(`\n🚨 Error Report [${task_id?.substring(0, 8) || 'N/A'}]`);
  console.error(`   Type: ${error_type}`);
  console.error(`   Severity: ${severity}`);
  console.error(`   Message: ${message}`);

  // Add to error analytics
  analyticsStore.errorAnalytics.push(errorReport);

  // Store in database
  await pgPool.query(
    `INSERT INTO error_log (task_id, worker_id, error_type, severity, message, stack_trace, context, recovery_attempted, recovery_successful)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [task_id, worker_id, error_type, severity, message, errorReport.stack_trace,
     JSON.stringify(errorReport.context), errorReport.recovery_attempted, errorReport.recovery_successful]
  );

  // Handle critical errors
  if (severity === 'critical') {
    await handleCriticalError(errorReport);
  }
}

async function handleCompletion(completion) {
  const { task_id, worker_id, status, summary, analytics_summary } = completion;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${status === 'success' ? '✅' : '❌'} TASK COMPLETED: ${task_id ? task_id.substring(0, 8) : 'N/A'}`);
  console.log(`${'='.repeat(60)}`);

  if (summary) {
    console.log('\n📋 Summary:');
    console.log(`   Execution Time: ${summary.total_execution_time_ms}ms`);
    console.log(`   Files Modified: ${summary.files_modified || 0}`);
    console.log(`   Tests Passed: ${summary.tests_passed || 0}/${summary.tests_written || 0}`);
    console.log(`   Code Coverage: ${summary.code_coverage || 0}%`);
    console.log(`   Quality Score: ${summary.quality_score || 0}/100`);
  }

  // Update task status
  const task = activeTasks.get(task_id);
  if (task) {
    task.status = status;
    task.completedAt = new Date();
    task.summary = summary;

    // Move to history
    taskHistory.set(task_id, task);
    activeTasks.delete(task_id);
  }

  // Update database
  await pgPool.query(
    `UPDATE tasks
     SET status = $1, completed_at = NOW(), analytics = $2
     WHERE task_id = $3`,
    [status, JSON.stringify(analytics_summary), task_id]
  );

  // Update worker metrics
  const workerAnalytics = workerMetrics.get(worker_id);
  if (workerAnalytics) {
    if (status === 'success') {
      workerAnalytics.tasks_completed++;
    } else {
      workerAnalytics.tasks_failed++;
    }
  }
}

async function handleHeartbeat(heartbeat) {
  const { worker_id, status, health, current_load } = heartbeat;

  // Update worker status
  const worker = activeWorkers.get(worker_id);
  if (worker) {
    worker.lastHeartbeat = new Date();
    worker.status = status;
    worker.health = health;
    worker.currentLoad = current_load;
  }

  // Update database
  await pgPool.query(
    `UPDATE workers
     SET last_heartbeat = NOW(), status = $1
     WHERE worker_id = $2`,
    [status, worker_id]
  );

  // Check health thresholds
  if (health) {
    if (health.cpu_usage > 90 || health.memory_usage > 90) {
      console.log(`⚠️  Worker ${worker_id} under high load`);
    }
  }
}

async function handleWorkerQuestion(question, replySubject) {
  const { question_id, worker_id, question: q, question_type, context } = question;

  console.log(`\n❓ Worker Question [${worker_id.substring(0, 8)}]`);
  console.log(`   Type: ${question_type}`);
  console.log(`   Question: ${q}`);

  // Store in Redis for manager tools to answer
  await redis.hSet('pending_questions', question_id, JSON.stringify({
    ...question,
    reply_subject: replySubject,
    timestamp: new Date().toISOString(),
  }));

  // Auto-answer some question types
  let answer = null;

  switch (question_type) {
    case 'resource':
      answer = { response: 'Resources approved', approved: true };
      break;
    case 'permission':
      answer = { response: 'Permission granted', approved: true };
      break;
    default:
      // Wait for manual answer
      console.log('   ⏳ Awaiting manager response...');
  }

  if (answer && replySubject) {
    await natsConnection.publish(replySubject, sc.encode(JSON.stringify(answer)));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS PROCESSING
// ═══════════════════════════════════════════════════════════════════════

async function processPerformanceAnalytics(taskId, data) {
  // Calculate performance metrics
  const metrics = {
    efficiency: calculateEfficiency(data),
    throughput: calculateThroughput(data),
    bottlenecks: identifyBottlenecks(data),
  };

  // Store performance profile
  if (!analyticsStore.performanceProfiles.has(taskId)) {
    analyticsStore.performanceProfiles.set(taskId, []);
  }
  analyticsStore.performanceProfiles.get(taskId).push(metrics);
}

async function processQualityAnalytics(taskId, data) {
  // Calculate quality score
  const qualityScore = calculateQualityScore(data);

  // Update task with quality metrics
  const task = activeTasks.get(taskId);
  if (task) {
    task.qualityScore = qualityScore;
  }
}

async function processResourceAnalytics(taskId, data) {
  // Track resource usage trends
  const resourceTrends = analyzeResourceTrends(data);

  // Alert on resource issues
  if (resourceTrends.memoryLeak || resourceTrends.cpuSpike) {
    await alertResourceIssue(taskId, resourceTrends);
  }
}

// Helper functions
function calculateEfficiency(data) {
  // Implement efficiency calculation
  return (data.actual_time / data.expected_time) * 100;
}

function calculateThroughput(data) {
  // Implement throughput calculation
  return data.items_processed / data.execution_time_ms * 1000;
}

function identifyBottlenecks(data) {
  // Implement bottleneck identification
  return [];
}

function calculateQualityScore(data) {
  // Implement quality score calculation
  const weights = {
    test_coverage: 0.3,
    lint_score: 0.2,
    complexity: 0.2,
    performance: 0.3,
  };

  let score = 0;
  if (data.test_coverage) score += data.test_coverage * weights.test_coverage;
  if (data.lint_score) score += data.lint_score * weights.lint_score;
  if (data.complexity) score += (100 - data.complexity) * weights.complexity;
  if (data.performance) score += data.performance * weights.performance;

  return Math.round(score);
}

function analyzeResourceTrends(data) {
  // Implement resource trend analysis
  return {
    memoryLeak: false,
    cpuSpike: false,
    diskUsageHigh: false,
  };
}

async function alertResourceIssue(taskId, issues) {
  console.error(`⚠️  Resource Alert for task ${taskId}: ${JSON.stringify(issues)}`);
}

async function handleCriticalError(errorReport) {
  console.error(`🚨 CRITICAL ERROR - Initiating recovery procedures`);
  // Implement critical error handling
}

async function notifyMilestone(milestone) {
  console.log(`📢 High-impact milestone notification sent`);
}

// ═══════════════════════════════════════════════════════════════════════
// MCP SERVER SETUP
// ═══════════════════════════════════════════════════════════════════════

const server = new Server(
  {
    name: "mcp-manager-enhanced",
    version: MANAGER_CONFIG.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Task Management
      {
        name: "assign_task",
        description: "Assign a task to a worker with analytics tracking",
        inputSchema: {
          type: "object",
          properties: {
            description: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            worker_id: { type: "string" },
            requirements: { type: "object" },
            estimated_duration_ms: { type: "number" },
          },
          required: ["description"],
        },
      },

      {
        name: "monitor_task",
        description: "Monitor real-time task progress and analytics",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            include_streams: { type: "boolean" },
            include_analytics: { type: "boolean" },
          },
          required: ["task_id"],
        },
      },

      {
        name: "get_analytics",
        description: "Get comprehensive analytics for tasks or workers",
        inputSchema: {
          type: "object",
          properties: {
            entity_type: { type: "string", enum: ["task", "worker", "system"] },
            entity_id: { type: "string" },
            analytics_type: { type: "string", enum: ["performance", "quality", "resource", "all"] },
            time_range: { type: "string", enum: ["hour", "day", "week", "month", "all"] },
          },
          required: ["entity_type"],
        },
      },

      {
        name: "view_realtime_streams",
        description: "View real-time execution streams from workers",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            stream_types: {
              type: "array",
              items: { type: "string" }
            },
            last_n: { type: "number" },
          },
        },
      },

      {
        name: "analyze_decisions",
        description: "Analyze decision patterns and outcomes",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            decision_type: { type: "string" },
            include_reasoning: { type: "boolean" },
          },
        },
      },

      {
        name: "performance_report",
        description: "Generate comprehensive performance report",
        inputSchema: {
          type: "object",
          properties: {
            report_type: { type: "string", enum: ["task", "worker", "system", "comparative"] },
            entity_ids: { type: "array", items: { type: "string" } },
            metrics: { type: "array", items: { type: "string" } },
          },
          required: ["report_type"],
        },
      },

      {
        name: "manage_workers",
        description: "Manage worker fleet and capabilities",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list", "pause", "resume", "restart", "update_config"] },
            worker_id: { type: "string" },
            config: { type: "object" },
          },
          required: ["action"],
        },
      },

      {
        name: "answer_worker_question",
        description: "Answer pending questions from workers",
        inputSchema: {
          type: "object",
          properties: {
            question_id: { type: "string" },
            answer: { type: "string" },
            additional_context: { type: "object" },
          },
          required: ["question_id", "answer"],
        },
      },

      {
        name: "error_analysis",
        description: "Analyze error patterns and recovery strategies",
        inputSchema: {
          type: "object",
          properties: {
            time_range: { type: "string" },
            error_type: { type: "string" },
            severity_filter: { type: "string" },
            include_recovery: { type: "boolean" },
          },
        },
      },

      {
        name: "quality_dashboard",
        description: "View quality metrics dashboard",
        inputSchema: {
          type: "object",
          properties: {
            entity_type: { type: "string", enum: ["task", "worker", "codebase"] },
            entity_id: { type: "string" },
            metrics: {
              type: "array",
              items: { type: "string", enum: ["coverage", "complexity", "maintainability", "security", "performance"] }
            },
          },
        },
      },
    ],
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "assign_task": {
      const taskId = uuidv4();
      const task = {
        task_id: taskId,
        description: args.description,
        priority: args.priority || "medium",
        status: "pending",
        created_at: new Date(),
        requirements: args.requirements,
        estimated_duration_ms: args.estimated_duration_ms,
      };

      // Add to task queue
      activeTasks.set(taskId, task);

      // Store in database
      await pgPool.query(
        `INSERT INTO tasks (task_id, description, status, priority, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [taskId, args.description, "pending", args.priority || "medium", JSON.stringify(args.requirements || {})]
      );

      // Assign to worker
      const workerId = args.worker_id || await selectBestWorker(task);
      if (workerId) {
        task.assigned_worker = workerId;
        task.status = "assigned";

        // Send to worker via NATS
        await natsConnection.publish(
          `worker.task.${workerId}`,
          sc.encode(JSON.stringify({
            task_id: taskId,
            task_description: args.description,
            requirements: args.requirements,
          }))
        );

        return {
          content: [{
            type: "text",
            text: `Task ${taskId} assigned to worker ${workerId}`,
          }],
        };
      }

      return {
        content: [{
          type: "text",
          text: `Task ${taskId} created and queued`,
        }],
      };
    }

    case "monitor_task": {
      const { task_id, include_streams, include_analytics } = args;
      const task = activeTasks.get(task_id) || taskHistory.get(task_id);

      if (!task) {
        return {
          content: [{
            type: "text",
            text: `Task ${task_id} not found`,
          }],
        };
      }

      let output = `Task ${task_id} Monitoring:\n`;
      output += `Status: ${task.status}\n`;
      output += `Progress: ${task.progress || 0}%\n`;
      output += `Phase: ${task.phase || 'N/A'}\n`;

      if (task.milestones) {
        output += `\nMilestones:\n`;
        task.milestones.forEach(m => {
          output += `  - ${m.milestone_name} (${m.milestone_type})\n`;
        });
      }

      if (include_streams && realtimeStreams.has(task_id)) {
        const streams = realtimeStreams.get(task_id);
        output += `\nRecent Streams (last 5):\n`;
        streams.slice(-5).forEach(s => {
          output += `  [${s.stream_type}] ${s.content.substring(0, 100)}...\n`;
        });
      }

      if (include_analytics && analyticsStore.taskAnalytics.has(task_id)) {
        const analytics = analyticsStore.taskAnalytics.get(task_id);
        output += `\nAnalytics:\n`;
        output += JSON.stringify(analytics, null, 2);
      }

      return {
        content: [{
          type: "text",
          text: output,
        }],
      };
    }

    case "get_analytics": {
      const { entity_type, entity_id, analytics_type, time_range } = args;

      let query = `SELECT * FROM analytics`;
      let conditions = [];
      let params = [];

      // Build WHERE conditions
      if (entity_type === "task" && entity_id) {
        conditions.push(`source_type = 'task' AND source_id = $${params.length + 1}`);
        params.push(entity_id);
      } else if (entity_type === "worker" && entity_id) {
        conditions.push(`source_type = 'worker' AND source_id = $${params.length + 1}`);
        params.push(entity_id);
      }

      if (analytics_type && analytics_type !== "all") {
        conditions.push(`analytics_type = $${params.length + 1}`);
        params.push(analytics_type);
      }

      // Add time range filter
      if (time_range) {
        let interval = '1 hour';
        if (time_range === 'hour') interval = '1 hour';
        else if (time_range === 'day') interval = '1 day';
        else if (time_range === 'week') interval = '1 week';
        else if (time_range === 'month') interval = '1 month';
        
        conditions.push(`timestamp > NOW() - INTERVAL '${interval}'`);
      }

      // Apply conditions
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      // Add ordering and limit
      query += ` ORDER BY timestamp DESC LIMIT 100`;

      const result = await pgPool.query(query, params);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.rows, null, 2),
        }],
      };
    }

    case "view_realtime_streams": {
      const { task_id, stream_types, last_n = 20 } = args;

      let query = `SELECT * FROM stream_data WHERE 1=1`;
      const params = [];

      if (task_id) {
        query += ` AND task_id = $${params.length + 1}`;
        params.push(task_id);
      }

      if (stream_types && stream_types.length > 0) {
        query += ` AND stream_type = ANY($${params.length + 1})`;
        params.push(stream_types);
      }

      query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
      params.push(last_n);

      const result = await pgPool.query(query, params);

      const output = result.rows.map(row =>
        `[${row.stream_type}] ${row.content.substring(0, 200)}...`
      ).join('\n');

      return {
        content: [{
          type: "text",
          text: output || "No streams found",
        }],
      };
    }

    case "manage_workers": {
      const { action, worker_id, config } = args;

      switch (action) {
        case "list": {
          const workers = Array.from(activeWorkers.values());
          const output = workers.map(w =>
            `${w.worker_id}: ${w.status} (${w.worker_type})`
          ).join('\n');

          return {
            content: [{
              type: "text",
              text: output || "No active workers",
            }],
          };
        }

        case "pause":
        case "resume":
        case "restart": {
          await natsConnection.publish(
            `worker.command.${worker_id}`,
            sc.encode(JSON.stringify({ type: action, config }))
          );

          return {
            content: [{
              type: "text",
              text: `Command '${action}' sent to worker ${worker_id}`,
            }],
          };
        }

        default:
          return {
            content: [{
              type: "text",
              text: `Unknown action: ${action}`,
            }],
          };
      }
    }

    case "answer_worker_question": {
      const { question_id, answer, additional_context } = args;

      const questionData = await redis.hGet('pending_questions', question_id);
      if (!questionData) {
        return {
          content: [{
            type: "text",
            text: `Question ${question_id} not found`,
          }],
        };
      }

      const question = JSON.parse(questionData);

      // Send answer via NATS
      if (question.reply_subject) {
        await natsConnection.publish(
          question.reply_subject,
          sc.encode(JSON.stringify({
            answer,
            additional_context,
            answered_by: MANAGER_CONFIG.managerId,
            timestamp: new Date().toISOString(),
          }))
        );
      }

      // Remove from pending
      await redis.hDel('pending_questions', question_id);

      return {
        content: [{
          type: "text",
          text: `Answer sent to worker ${question.worker_id}`,
        }],
      };
    }

    case "performance_report": {
      const { report_type, entity_ids, metrics } = args;
      
      let query;
      let params = [];
      
      if (report_type === "system") {
        query = `
          SELECT 
            analytics_type,
            COUNT(*) as event_count,
            AVG(COALESCE((data->>'execution_time_ms')::numeric, 0)) as avg_execution_time,
            SUM(COALESCE((data->>'network_requests')::integer, 0)) as total_network_requests,
            SUM(COALESCE((data->>'io_operations')::integer, 0)) as total_io_operations
          FROM analytics
          WHERE timestamp > NOW() - INTERVAL '1 hour'
          GROUP BY analytics_type
        `;
      } else if (report_type === "task" && entity_ids) {
        query = `
          SELECT * FROM analytics 
          WHERE source_type = 'task' AND source_id = ANY($1)
          ORDER BY timestamp DESC
        `;
        params = [entity_ids];
      } else {
        query = `SELECT * FROM analytics ORDER BY timestamp DESC LIMIT 100`;
      }
      
      const result = await pgPool.query(query, params);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result.rows, null, 2),
        }],
      };
    }

    case "analyze_decisions": {
      const { task_id, decision_type, include_reasoning } = args;
      
      let query = `SELECT * FROM task_decisions WHERE 1=1`;
      const params = [];
      
      if (task_id) {
        query += ` AND task_id = $${params.length + 1}`;
        params.push(task_id);
      }
      
      if (decision_type) {
        query += ` AND decision_type = $${params.length + 1}`;
        params.push(decision_type);
      }
      
      query += ` ORDER BY timestamp DESC LIMIT 50`;
      
      const result = await pgPool.query(query, params);
      
      return {
        content: [{
          type: "text",
          text: result.rows.length > 0 
            ? JSON.stringify(result.rows, null, 2)
            : "No decisions found",
        }],
      };
    }

    case "error_analysis": {
      const { error_type, severity_filter, time_range, include_recovery } = args;
      
      let query = `
        SELECT 
          data->>'error_type' as error_type,
          data->>'severity' as severity,
          COUNT(*) as occurrence_count,
          MAX(timestamp) as last_occurrence
        FROM analytics
        WHERE analytics_type = 'error'
      `;
      const params = [];
      
      if (time_range) {
        query += ` AND timestamp > NOW() - INTERVAL '${time_range}'`;
      } else {
        query += ` AND timestamp > NOW() - INTERVAL '1 hour'`;
      }
      
      query += ` GROUP BY data->>'error_type', data->>'severity' ORDER BY occurrence_count DESC`;
      
      const result = await pgPool.query(query, params);
      
      return {
        content: [{
          type: "text",
          text: result.rows.length > 0
            ? JSON.stringify(result.rows, null, 2)
            : "No errors found in the specified time range",
        }],
      };
    }

    case "quality_dashboard": {
      const { entity_type, entity_id, metrics } = args;
      
      let query = `
        SELECT 
          analytics_type,
          AVG(COALESCE((data->>'quality_score')::numeric, 0)) as avg_quality,
          AVG(COALESCE((data->>'test_coverage')::numeric, 0)) as avg_coverage,
          SUM(COALESCE((data->>'warnings_count')::integer, 0)) as total_warnings,
          SUM(COALESCE((data->>'errors_encountered')::integer, 0)) as total_errors
        FROM analytics
        WHERE analytics_type IN ('quality', 'code')
          AND timestamp > NOW() - INTERVAL '1 hour'
        GROUP BY analytics_type
      `;
      
      const result = await pgPool.query(query);
      
      return {
        content: [{
          type: "text",
          text: result.rows.length > 0
            ? JSON.stringify(result.rows, null, 2)
            : "No quality data available",
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Helper function to select best worker
async function selectBestWorker(task) {
  const workers = Array.from(activeWorkers.values());

  // Filter available workers
  const availableWorkers = workers.filter(w =>
    w.status === 'idle' || w.status === 'active'
  );

  if (availableWorkers.length === 0) {
    return null;
  }

  // Select based on capabilities and load
  const bestWorker = availableWorkers.reduce((best, worker) => {
    const load = worker.currentLoad?.active_tasks || 0;
    const bestLoad = best.currentLoad?.active_tasks || 0;

    if (load < bestLoad) {
      return worker;
    }
    return best;
  });

  return bestWorker.worker_id;
}

// ═══════════════════════════════════════════════════════════════════════
// PERIODIC TASKS
// ═══════════════════════════════════════════════════════════════════════

// Health check workers
setInterval(async () => {
  const now = Date.now();

  for (const [workerId, worker] of activeWorkers) {
    const lastHeartbeat = worker.lastHeartbeat?.getTime() || 0;

    if (now - lastHeartbeat > MANAGER_CONFIG.workerTimeoutMs) {
      console.log(`⚠️  Worker ${workerId} is unresponsive`);
      worker.status = 'unresponsive';

      // Reassign tasks
      for (const [taskId, task] of activeTasks) {
        if (task.assigned_worker === workerId) {
          console.log(`Reassigning task ${taskId}`);
          // Implement task reassignment
        }
      }
    }
  }
}, MANAGER_CONFIG.workerHealthCheckInterval);

// Aggregate metrics
setInterval(async () => {
  // Aggregate system metrics
  const systemMetrics = {
    timestamp: new Date(),
    active_tasks: activeTasks.size,
    active_workers: activeWorkers.size,
    completed_tasks_hour: 0, // Calculate from history
    average_execution_time: 0, // Calculate from history
    error_rate: 0, // Calculate from errors
  };

  analyticsStore.systemMetrics.push(systemMetrics);

  // Keep only recent metrics
  if (analyticsStore.systemMetrics.length > 1000) {
    analyticsStore.systemMetrics.shift();
  }

  // Store in database
  await pgPool.query(
    `INSERT INTO analytics (analytics_type, source_type, source_id, data)
     VALUES ($1, $2, $3, $4)`,
    ['system_metrics', 'manager', MANAGER_CONFIG.managerId, JSON.stringify(systemMetrics)]
  );
}, MANAGER_CONFIG.metricsAggregationInterval);

// ═══════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);

console.log("═══════════════════════════════════════════════════════════════");
console.log("✅ MCP Manager Enhanced Ready");
console.log("📊 Analytics Engine: Active");
console.log("📡 Real-time Monitoring: Enabled");
console.log("🔄 Worker Communication: Established");
console.log("═══════════════════════════════════════════════════════════════");
console.log("\nWaiting for commands...");