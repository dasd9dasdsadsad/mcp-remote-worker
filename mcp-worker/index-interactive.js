#!/usr/bin/env node
/**
 * MCP Worker - Interactive NATS-Based
 * Enhanced with bidirectional communication with manager
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "redis";
import pg from "pg";
import { connect, StringCodec } from "nats";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";

const { Pool } = pg;
const sc = StringCodec();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
const configPath = join(dirname(__dirname), "mcp-manager", "config.json");
let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf-8"));
} catch (error) {
  config = {
    redis: { 
      host: process.env.REDIS_HOST || "localhost", 
      port: parseInt(process.env.REDIS_PORT || "6379"), 
      password: process.env.REDIS_PASSWORD || "" 
    },
    postgres: { 
      host: process.env.POSTGRES_HOST || "localhost", 
      port: parseInt(process.env.POSTGRES_PORT || "5432"), 
      database: process.env.POSTGRES_DB || "mcp_manager", 
      user: process.env.POSTGRES_USER || "postgres", 
      password: process.env.POSTGRES_PASSWORD || "postgres" 
    }
  };
}

console.error("═══════════════════════════════════════════════════════════════");
console.error("MCP WORKER - INTERACTIVE SESSION");
console.error("═══════════════════════════════════════════════════════════════");

// Get worker/task IDs from environment
const WORKER_ID = process.env.WORKER_ID || `worker-${uuidv4()}`;
const TASK_ID = process.env.TASK_ID;
const SESSION_ID = process.env.SESSION_ID || `session-${uuidv4()}`;

console.error(`Worker ID: ${WORKER_ID}`);
console.error(`Task ID: ${TASK_ID}`);
console.error(`Session ID: ${SESSION_ID}`);

// Debug environment variables
console.error("DEBUG: Environment Variables:");
console.error(`  NATS_HOST: ${process.env.NATS_HOST}`);
console.error(`  REDIS_HOST: ${process.env.REDIS_HOST}`);
console.error(`  POSTGRES_HOST: ${process.env.POSTGRES_HOST}`);

// Initialize NATS
let natsConnection;
try {
  const natsHost = process.env.NATS_HOST || 'localhost';
  const natsPort = process.env.NATS_PORT || '4222';
  console.error(`DEBUG: Connecting to NATS at ${natsHost}:${natsPort}`);
  natsConnection = await connect({
    servers: [`nats://${natsHost}:${natsPort}`],
    reconnect: true,
    maxReconnectAttempts: -1,
  });
  console.error("✅ Connected to NATS (Interactive Communication)");
} catch (error) {
  console.error("❌ Failed to connect to NATS:", error.message);
  process.exit(1);
}

// Initialize Redis
const redis = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
  },
  password: config.redis.password,
});

redis.on("error", (err) => console.error("Redis Error:", err));
await redis.connect();
console.error("✅ Connected to Redis (Query Cache)");

// Initialize PostgreSQL
const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

console.error("✅ Connected to PostgreSQL (Query Database)");

// MCP Server
const server = new Server(
  {
    name: "mcp-worker-interactive",
    version: "4.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Existing tools from original worker
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Original reporting tools
      {
        name: "report_progress",
        description: "Report progress via NATS (broadcasts to manager)",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID" },
            status: {
              type: "string",
              description: "Status",
              enum: ["started", "in_progress", "paused", "error"],
            },
            metrics: {
              type: "object",
              description: "Progress metrics",
              properties: {
                percent_complete: { type: "number" },
                current_operation: { type: "string" },
                items_processed: { type: "number" },
                total_items: { type: "number" },
                error_message: { type: "string" },
              },
            },
          },
          required: ["task_id", "status", "metrics"],
        },
      },
      {
        name: "report_completion",
        description: "Report completion via NATS",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            result: {
              type: "object",
              properties: {
                success: { type: "boolean" },
                message: { type: "string" },
                output: { description: "Result data" },
                error: { type: "string" },
              },
              required: ["success"],
            },
            analytics: {
              type: "object",
              properties: {
                total_tokens: { type: "number" },
                total_execution_time_ms: { type: "number" },
                files_modified: { type: "number" },
                tools_called: { type: "number" },
                important: { type: "boolean" },
              },
            },
          },
          required: ["task_id", "result"],
        },
      },
      {
        name: "report_heartbeat",
        description: "Send heartbeat via NATS",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: { type: "string" },
            task_id: { type: "string" },
            status: {
              type: "string",
              enum: ["active", "idle", "busy"],
            },
          },
          required: ["worker_id"],
        },
      },
      {
        name: "stream_llm_output",
        description: "Stream LLM thinking, reasoning, tool calls, and outputs to manager for analytics and permanent storage",
        inputSchema: {
          type: "object",
          properties: {
            stream_type: {
              type: "string",
              description: "Type of content being streamed",
              enum: ["thinking", "reasoning", "output", "tool_call", "summary", "error"],
            },
            content: {
              type: "string",
              description: "The actual content (text, code, JSON, etc.)",
            },
            content_type: {
              type: "string",
              description: "Format of the content",
              enum: ["text", "code", "json", "markdown"],
            },
            metadata: {
              type: "object",
              description: "Additional metadata about this stream",
              properties: {
                tool_name: { type: "string" },
                tool_params: { type: "object" },
                tool_result: { type: "object" },
                tool_duration_ms: { type: "number" },
                reasoning_step: { type: "string" },
                confidence_score: { type: "number" },
                alternatives_considered: { type: "array" },
                model_name: { type: "string" },
                temperature: { type: "number" },
                prompt_tokens: { type: "number" },
                completion_tokens: { type: "number" },
                is_final_summary: { type: "boolean" },
                summary_stats: { type: "object" },
              },
            },
            store_permanently: {
              type: "boolean",
              description: "Whether manager should store this in PostgreSQL (manager decides final storage)",
            },
          },
          required: ["stream_type", "content"],
        },
      },
      // NEW INTERACTIVE TOOLS
      {
        name: "ask_manager_question",
        description: "Ask the manager a question and wait for response. Use this when you need guidance or clarification during task execution.",
        inputSchema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question to ask the manager",
            },
            context: {
              type: "object",
              description: "Additional context for the question",
              properties: {
                current_step: { type: "string" },
                options_considered: { type: "array" },
                blocking_issue: { type: "string" },
              },
            },
            question_type: {
              type: "string",
              description: "Type of question",
              enum: ["clarification", "guidance", "permission", "information", "decision"],
            },
            timeout_ms: {
              type: "number",
              description: "How long to wait for response (default: 30000)",
              default: 30000,
            },
          },
          required: ["question", "question_type"],
        },
      },
      {
        name: "request_next_task",
        description: "Request the next task from the manager after completing current task. Worker stays alive for continuous work.",
        inputSchema: {
          type: "object",
          properties: {
            completed_task_id: {
              type: "string",
              description: "ID of the task just completed",
            },
            worker_state: {
              type: "object",
              description: "Current worker state/context",
              properties: {
                capabilities_used: { type: "array" },
                resources_available: { type: "object" },
                preferred_task_types: { type: "array" },
              },
            },
            ready_for_complexity: {
              type: "string",
              description: "Complexity level worker is ready for",
              enum: ["simple", "moderate", "complex", "any"],
              default: "any",
            },
          },
          required: ["completed_task_id"],
        },
      },
      {
        name: "request_session_end",
        description: "Request permission from manager to end the worker session. Manager must approve before worker can exit.",
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Reason for wanting to end session",
              enum: ["all_tasks_complete", "error_unrecoverable", "idle_timeout", "user_request", "other"],
            },
            session_summary: {
              type: "object",
              description: "Summary of work done in session",
              properties: {
                tasks_completed: { type: "number" },
                total_execution_time_ms: { type: "number" },
                errors_encountered: { type: "number" },
                key_achievements: { type: "array" },
              },
            },
            custom_message: {
              type: "string",
              description: "Additional message to manager",
            },
          },
          required: ["reason", "session_summary"],
        },
      },
      // Existing query tools
      {
        name: "query_redis_cache",
        description: "Query Redis cache for task/worker data",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "Redis key to query" },
          },
          required: ["key"],
        },
      },
      {
        name: "query_task_database",
        description: "Query PostgreSQL for task history",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID to query" },
          },
          required: ["task_id"],
        },
      },
      {
        name: "request_worker_status",
        description: "Request status of another worker via NATS",
        inputSchema: {
          type: "object",
          properties: {
            target_worker_id: { type: "string", description: "Worker ID to query" },
          },
          required: ["target_worker_id"],
        },
      },
    ],
  };
});

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    // Original reporting tools
    case "report_progress": {
      const { task_id, status, metrics } = args;
      const update = {
        worker_id: WORKER_ID,
        task_id,
        status,
        metrics,
        timestamp: new Date().toISOString(),
        session_id: SESSION_ID,
      };

      await natsConnection.publish(
        `worker.progress.${WORKER_ID}`,
        sc.encode(JSON.stringify(update))
      );

      return {
        content: [
          {
            type: "text",
            text: `Progress reported: ${status} - ${metrics.current_operation || "Working"} (${metrics.percent_complete}%)`,
          },
        ],
      };
    }

    case "report_completion": {
      const { task_id, result, analytics } = args;
      const completion = {
        worker_id: WORKER_ID,
        task_id,
        result,
        analytics: analytics || {},
        timestamp: new Date().toISOString(),
        session_id: SESSION_ID,
      };

      await natsConnection.publish(
        `worker.completion.${WORKER_ID}`,
        sc.encode(JSON.stringify(completion))
      );

      return {
        content: [
          {
            type: "text",
            text: `Task ${task_id} completion reported: ${result.success ? "SUCCESS" : "FAILED"}`,
          },
        ],
      };
    }

    case "report_heartbeat": {
      const { worker_id, task_id, status } = args;
      const heartbeat = {
        worker_id: worker_id || WORKER_ID,
        task_id: task_id || TASK_ID,
        status: status || "active",
        timestamp: new Date().toISOString(),
        session_id: SESSION_ID,
      };

      await natsConnection.publish(
        `worker.heartbeat.${worker_id || WORKER_ID}`,
        sc.encode(JSON.stringify(heartbeat))
      );

      return {
        content: [
          {
            type: "text",
            text: `Heartbeat sent: ${status || "active"}`,
          },
        ],
      };
    }

    case "stream_llm_output": {
      const stream = {
        worker_id: WORKER_ID,
        task_id: TASK_ID,
        session_id: SESSION_ID,
        ...args,
        timestamp: new Date().toISOString(),
      };

      await natsConnection.publish(
        `worker.stream.${WORKER_ID}`,
        sc.encode(JSON.stringify(stream))
      );

      return {
        content: [
          {
            type: "text",
            text: `Streamed ${args.stream_type}: ${args.content.substring(0, 100)}...`,
          },
        ],
      };
    }

    // NEW INTERACTIVE TOOLS
    case "ask_manager_question": {
      const { question, context, question_type, timeout_ms = 30000 } = args;
      
      const questionId = uuidv4();
      const questionPayload = {
        question_id: questionId,
        worker_id: WORKER_ID,
        session_id: SESSION_ID,
        task_id: TASK_ID,
        question,
        context,
        question_type,
        timestamp: new Date().toISOString(),
      };

      // Publish question and wait for response
      try {
        const response = await natsConnection.request(
          `manager.question.${WORKER_ID}`,
          sc.encode(JSON.stringify(questionPayload)),
          { timeout: timeout_ms }
        );

        const answer = JSON.parse(sc.decode(response.data));
        
        return {
          content: [
            {
              type: "text",
              text: `Manager response: ${answer.answer}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get manager response: ${error.message}`,
            },
          ],
        };
      }
    }

    case "request_next_task": {
      const { completed_task_id, worker_state, ready_for_complexity } = args;
      
      const requestPayload = {
        worker_id: WORKER_ID,
        session_id: SESSION_ID,
        completed_task_id,
        worker_state,
        ready_for_complexity,
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await natsConnection.request(
          `manager.next_task.${WORKER_ID}`,
          sc.encode(JSON.stringify(requestPayload)),
          { timeout: 30000 }
        );

        const nextTask = JSON.parse(sc.decode(response.data));
        
        if (nextTask.has_task) {
          // Update environment with new task ID
          process.env.TASK_ID = nextTask.task_id;
          
          return {
            content: [
              {
                type: "text",
                text: `New task assigned: ${nextTask.task_description}\nTask ID: ${nextTask.task_id}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: "No new tasks available. Worker remains idle.",
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get next task: ${error.message}`,
            },
          ],
        };
      }
    }

    case "request_session_end": {
      const { reason, session_summary, custom_message } = args;
      
      const endRequestPayload = {
        worker_id: WORKER_ID,
        session_id: SESSION_ID,
        reason,
        session_summary,
        custom_message,
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await natsConnection.request(
          `manager.end_session.${WORKER_ID}`,
          sc.encode(JSON.stringify(endRequestPayload)),
          { timeout: 30000 }
        );

        const approval = JSON.parse(sc.decode(response.data));
        
        if (approval.approved) {
          // Clean up and prepare to exit
          await redis.disconnect();
          await pgPool.end();
          await natsConnection.close();
          
          return {
            content: [
              {
                type: "text",
                text: `Session end approved: ${approval.message}\n\nExiting gracefully...`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Session end denied: ${approval.reason}\nContinuing work...`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to request session end: ${error.message}`,
            },
          ],
        };
      }
    }

    // Existing query tools
    case "query_redis_cache": {
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
              text: `Redis error: ${error.message}`,
            },
          ],
        };
      }
    }

    case "query_task_database": {
      const { task_id } = args;
      try {
        const result = await pgPool.query(
          `SELECT * FROM task_updates WHERE task_id = $1 ORDER BY timestamp DESC LIMIT 10`,
          [task_id]
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Database error: ${error.message}`,
            },
          ],
        };
      }
    }

    case "request_worker_status": {
      const { target_worker_id } = args;
      try {
        const response = await natsConnection.request(
          `worker.status.${target_worker_id}`,
          sc.encode(JSON.stringify({ requester: WORKER_ID })),
          { timeout: 5000 }
        );

        const status = JSON.parse(sc.decode(response.data));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get worker status: ${error.message}`,
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

console.error("🚀 MCP Worker Interactive Server running");
console.error("📡 Ready for bidirectional communication with manager");
console.error("💫 Session will persist until manager approves exit");


