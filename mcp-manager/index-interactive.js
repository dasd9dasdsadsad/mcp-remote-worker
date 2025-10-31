#!/usr/bin/env node
/**
 * MCP Manager - Interactive NATS-Based Architecture
 * Enhanced with bidirectional communication with workers
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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { connect, StringCodec } from "nats";

const { Pool } = pg;
const sc = StringCodec();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
const configPath = join(__dirname, "config.json");
const config = JSON.parse(readFileSync(configPath, "utf-8"));

console.error("═══════════════════════════════════════════════════════════════");
console.error("MCP MANAGER - INTERACTIVE SESSION MANAGEMENT");
console.error("═══════════════════════════════════════════════════════════════");

// Initialize NATS (Primary Communication)
let natsConnection;
try {
  natsConnection = await connect({
    servers: ["nats://localhost:4222"],
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  });
  console.error("✅ Connected to NATS (Interactive Communication Layer)");
} catch (error) {
  console.error("❌ Failed to connect to NATS:", error.message);
  process.exit(1);
}

// Initialize Redis (Hot Cache)
const redis = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
  },
  password: config.redis.password,
});

redis.on("error", (err) => console.error("Redis Client Error", err));
await redis.connect();
console.error("✅ Connected to Redis (Hot Cache)");

// Initialize PostgreSQL (Persistent Storage)
const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

console.error("✅ Connected to PostgreSQL (Persistent Store)");

// Ensure database schema exists
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255),
    description TEXT,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    metadata JSONB
  );

  CREATE TABLE IF NOT EXISTS task_updates (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL,
    worker_id VARCHAR(255),
    session_id VARCHAR(255),
    update_type VARCHAR(50),
    status VARCHAR(50),
    data JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    tasks_completed INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    metadata JSONB
  );

  CREATE TABLE IF NOT EXISTS worker_questions (
    question_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255),
    question TEXT NOT NULL,
    question_type VARCHAR(50),
    answer TEXT,
    answered_by VARCHAR(255),
    asked_at TIMESTAMP DEFAULT NOW(),
    answered_at TIMESTAMP,
    context JSONB
  );

  CREATE INDEX IF NOT EXISTS idx_workers_task_id ON workers(task_id);
  CREATE INDEX IF NOT EXISTS idx_workers_session_id ON workers(session_id);
  CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates(task_id);
  CREATE INDEX IF NOT EXISTS idx_worker_sessions_worker_id ON worker_sessions(worker_id);
  CREATE INDEX IF NOT EXISTS idx_worker_questions_worker_id ON worker_questions(worker_id);
`);

console.error("✅ Database schema initialized with interactive tables");

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

        // Store pending question in Redis
        await redis.hSet(`pending_questions`, question_id, JSON.stringify({
          worker_id,
          session_id,
          question: q,
          question_type,
          context,
          msg_subject: msg.subject,
          reply_to: msg.reply,
        }));
      } catch (msgError) {
        console.error("Error processing question message:", msgError);
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

        console.error(`\n📋 Next Task Request from ${worker_id}:`);
        console.error(`   Completed: ${completed_task_id}`);
        console.error(`   Ready for: ${ready_for_complexity} complexity`);

        // Check for pending tasks in Redis
        const pendingTasks = await redis.lRange("pending_tasks", 0, -1);
        
        // Store request for manager to handle
        await redis.hSet(`next_task_requests`, worker_id, JSON.stringify({
          session_id,
          completed_task_id,
          worker_state,
          ready_for_complexity,
          msg_reply: msg.reply,
          timestamp: new Date().toISOString(),
        }));
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

        console.error(`\n🚪 Session End Request from ${worker_id}:`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Tasks completed: ${session_summary.tasks_completed}`);
        console.error(`   Message: ${custom_message || "None"}`);

        // Store request for manager to handle
        await redis.hSet(`end_session_requests`, worker_id, JSON.stringify({
          session_id,
          reason,
          session_summary,
          custom_message,
          msg_reply: msg.reply,
          timestamp: new Date().toISOString(),
        }));
      } catch (msgError) {
        console.error("Error processing session end request:", msgError);
      }
    }
  } catch (subError) {
    console.error("Error in session end subscription:", subError);
  }
})();

// Original subscriptions (progress, completion, heartbeat)
const progressSub = natsConnection.subscribe("worker.progress.*");
(async () => {
  try {
    for await (const msg of progressSub) {
      try {
        const update = JSON.parse(msg.string());
        const { worker_id, task_id, status, metrics, session_id } = update;

        // Cache in Redis
        await redis.hSet(`worker:${worker_id}`, {
          status,
          last_update: new Date().toISOString(),
          percent_complete: metrics.percent_complete?.toString() || "0",
          session_id: session_id || "",
        });

        await redis.lPush(`task:${task_id}:updates`, JSON.stringify(update));
        await redis.expire(`task:${task_id}:updates`, 14400);

        // Store in PostgreSQL
        await pgPool.query(
          `INSERT INTO task_updates (task_id, worker_id, session_id, update_type, status, data)
           VALUES ($1, $2, $3, 'progress', $4, $5)`,
          [task_id, worker_id, session_id, status, JSON.stringify(update)]
        );

        console.error(`📊 Progress: ${task_id} - ${metrics.current_operation} (${metrics.percent_complete}%)`);
      } catch (msgError) {
        console.error("Error processing progress update:", msgError);
      }
    }
  } catch (subError) {
    console.error("Error in progress subscription:", subError);
  }
})();

// MCP Server
const server = new Server(
  {
    name: "mcp-manager-interactive",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Original spawning tools
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
        description: "Approve or deny a worker's request to end session",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: {
              type: "string",
              description: "Worker ID requesting to end session",
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
              description: "Final instructions before worker exits (if approved)",
            },
          },
          required: ["worker_id", "approved", "reason"],
        },
      },
      {
        name: "list_pending_questions",
        description: "List all pending questions from workers awaiting answers",
        inputSchema: {
          type: "object",
          properties: {
            filter_by_type: {
              type: "string",
              description: "Filter by question type",
              enum: ["clarification", "guidance", "permission", "information", "decision", "all"],
              default: "all",
            },
          },
        },
      },
      {
        name: "list_waiting_workers",
        description: "List workers waiting for next task assignment",
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
        description: "Broadcast a message to all active workers in interactive sessions",
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
              enum: ["info", "warning", "instruction", "update"],
            },
            target_session_ids: {
              type: "array",
              items: { type: "string" },
              description: "Specific session IDs to target (empty = all)",
            },
          },
          required: ["message", "message_type"],
        },
      },
      // Original manager tools
      {
        name: "get_task_status",
        description: "Get task status (queries Redis cache first, then PostgreSQL)",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID" },
            include_timeline: {
              type: "boolean",
              description: "Include full update timeline",
              default: false,
            },
          },
          required: ["task_id"],
        },
      },
      {
        name: "get_worker_status",
        description: "Get worker status via NATS request-reply",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: { type: "string", description: "Worker ID" },
          },
          required: ["worker_id"],
        },
      },
      {
        name: "query_redis",
        description: "Query Redis cache directly",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Redis key to query" },
          },
          required: ["key"],
        },
      },
      {
        name: "query_database",
        description: "Query PostgreSQL database directly",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "SQL query to execute" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_worker_analytics",
        description: "Get analytics (from Redis cache + PostgreSQL)",
        inputSchema: {
          type: "object",
          properties: {
            time_range: {
              type: "string",
              description: "Time range",
              enum: ["last_hour", "last_day", "last_week", "all"],
              default: "last_day",
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
    case "spawn_worker": {
      const { task_description, worker_name, retry_count = 0, interactive_mode = true } = args;
      
      const worker_id = uuidv4();
      const task_id = uuidv4();
      const session_id = interactive_mode ? uuidv4() : null;
      const worker_display_name = worker_name || `Worker-${worker_id.substring(0, 8)}`;

      // Create session record if interactive
      if (interactive_mode) {
        await pgPool.query(
          `INSERT INTO worker_sessions (session_id, worker_id, status, metadata)
           VALUES ($1, $2, 'active', $3)`,
          [session_id, worker_id, JSON.stringify({ worker_name: worker_display_name })]
        );
      }

      // Publish spawn request to NATS
      await natsConnection.publish(
        "manager.spawn_worker",
        sc.encode(JSON.stringify({
          worker_id,
          task_id,
          session_id,
          task_description,
          worker_name: worker_display_name,
          retry_count,
          interactive_mode,
          timestamp: new Date().toISOString(),
        }))
      );

      // Store in Redis
      await redis.hSet(`worker:${worker_id}`, {
        task_id,
        session_id: session_id || "",
        description: task_description,
        status: "spawning",
        created_at: new Date().toISOString(),
        interactive_mode: interactive_mode.toString(),
      });

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

      const { worker_id, session_id, question, reply_to } = JSON.parse(questionData);

      // Send answer back to worker
      const answerPayload = {
        question_id,
        answer,
        guidance_type,
        additional_context,
        answered_by: "manager",
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(reply_to, sc.encode(JSON.stringify(answerPayload)));

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
          content: [{ type: "text", text: "Worker not waiting for task or request expired" }],
        };
      }

      const { session_id, msg_reply } = JSON.parse(requestData);
      const new_task_id = uuidv4();

      // Send new task to worker
      const taskPayload = {
        has_task: true,
        task_id: new_task_id,
        task_description,
        task_priority,
        task_metadata,
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(msg_reply, sc.encode(JSON.stringify(taskPayload)));

      // Update session
      await pgPool.query(
        `UPDATE worker_sessions 
         SET tasks_completed = tasks_completed + 1, updated_at = NOW()
         WHERE session_id = $1`,
        [session_id]
      );

      // Create new task record
      await pgPool.query(
        `INSERT INTO workers (worker_id, task_id, session_id, description, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [worker_id, new_task_id, session_id, task_description, "assigned",
         JSON.stringify({ priority: task_priority, ...task_metadata })]
      );

      // Remove from waiting list
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
      
      // Get worker's end session request
      const requestData = await redis.hGet("end_session_requests", worker_id);
      if (!requestData) {
        return {
          content: [{ type: "text", text: "No pending session end request for this worker" }],
        };
      }

      const { session_id, msg_reply } = JSON.parse(requestData);

      // Send approval/denial to worker
      const responsePayload = {
        approved,
        reason,
        message: final_instructions || reason,
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(msg_reply, sc.encode(JSON.stringify(responsePayload)));

      if (approved) {
        // Update session as ended
        await pgPool.query(
          `UPDATE worker_sessions 
           SET status = 'ended', ended_at = NOW()
           WHERE session_id = $1`,
          [session_id]
        );
      }

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
              `ID: ${q.question_id}\nWorker: ${q.worker_id}\nType: ${q.question_type}\nQuestion: ${q.question}\n`
            ).join("\n---\n")}`,
          },
        ],
      };
    }

    case "list_waiting_workers": {
      const { include_state = true } = args;
      
      const requests = await redis.hGetAll("next_task_requests");
      const waitingList = [];

      for (const [worker_id, data] of Object.entries(requests)) {
        const req = JSON.parse(data);
        waitingList.push({
          worker_id,
          session_id: req.session_id,
          completed_task: req.completed_task_id,
          ready_for: req.ready_for_complexity,
          waiting_since: req.timestamp,
          ...(include_state ? { state: req.worker_state } : {}),
        });
      }

      return {
        content: [
          {
            type: "text",
            text: `Workers Waiting for Tasks (${waitingList.length}):\n\n${waitingList.map(w => 
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
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                task_id,
                result,
                recent_updates: timeline.slice(0, 10),
                full_timeline: include_timeline ? fullTimeline : undefined,
                data_source: cachedResult ? "redis_cache" : "postgresql",
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    }

    case "get_worker_status": {
      const { worker_id } = args;

      try {
        // Get from Redis
        const workerData = await redis.hGetAll(`worker:${worker_id}`);
        const heartbeat = await redis.get(`worker:${worker_id}:heartbeat`);

        // Get from PostgreSQL
        const dbResult = await pgPool.query(
          `SELECT * FROM workers WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [worker_id]
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                worker_id,
                redis_data: workerData,
                last_heartbeat: heartbeat,
                database_record: dbResult.rows[0] || null,
                is_active: !!heartbeat && (Date.now() - new Date(heartbeat).getTime() < 60000),
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    }

    case "query_redis": {
      const { key } = args;
      
      try {
        const type = await redis.type(key);
        let value;

        switch (type) {
          case "string":
            value = await redis.get(key);
            break;
          case "hash":
            value = await redis.hGetAll(key);
            break;
          case "list":
            value = await redis.lRange(key, 0, -1);
            break;
          case "set":
            value = await redis.sMembers(key);
            break;
          default:
            value = null;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ key, type, value }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    }

    case "query_database": {
      const { query } = args;
      
      try {
        // Safety check - only allow SELECT queries
        if (!query.trim().toUpperCase().startsWith("SELECT")) {
          throw new Error("Only SELECT queries are allowed");
        }

        const result = await pgPool.query(query);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                rows: result.rows,
                rowCount: result.rowCount,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    }

    case "get_worker_analytics": {
      const { time_range = "last_day" } = args;
      
      try {
        let timeFilter = "";
        switch (time_range) {
          case "last_hour":
            timeFilter = "WHERE created_at >= NOW() - INTERVAL '1 hour'";
            break;
          case "last_day":
            timeFilter = "WHERE created_at >= NOW() - INTERVAL '1 day'";
            break;
          case "last_week":
            timeFilter = "WHERE created_at >= NOW() - INTERVAL '1 week'";
            break;
          default:
            timeFilter = "";
        }

        const analyticsQuery = `
          SELECT 
            COUNT(DISTINCT worker_id) as total_workers,
            COUNT(DISTINCT task_id) as total_tasks,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_tasks,
            AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (completed_at - created_at)) END) as avg_completion_time_seconds
          FROM workers
          ${timeFilter}
        `;

        const result = await pgPool.query(analyticsQuery);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                time_range,
                analytics: result.rows[0],
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: error.message }, null, 2),
            },
          ],
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("🚀 MCP Manager Interactive Server running");
console.error("📡 Ready for bidirectional worker communication");
console.error("💬 Workers can now ask questions and request tasks");
