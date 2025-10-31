#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, StringCodec } from 'nats';
import { createClient } from 'redis';
import pg from 'pg';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dockerSpawnTool from './docker-spawn-tool.js';

// Get current directory (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config = {
  redis: { host: 'localhost', port: 6379 },
  postgres: {
    host: 'localhost',
    port: 5432,
    database: 'mcp_manager',
    user: 'postgres',
    password: 'postgres'
  },
  worker: { 
    spawnerScript: path.join(__dirname, '..', 'scripts', 'worker-spawner-nats.js'),
    logPath: '/tmp/worker-spawner.log'
  }
};

if (fs.existsSync(configPath)) {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// ═══════════════════════════════════════════════════════════════
// CONNECTION SETUP
// ═══════════════════════════════════════════════════════════════
const natsConnection = await connect({ servers: 'localhost:4222' });
const sc = StringCodec();

const redis = createClient({
  socket: { host: config.redis.host, port: config.redis.port }
});
await redis.connect();

const pgPool = new pg.Pool(config.postgres);

// Store active NATS requests that are waiting for answers
const pendingRequests = new Map();

// ═══════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION
// ═══════════════════════════════════════════════════════════════
await pgPool.query(`
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
`);

await pgPool.query(`
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
`);

await pgPool.query(`
  CREATE INDEX IF NOT EXISTS idx_task_updates_worker_id ON task_updates(worker_id);
  CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates(task_id);
`);

// Create interactive tables
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255),
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    tasks_completed INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    metadata JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
  );
`);

await pgPool.query(`
  CREATE TABLE IF NOT EXISTS worker_questions (
    question_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255),
    session_id VARCHAR(255),
    task_id VARCHAR(255),
    question TEXT,
    question_type VARCHAR(50),
    context JSONB,
    asked_at TIMESTAMP DEFAULT NOW(),
    answer TEXT,
    answered_by VARCHAR(255),
    answered_at TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_worker_questions_worker_id ON worker_questions(worker_id);
`);

// Create remote workers tables
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    hostname VARCHAR(255) NOT NULL,
    manager_host VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'idle',
    capabilities JSONB,
    system_info JSONB,
    registered_at TIMESTAMP DEFAULT NOW(),
    last_heartbeat TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_remote_workers_status ON remote_workers(status);
  CREATE INDEX IF NOT EXISTS idx_remote_workers_heartbeat ON remote_workers(last_heartbeat);
`);

await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) REFERENCES remote_workers(worker_id),
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    total_execution_time_ms BIGINT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    metadata JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_remote_sessions_worker ON remote_worker_sessions(worker_id);
`);

await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_worker_events (
    event_id SERIAL PRIMARY KEY,
    worker_id VARCHAR(255) REFERENCES remote_workers(worker_id),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_remote_events_worker ON remote_worker_events(worker_id);
  CREATE INDEX IF NOT EXISTS idx_remote_events_type ON remote_worker_events(event_type);
`);

// Create remote worker views
await pgPool.query(`
  CREATE OR REPLACE VIEW remote_worker_stats AS
  SELECT 
    w.worker_id,
    w.hostname,
    w.status,
    w.registered_at,
    w.last_heartbeat,
    COUNT(DISTINCT s.session_id) as total_sessions,
    SUM(COALESCE(s.tasks_completed, 0)) as total_tasks_completed,
    SUM(COALESCE(s.tasks_failed, 0)) as total_tasks_failed,
    SUM(COALESCE(s.total_execution_time_ms, 0)) as total_execution_time_ms,
    EXTRACT(EPOCH FROM (NOW() - w.last_heartbeat)) as seconds_since_heartbeat
  FROM remote_workers w
  LEFT JOIN remote_worker_sessions s ON w.worker_id = s.worker_id
  GROUP BY w.worker_id, w.hostname, w.status, w.registered_at, w.last_heartbeat;
`);

console.error("✅ Database schema initialized with interactive and remote worker tables");

// ═══════════════════════════════════════════════════════════════
// INTERACTIVE NATS SUBSCRIPTIONS - Handle worker requests
// ═══════════════════════════════════════════════════════════════

// Subscribe to worker questions
const questionSub = natsConnection.subscribe("manager.question.*");
(async () => {
  try {
    for await (const msg of questionSub) {
      try {
        const question = JSON.parse(sc.decode(msg.data));
        const { question_id, worker_id, session_id, task_id, question: q, question_type, context } = question;

        // Log question in database
        await pgPool.query(
          `INSERT INTO worker_questions (question_id, worker_id, session_id, question, question_type, context, asked_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [question_id, worker_id, session_id, q, question_type, JSON.stringify(context)]
        );

        console.error(`\n❓ Worker Question from ${worker_id}:`);
        console.error(`   Type: ${question_type}`);
        console.error(`   Question: ${q}`);
        console.error(`   Context: ${JSON.stringify(context, null, 2)}`);
        console.error(`   Waiting for manager response...`);

        // Store pending question in Redis with the NATS message reference
        await redis.hSet(`pending_questions`, question_id, JSON.stringify({
          worker_id,
          session_id,
          question: q,
          question_type,
          context,
          msg_subject: msg.subject,
          reply_to: msg.reply,
        }));
        
        // CRITICAL FIX: Store the actual NATS message object to respond to later
        pendingRequests.set(question_id, msg);
        
        // Set a timeout to auto-respond if no answer is provided
        setTimeout(async () => {
          if (pendingRequests.has(question_id)) {
            // No answer provided within timeout, send a default response
            const timeoutResponse = {
              question_id,
              answer: "No response from manager. Please proceed with your best judgment or try asking again.",
              guidance_type: "timeout",
              answered_by: "system",
              timestamp: new Date().toISOString(),
            };
            
            msg.respond(sc.encode(JSON.stringify(timeoutResponse)));
            pendingRequests.delete(question_id);
            await redis.hDel("pending_questions", question_id);
            
            console.error(`⏱️ Question ${question_id} timed out - sent default response`);
          }
        }, 29000); // Respond just before the 30-second timeout
        
      } catch (msgError) {
        console.error("Error processing question message:", msgError);
        // Send error response if we can
        if (msg.reply) {
          msg.respond(sc.encode(JSON.stringify({
            error: msgError.message,
            answered_by: "system",
            timestamp: new Date().toISOString(),
          })));
        }
      }
    }
  } catch (subError) {
    console.error("Error in question subscription:", subError);
  }
})();

// Subscribe to next task requests
const nextTaskSub = natsConnection.subscribe("manager.next_task.*");
(async () => {
  try {
    for await (const msg of nextTaskSub) {
      try {
        const request = JSON.parse(sc.decode(msg.data));
        const { worker_id, session_id, completed_task_id, worker_state, ready_for_complexity } = request;

        console.error(`\n📋 Worker ${worker_id} requesting next task`);
        console.error(`   Completed: ${completed_task_id}`);
        console.error(`   Ready for: ${ready_for_complexity || "any"} complexity`);

        // Store request in Redis for manager to handle
        await redis.hSet(`next_task_requests`, worker_id, JSON.stringify({
          worker_id,
          session_id,
          completed_task_id,
          worker_state,
          ready_for_complexity,
          timestamp: new Date().toISOString(),
          reply_to: msg.reply,
        }));

        // Send acknowledgment
        if (msg.reply) {
          msg.respond(sc.encode(JSON.stringify({
            status: "waiting",
            message: "Request received. Manager will assign next task soon.",
            worker_id,
          })));
        }

      } catch (msgError) {
        console.error("Error processing next task request:", msgError);
      }
    }
  } catch (subError) {
    console.error("Error in next task subscription:", subError);
  }
})();

// Subscribe to session end requests
const endSessionSub = natsConnection.subscribe("manager.end_session.*");
(async () => {
  try {
    for await (const msg of endSessionSub) {
      try {
        const request = JSON.parse(sc.decode(msg.data));
        const { worker_id, session_id, reason, session_summary, custom_message } = request;

        console.error(`\n🚪 Worker ${worker_id} requesting to end session`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Tasks completed: ${session_summary?.tasks_completed || 0}`);

        // Store request in Redis for manager to approve/deny
        await redis.hSet(`end_session_requests`, worker_id, JSON.stringify({
          worker_id,
          session_id,
          reason,
          session_summary,
          custom_message,
          timestamp: new Date().toISOString(),
          reply_to: msg.reply,
        }));

        // Send acknowledgment
        if (msg.reply) {
          msg.respond(sc.encode(JSON.stringify({
            status: "pending_approval",
            message: "Session end request received. Awaiting manager approval.",
            worker_id,
          })));
        }

      } catch (msgError) {
        console.error("Error processing session end request:", msgError);
      }
    }
  } catch (subError) {
    console.error("Error in session end subscription:", subError);
  }
})();

// ═══════════════════════════════════════════════════════════════
// MCP SERVER SETUP
// ═══════════════════════════════════════════════════════════════
const server = new Server(
  {
    name: "mcp-manager-interactive",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: args } = request.params;

  switch (toolName) {
    // ENHANCED SPAWN WORKER TOOL
    case "spawn_worker": {
      const { task_description, worker_name, retry_count = 0, interactive_mode = true } = args;
      
      const task_id = uuidv4();
      const worker_id = uuidv4();
      const session_id = interactive_mode ? `session-${uuidv4()}` : null;
      
      console.error(`\n🚀 Spawning ${interactive_mode ? 'interactive' : 'standard'} worker...`);
      console.error(`   Task: ${task_description.substring(0, 100)}...`);

      // Spawn request via NATS
      await natsConnection.publish(
        'manager.spawn_worker',
        sc.encode(JSON.stringify({
          task_id,
          worker_id,
          task_description,
          worker_name,
          retry_count,
          session_id,
          interactive_mode,
          timestamp: new Date().toISOString(),
        }))
      );

      // Initialize worker record
      await redis.hSet(`worker:${worker_id}`, {
        status: 'spawning',
        last_update: new Date().toISOString(),
        percent_complete: 0,
        session_id: session_id || '',
      });

      // Initialize interactive session if needed
      if (interactive_mode) {
        await pgPool.query(
          `INSERT INTO worker_sessions (session_id, worker_id, started_at, status)
           VALUES ($1, $2, NOW(), 'active')`,
          [session_id, worker_id]
        );
      }

      // Store in PostgreSQL
      await pgPool.query(
        `INSERT INTO workers (worker_id, task_id, session_id, description, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [worker_id, task_id, session_id, task_description, "spawning", 
         JSON.stringify({ retry_count, interactive_mode })]
      );

      return {
        content: [
          {
            type: "text",
            text: `Worker spawned successfully!\n\nWorker ID: ${worker_id}\nTask ID: ${task_id}\nSession ID: ${session_id || "N/A"}\nInteractive Mode: ${interactive_mode}\n\nWorker will ${interactive_mode ? "stay alive for multiple tasks" : "exit after task completion"}`,
          },
        ],
      };
    }

    case "answer_worker_question": {
      const { question_id, answer, guidance_type, additional_context } = args;
      
      // Get pending question from Redis
      const questionData = await redis.hGet("pending_questions", question_id);
      if (!questionData) {
        return {
          content: [{ type: "text", text: "Question not found or already answered" }],
        };
      }

      const { worker_id, session_id, question } = JSON.parse(questionData);

      // CRITICAL FIX: Get the stored NATS message to respond to
      const natsMsg = pendingRequests.get(question_id);
      
      // Send answer back to worker
      const answerPayload = {
        question_id,
        answer,
        guidance_type,
        additional_context,
        answered_by: "manager",
        timestamp: new Date().toISOString(),
      };

      // CRITICAL FIX: Use the original NATS message to respond
      if (natsMsg) {
        natsMsg.respond(sc.encode(JSON.stringify(answerPayload)));
        pendingRequests.delete(question_id);
        console.error(`✅ Answered question ${question_id} via NATS request-reply`);
      } else {
        // Fallback: try to publish if we don't have the message
        console.error(`⚠️ No NATS message found for question ${question_id}, question may have timed out`);
      }

      // Update database
      await pgPool.query(
        `UPDATE worker_questions 
         SET answer = $1, answered_by = $2, answered_at = NOW()
         WHERE question_id = $3`,
        [answer, "manager", question_id]
      );

      // Remove from pending
      await redis.hDel("pending_questions", question_id);

      return {
        content: [
          {
            type: "text",
            text: `Answer sent to worker ${worker_id}:\nQuestion: ${question}\nAnswer: ${answer}`,
          },
        ],
      };
    }

    case "assign_task_to_worker": {
      const { worker_id, task_description, task_priority = "medium", task_metadata } = args;
      
      // Get worker's next task request
      const requestData = await redis.hGet("next_task_requests", worker_id);
      if (!requestData) {
        return {
          content: [{ type: "text", text: "No pending task request from this worker" }],
        };
      }

      const { session_id, completed_task_id, reply_to } = JSON.parse(requestData);
      const new_task_id = uuidv4();

      // Create new task
      await pgPool.query(
        `INSERT INTO workers (worker_id, task_id, session_id, description, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [worker_id, new_task_id, session_id, task_description, "assigned",
         JSON.stringify({ ...task_metadata, priority: task_priority })]
      );

      // Update session
      await pgPool.query(
        `UPDATE worker_sessions 
         SET tasks_completed = tasks_completed + 1, updated_at = NOW()
         WHERE session_id = $1`,
        [session_id]
      );

      // Send task to worker via NATS
      const taskPayload = {
        task_id: new_task_id,
        task_description,
        task_priority,
        task_metadata,
        assigned_by: "manager",
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(
        `worker.task.${worker_id}`,
        sc.encode(JSON.stringify(taskPayload))
      );

      // Remove from pending
      await redis.hDel("next_task_requests", worker_id);

      return {
        content: [
          {
            type: "text",
            text: `New task assigned to worker ${worker_id}:\nTask ID: ${new_task_id}\nDescription: ${task_description}\nPriority: ${task_priority}`,
          },
        ],
      };
    }

    case "approve_session_end": {
      const { worker_id, approved, reason, final_instructions } = args;
      
      // Get session end request
      const requestData = await redis.hGet("end_session_requests", worker_id);
      if (!requestData) {
        return {
          content: [{ type: "text", text: "No pending session end request from this worker" }],
        };
      }

      const { session_id, reply_to } = JSON.parse(requestData);

      // Update session status
      if (approved) {
        await pgPool.query(
          `UPDATE worker_sessions 
           SET status = 'ended', ended_at = NOW()
           WHERE session_id = $1`,
          [session_id]
        );
      }

      // Send approval/denial to worker
      const responsePayload = {
        approved,
        reason,
        final_instructions,
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(
        `worker.session.${worker_id}`,
        sc.encode(JSON.stringify(responsePayload))
      );

      // Remove from pending
      await redis.hDel("end_session_requests", worker_id);

      return {
        content: [
          {
            type: "text",
            text: `Session end ${approved ? "approved" : "denied"} for worker ${worker_id}\nReason: ${reason}`,
          },
        ],
      };
    }

    case "list_pending_questions": {
      const { filter_by_type = "all" } = args;
      
      const questions = await redis.hGetAll("pending_questions");
      const pendingList = [];

      for (const [question_id, data] of Object.entries(questions)) {
        const q = JSON.parse(data);
        if (filter_by_type === "all" || q.question_type === filter_by_type) {
          pendingList.push({
            question_id,
            worker_id: q.worker_id,
            question: q.question,
            question_type: q.question_type,
            context: q.context,
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Pending Questions (${pendingList.length}):\n\n${pendingList.map(q => 
              `ID: ${q.question_id}\nWorker: ${q.worker_id}\nType: ${q.question_type}\nQuestion: ${q.question}`
            ).join("\n\n")}`,
          },
        ],
      };
    }

    case "list_waiting_workers": {
      const { include_state = true } = args;
      
      const requests = await redis.hGetAll("next_task_requests");
      const waitingWorkers = [];

      for (const [worker_id, data] of Object.entries(requests)) {
        const req = JSON.parse(data);
        waitingWorkers.push({
          worker_id,
          completed_task: req.completed_task_id,
          ready_for: req.ready_for_complexity || "any",
          waiting_since: req.timestamp,
          state: include_state ? req.worker_state : undefined,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Workers Waiting for Tasks (${waitingWorkers.length}):\n\n${waitingWorkers.map(w => 
              `Worker: ${w.worker_id}\nCompleted: ${w.completed_task}\nReady for: ${w.ready_for}\nWaiting since: ${w.waiting_since}`
            ).join("\n\n")}`,
          },
        ],
      };
    }

    case "list_session_end_requests": {
      const requests = await redis.hGetAll("end_session_requests");
      const endRequests = [];

      for (const [worker_id, data] of Object.entries(requests)) {
        const req = JSON.parse(data);
        endRequests.push({
          worker_id,
          session_id: req.session_id,
          reason: req.reason,
          summary: req.session_summary,
          message: req.custom_message,
          requested_at: req.timestamp,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Session End Requests (${endRequests.length}):\n\n${endRequests.map(r => 
              `Worker: ${r.worker_id}\nReason: ${r.reason}\nTasks completed: ${r.summary.tasks_completed}\nMessage: ${r.message || "None"}`
            ).join("\n\n")}`,
          },
        ],
      };
    }

    case "broadcast_to_workers": {
      const { message, message_type, target_session_ids = [] } = args;
      
      const broadcast = {
        message,
        message_type,
        from: "manager",
        timestamp: new Date().toISOString(),
      };

      if (target_session_ids.length > 0) {
        // Targeted broadcast
        for (const session_id of target_session_ids) {
          await natsConnection.publish(
            `worker.broadcast.${session_id}`,
            sc.encode(JSON.stringify(broadcast))
          );
        }
      } else {
        // Broadcast to all
        await natsConnection.publish(
          "worker.broadcast.all",
          sc.encode(JSON.stringify(broadcast))
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Broadcast sent: ${message_type} - ${message}\nTargets: ${target_session_ids.length > 0 ? target_session_ids.join(", ") : "All workers"}`,
          },
        ],
      };
    }

    // Original manager tools
    case "get_task_status": {
      const { task_id, include_timeline = false } = args;

      try {
        // Try Redis first (hot cache)
        const cachedResult = await redis.get(`task:${task_id}:result`);
        let result = cachedResult ? JSON.parse(cachedResult) : null;

        // Get updates from Redis
        const updates = await redis.lRange(`task:${task_id}:updates`, 0, -1);
        const timeline = updates.map(u => JSON.parse(u));

        // If not in cache, query PostgreSQL
        if (!result) {
          const dbResult = await pgPool.query(
            `SELECT * FROM workers WHERE task_id = $1`,
            [task_id]
          );
          result = dbResult.rows[0] || null;
        }

        // Get full timeline from PostgreSQL if requested
        let fullTimeline = [];
        if (include_timeline) {
          const timelineResult = await pgPool.query(
            `SELECT * FROM task_updates WHERE task_id = $1 ORDER BY timestamp ASC`,
            [task_id]
          );
          fullTimeline = timelineResult.rows;
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task_id,
              result,
              recent_updates: timeline.slice(0, 10),
              full_timeline: fullTimeline,
              data_source: result ? (cachedResult ? "redis" : "postgresql") : "not_found"
            }, null, 2)
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ 
              success: false, 
              error: error.message 
            })
          }],
        };
      }
    }

    case "get_worker_status": {
      const { worker_id } = args;
      
      // Get Redis data
      const redisData = await redis.hGetAll(`worker:${worker_id}`);
      
      // Get last heartbeat
      const heartbeat = await redis.get(`heartbeat:${worker_id}`);
      
      // Get database record
      const dbResult = await pgPool.query(
        `SELECT * FROM workers 
         WHERE worker_id = $1 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [worker_id]
      );

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            worker_id,
            redis_data: redisData,
            last_heartbeat: heartbeat,
            database_record: dbResult.rows[0] || null,
            is_active: heartbeat && (Date.now() - new Date(heartbeat).getTime() < 60000)
          }, null, 2)
        }],
      };
    }

    case "query_redis": {
      const { key } = args;
      
      // Determine key type
      const keyType = await redis.type(key);
      let value;
      
      switch (keyType) {
        case 'string':
          value = await redis.get(key);
          break;
        case 'hash':
          value = await redis.hGetAll(key);
          break;
        case 'list':
          value = await redis.lRange(key, 0, -1);
          break;
        case 'set':
          value = await redis.sMembers(key);
          break;
        default:
          value = null;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            key,
            type: keyType,
            value
          }, null, 2)
        }],
      };
    }

    case "query_database": {
      const { query } = args;
      
      try {
        const result = await pgPool.query(query);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              rows: result.rows,
              rowCount: result.rowCount
            }, null, 2)
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            })
          }],
        };
      }
    }

    case "get_worker_analytics": {
      const { time_range = "last_day" } = args;
      
      // Calculate time filter
      let timeFilter = "1 day";
      switch (time_range) {
        case "last_hour": timeFilter = "1 hour"; break;
        case "last_week": timeFilter = "7 days"; break;
        case "all": timeFilter = null; break;
      }

      const whereClause = timeFilter ? 
        `WHERE created_at > NOW() - INTERVAL '${timeFilter}'` : '';

      // Get analytics from PostgreSQL
      const analytics = await pgPool.query(`
        SELECT 
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_tasks,
          AVG(total_execution_time_ms) as avg_execution_time,
          MAX(total_execution_time_ms) as max_execution_time,
          MIN(total_execution_time_ms) as min_execution_time
        FROM workers 
        ${whereClause}
      `);

      // Get active workers from Redis
      const keys = await redis.keys('worker:*');
      const activeWorkers = keys.length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            time_range,
            analytics: analytics.rows[0],
            active_workers: activeWorkers
          }, null, 2)
        }],
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // REMOTE WORKER MANAGEMENT HANDLERS
    // ═══════════════════════════════════════════════════════════════
    
    case "list_remote_workers": {
      const { status_filter = "all", include_stats = true } = args;
      
      try {
        // Get active remote workers from Redis
        const activeWorkerIds = await redis.sMembers('remote_workers:active');
        
        const workers = [];
        
        for (const workerId of activeWorkerIds) {
          const workerData = await redis.get(`remote_worker:${workerId}`);
          if (!workerData) continue;
          
          const worker = JSON.parse(workerData);
          
          // Apply status filter
          if (status_filter !== "all" && worker.status !== status_filter) {
            continue;
          }
          
          // Add stats if requested
          if (include_stats) {
            const stats = await pgPool.query(
              `SELECT * FROM remote_worker_stats WHERE worker_id = $1`,
              [workerId]
            );
            if (stats.rows.length > 0) {
              worker.stats = stats.rows[0];
            }
          }
          
          workers.push(worker);
        }
        
        // Also get from database for workers that might not be in Redis
        const dbWorkers = await pgPool.query(
          status_filter === "all" 
            ? `SELECT * FROM remote_workers ORDER BY last_heartbeat DESC`
            : `SELECT * FROM remote_workers WHERE status = $1 ORDER BY last_heartbeat DESC`,
          status_filter === "all" ? [] : [status_filter]
        );
        
        // Merge results (prefer Redis data as it's more current)
        const workerMap = new Map();
        workers.forEach(w => workerMap.set(w.worker_id, w));
        dbWorkers.rows.forEach(w => {
          if (!workerMap.has(w.worker_id)) {
            workerMap.set(w.worker_id, w);
          }
        });
        
        const allWorkers = Array.from(workerMap.values());
        
        console.error(`📋 Listed ${allWorkers.length} remote workers (filter: ${status_filter})`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                count: allWorkers.length,
                status_filter,
                workers: allWorkers,
                timestamp: new Date().toISOString(),
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('Error listing remote workers:', error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    case "assign_remote_task": {
      const { worker_id, task_description, task_priority = "normal", timeout_ms = 300000 } = args;
      
      try {
        let targetWorkerId = worker_id;
        
        // If no worker specified, find an idle one
        if (!targetWorkerId) {
          const activeWorkers = await redis.sMembers('remote_workers:active');
          
          for (const wid of activeWorkers) {
            const workerData = await redis.get(`remote_worker:${wid}`);
            if (workerData) {
              const worker = JSON.parse(workerData);
              if (worker.status === 'idle') {
                targetWorkerId = wid;
                break;
              }
            }
          }
          
          if (!targetWorkerId) {
            throw new Error('No idle remote workers available');
          }
        }
        
        // Verify worker exists and is available
        const workerData = await redis.get(`remote_worker:${targetWorkerId}`);
        if (!workerData) {
          throw new Error(`Worker ${targetWorkerId} not found`);
        }
        
        const worker = JSON.parse(workerData);
        if (worker.status === 'busy') {
          throw new Error(`Worker ${targetWorkerId} is currently busy`);
        }
        
        // Create task
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const taskAssignment = {
          task_id: taskId,
          task_description,
          task_priority,
          timeout_ms,
          assigned_at: new Date().toISOString(),
          assigned_by: 'manager',
        };
        
        // Publish task via NATS
        natsConnection.publish(
          `worker.task.${targetWorkerId}`,
          sc.encode(JSON.stringify(taskAssignment))
        );
        
        // Store task assignment
        await redis.set(`task:${taskId}:assignment`, JSON.stringify({
          ...taskAssignment,
          worker_id: targetWorkerId,
        }));
        
        // Log event
        await pgPool.query(
          `INSERT INTO remote_worker_events (worker_id, event_type, event_data)
           VALUES ($1, $2, $3)`,
          [targetWorkerId, 'task_assigned', JSON.stringify(taskAssignment)]
        );
        
        console.error(`✅ Task ${taskId} assigned to remote worker ${targetWorkerId}`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                task_id: taskId,
                worker_id: targetWorkerId,
                worker_hostname: worker.hostname,
                task_description,
                task_priority,
                assigned_at: taskAssignment.assigned_at,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('Error assigning remote task:', error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    case "get_remote_worker_status": {
      const { worker_id } = args;
      
      try {
        // Get from Redis (current state)
        const redisData = await redis.get(`remote_worker:${worker_id}`);
        
        // Get from PostgreSQL (persistent data)
        const dbResult = await pgPool.query(
          `SELECT * FROM remote_worker_stats WHERE worker_id = $1`,
          [worker_id]
        );
        
        // Get recent events
        const eventsResult = await pgPool.query(
          `SELECT * FROM remote_worker_events 
           WHERE worker_id = $1 
           ORDER BY timestamp DESC 
           LIMIT 10`,
          [worker_id]
        );
        
        if (!redisData && dbResult.rows.length === 0) {
          throw new Error(`Worker ${worker_id} not found`);
        }
        
        const status = {
          worker_id,
          current_state: redisData ? JSON.parse(redisData) : null,
          statistics: dbResult.rows.length > 0 ? dbResult.rows[0] : null,
          recent_events: eventsResult.rows,
          timestamp: new Date().toISOString(),
        };
        
        console.error(`📊 Retrieved status for remote worker ${worker_id}`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('Error getting remote worker status:', error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    case "broadcast_to_remote_workers": {
      const { message, command } = args;
      
      try {
        const broadcast = {
          message,
          command,
          timestamp: new Date().toISOString(),
          from: 'manager',
        };
        
        // Publish to all remote workers
        natsConnection.publish(
          'worker.broadcast.remote',
          sc.encode(JSON.stringify(broadcast))
        );
        
        // Get count of active workers
        const activeWorkers = await redis.sMembers('remote_workers:active');
        
        console.error(`📢 Broadcast sent to ${activeWorkers.length} remote workers`);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message,
                command,
                recipients_count: activeWorkers.length,
                timestamp: broadcast.timestamp,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('Error broadcasting to remote workers:', error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    case "spawn_worker_container": {
      try {
        const {
          worker_tags = "mcp,docker,remote,spawned",
          max_concurrent_tasks = 5,
          max_memory_mb = 4096,
          custom_name = null
        } = args;
        
        console.error('🐳 Spawning new Docker worker container...');
        
        // Check if Docker is available
        const dockerCheck = await dockerSpawnTool.checkDockerAvailable();
        if (!dockerCheck.available) {
          throw new Error(`Docker not available: ${dockerCheck.error}`);
        }
        
        // Spawn the container
        const result = await dockerSpawnTool.spawnWorkerContainer({
          workerTags: worker_tags,
          maxConcurrentTasks: max_concurrent_tasks,
          maxMemoryMB: max_memory_mb,
          cursorApiKey: process.env.CURSOR_API_KEY || config.cursorApiKey,
          managerHost: 'localhost',
          networkMode: 'host',
          customName: custom_name
        });
        
        if (!result.success) {
          throw new Error(`Failed to spawn container: ${result.error}`);
        }
        
        console.error(`✅ Container spawned: ${result.containerName}`);
        
        // Wait a moment for the worker to register
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if worker registered
        const workers = await pgPool.query(
          `SELECT worker_id, status, hostname, capabilities 
           FROM remote_workers 
           WHERE hostname = $1 
           ORDER BY registered_at DESC 
           LIMIT 1`,
          [result.containerName]
        );
        
        const workerRegistered = workers.rows.length > 0;
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                container_id: result.containerId,
                container_name: result.containerName,
                status: result.status,
                started_at: result.startedAt,
                config: result.config,
                worker_registered: workerRegistered,
                worker_info: workerRegistered ? workers.rows[0] : null,
                message: workerRegistered 
                  ? "Container spawned and worker registered successfully"
                  : "Container spawned, waiting for worker registration..."
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('Error spawning worker container:', error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolName}`,
          },
        ],
      };
  }
});

// ═══════════════════════════════════════════════════════════════
// TOOLS DEFINITION
// ═══════════════════════════════════════════════════════════════
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Enhanced spawn worker tool
      {
        name: "spawn_worker",
        description: "Spawn a worker via NATS message with interactive session support",
        inputSchema: {
          type: "object",
          properties: {
            task_description: { type: "string", description: "Task description" },
            worker_name: { type: "string", description: "Optional worker name" },
            retry_count: {
              type: "number",
              description: "Retry count for verbosity (0=basic, 1=detailed, 2+=verbose)",
              default: 0,
            },
            interactive_mode: {
              type: "boolean",
              description: "Enable interactive mode (worker stays alive for multiple tasks)",
              default: true,
            },
          },
          required: ["task_description"],
        },
      },
      // NEW INTERACTIVE MANAGEMENT TOOLS
      {
        name: "answer_worker_question",
        description: "Send an answer to a worker's pending question",
        inputSchema: {
          type: "object",
          properties: {
            question_id: {
              type: "string",
              description: "Question ID (from list_pending_questions)",
            },
            answer: {
              type: "string",
              description: "Your answer to the worker's question",
            },
            guidance_type: {
              type: "string",
              description: "Type of guidance provided",
              enum: ["clarification", "direction", "approval", "information", "correction"],
            },
            additional_context: {
              type: "object",
              description: "Additional context or data for the worker",
            },
          },
          required: ["question_id", "answer", "guidance_type"],
        },
      },
      {
        name: "assign_task_to_worker",
        description: "Assign a new task to a worker waiting for next task",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Worker ID waiting for task",
            },
            task_description: {
              type: "string",
              description: "Description of the new task",
            },
            task_priority: {
              type: "string",
              description: "Task priority",
              enum: ["low", "medium", "high", "critical"],
              default: "medium",
            },
            task_metadata: {
              type: "object",
              description: "Additional task metadata",
            },
          },
          required: ["worker_id", "task_description"],
        },
      },
      {
        name: "approve_session_end",
        description: "Approve or deny a worker's request to end their session",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Worker ID requesting session end",
            },
            approved: {
              type: "boolean",
              description: "Whether to approve the session end",
            },
            reason: {
              type: "string",
              description: "Reason for approval/denial",
            },
            final_instructions: {
              type: "string",
              description: "Final instructions for the worker",
            },
          },
          required: ["worker_id", "approved", "reason"],
        },
      },
      {
        name: "list_pending_questions",
        description: "List all questions from workers awaiting answers",
        inputSchema: {
          type: "object",
          properties: {
            filter_by_type: {
              type: "string",
              description: "Filter by question type",
              enum: ["all", "clarification", "guidance", "permission", "information", "decision"],
              default: "all",
            },
          },
        },
      },
      {
        name: "list_waiting_workers",
        description: "List workers that have completed a task and are waiting for a new one",
        inputSchema: {
          type: "object",
          properties: {
            include_state: {
              type: "boolean",
              description: "Include worker state information",
              default: true,
            },
          },
        },
      },
      {
        name: "list_session_end_requests",
        description: "List workers requesting to end their sessions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "broadcast_to_workers",
        description: "Send a broadcast message to all or specific workers",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Message to broadcast",
            },
            message_type: {
              type: "string",
              description: "Type of message",
              enum: ["info", "warning", "update", "instruction"],
            },
            target_session_ids: {
              type: "array",
              description: "Optional: specific session IDs to target",
              items: { type: "string" },
              default: [],
            },
          },
          required: ["message", "message_type"],
        },
      },
      // REMOTE WORKER MANAGEMENT TOOLS
      {
        name: "list_remote_workers",
        description: "List all remote Docker worker containers connected to the manager",
        inputSchema: {
          type: "object",
          properties: {
            status_filter: {
              type: "string",
              description: "Filter by status",
              enum: ["all", "idle", "busy", "offline"],
              default: "all",
            },
            include_stats: {
              type: "boolean",
              description: "Include detailed statistics",
              default: true,
            },
          },
        },
      },
      {
        name: "assign_remote_task",
        description: "Assign a task to a remote Docker worker",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Specific worker ID (optional, auto-selects idle worker if not provided)",
            },
            task_description: {
              type: "string",
              description: "Description of the task to execute",
            },
            task_priority: {
              type: "string",
              description: "Task priority",
              enum: ["low", "normal", "high", "urgent"],
              default: "normal",
            },
            timeout_ms: {
              type: "number",
              description: "Task timeout in milliseconds",
              default: 300000,
            },
          },
          required: ["task_description"],
        },
      },
      {
        name: "get_remote_worker_status",
        description: "Get detailed status of a specific remote worker",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Worker ID to query",
            },
          },
          required: ["worker_id"],
        },
      },
      {
        name: "broadcast_to_remote_workers",
        description: "Send a broadcast message to all remote workers",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Message to broadcast",
            },
            command: {
              type: "string",
              description: "Command to execute",
              enum: ["info", "shutdown", "restart", "status"],
            },
          },
          required: ["message"],
        },
      },
      {
        name: "spawn_worker_container",
        description: "Spawn a new Docker worker container dynamically",
        inputSchema: {
          type: "object",
          properties: {
            worker_tags: {
              type: "string",
              description: "Comma-separated tags for the worker",
              default: "mcp,docker,remote,spawned",
            },
            max_concurrent_tasks: {
              type: "number",
              description: "Maximum concurrent tasks the worker can handle",
              default: 5,
            },
            max_memory_mb: {
              type: "number",
              description: "Maximum memory limit in MB",
              default: 4096,
            },
            custom_name: {
              type: "string",
              description: "Custom name for the container (optional)",
            },
          },
        },
      },
      // Original manager tools
      {
        name: "get_task_status",
        description: "Get the status and progress of a task from Redis cache or PostgreSQL",
        inputSchema: {
          type: "object",
          properties: {
            task_id: {
              type: "string",
              description: "Task ID to query",
            },
            include_timeline: {
              type: "boolean",
              description: "Include full timeline of updates",
              default: false,
            },
          },
          required: ["task_id"],
        },
      },
      {
        name: "get_worker_status",
        description: "Get current status of a specific worker",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Worker ID to query",
            },
          },
          required: ["worker_id"],
        },
      },
      {
        name: "query_redis",
        description: "Query Redis cache directly for debugging or monitoring",
        inputSchema: {
          type: "object",
          properties: {
            key: {
              type: "string",
              description: "Redis key to query",
            },
          },
          required: ["key"],
        },
      },
      {
        name: "query_database",
        description: "Execute a SQL query on the PostgreSQL database",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "SQL query to execute",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_worker_analytics",
        description: "Get analytics and statistics about worker performance",
        inputSchema: {
          type: "object",
          properties: {
            time_range: {
              type: "string",
              description: "Time range for analytics",
              enum: ["last_hour", "last_day", "last_week", "all"],
              default: "last_day",
            },
          },
        },
      },
    ],
  };
});

// ═══════════════════════════════════════════════════════════════
// SERVER INITIALIZATION
// ═══════════════════════════════════════════════════════════════
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("✅ MCP Manager Interactive Server running on stdio with bidirectional communication");

// Cleanup on exit
process.on('SIGINT', async () => {
  console.error('\n🛑 Shutting down manager...');
  
  // Clean up any pending requests
  for (const [questionId, msg] of pendingRequests.entries()) {
    const shutdownResponse = {
      question_id: questionId,
      answer: "Manager shutting down. Please retry your question.",
      guidance_type: "shutdown",
      answered_by: "system",
      timestamp: new Date().toISOString(),
    };
    msg.respond(sc.encode(JSON.stringify(shutdownResponse)));
  }
  pendingRequests.clear();
  
  await natsConnection.close();
  await redis.quit();
  await pgPool.end();
  process.exit(0);
});
