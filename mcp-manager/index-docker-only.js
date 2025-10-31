#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, StringCodec } from 'nats';
import { createClient } from 'redis';
import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
// DATABASE INITIALIZATION - DOCKER WORKERS ONLY
// ═══════════════════════════════════════════════════════════════

// Remote workers table
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    hostname VARCHAR(255),
    manager_host VARCHAR(255),
    status VARCHAR(50) DEFAULT 'idle',
    capabilities JSONB,
    system_info JSONB,
    registered_at TIMESTAMP DEFAULT NOW(),
    last_heartbeat TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
  );
`);

// Remote worker events table
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_worker_events (
    event_id SERIAL PRIMARY KEY,
    worker_id VARCHAR(255),
    event_type VARCHAR(100),
    event_data JSONB,
    timestamp TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (worker_id) REFERENCES remote_workers(worker_id) ON DELETE CASCADE
  );
`);

// Remote worker sessions table
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS remote_worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255),
    task_description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    task_count INTEGER DEFAULT 0,
    FOREIGN KEY (worker_id) REFERENCES remote_workers(worker_id) ON DELETE CASCADE
  );
`);

// Task analytics table
await pgPool.query(`
  CREATE TABLE IF NOT EXISTS task_analytics (
    analytics_id SERIAL PRIMARY KEY,
    worker_id VARCHAR(255),
    task_id VARCHAR(255),
    execution_time_ms INTEGER,
    memory_usage_mb FLOAT,
    cpu_usage_percent FLOAT,
    success BOOLEAN,
    error_message TEXT,
    timestamp TIMESTAMP DEFAULT NOW(),
    metadata JSONB
  );
`);

console.error('✅ Database schema initialized for Docker-only worker management');

// ═══════════════════════════════════════════════════════════════
// NATS SUBSCRIPTIONS - DOCKER WORKERS ONLY
// ═══════════════════════════════════════════════════════════════

// Remote worker registration
const remoteWorkerSub = natsConnection.subscribe('remote.worker.register');
(async () => {
  for await (const msg of remoteWorkerSub) {
    try {
      const data = JSON.parse(sc.decode(msg.data));
      console.error(`📝 Remote worker registration: ${data.worker_id}`);
      
      // Insert or update remote worker
      await pgPool.query(`
        INSERT INTO remote_workers (worker_id, hostname, manager_host, status, capabilities, system_info, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (worker_id) 
        DO UPDATE SET 
          hostname = EXCLUDED.hostname,
          manager_host = EXCLUDED.manager_host,
          status = EXCLUDED.status,
          capabilities = EXCLUDED.capabilities,
          system_info = EXCLUDED.system_info,
          last_heartbeat = NOW(),
          updated_at = NOW(),
          metadata = EXCLUDED.metadata
      `, [
        data.worker_id,
        data.hostname || 'unknown',
        data.manager_host || 'localhost',
        data.status || 'idle',
        JSON.stringify(data.capabilities || {}),
        JSON.stringify(data.system_info || {}),
        JSON.stringify(data.metadata || {})
      ]);

      // Update Redis cache
      await redis.hSet(`remote_worker:${data.worker_id}`, {
        status: data.status || 'idle',
        last_update: new Date().toISOString(),
        active_tasks: data.active_tasks || 0,
        ...data
      });

      // Respond to worker
      if (msg.reply) {
        natsConnection.publish(msg.reply, sc.encode(JSON.stringify({
          success: true,
          message: 'Worker registered successfully'
        })));
      }
    } catch (error) {
      console.error('❌ Error processing remote worker registration:', error);
      if (msg.reply) {
        natsConnection.publish(msg.reply, sc.encode(JSON.stringify({
          success: false,
          error: error.message
        })));
      }
    }
  }
})();

// Remote worker heartbeat
const remoteHeartbeatSub = natsConnection.subscribe('remote.worker.heartbeat');
(async () => {
  for await (const msg of remoteHeartbeatSub) {
    try {
      const data = JSON.parse(sc.decode(msg.data));
      
      // Update PostgreSQL
      await pgPool.query(`
        UPDATE remote_workers 
        SET last_heartbeat = NOW(), 
            status = $2,
            updated_at = NOW()
        WHERE worker_id = $1
      `, [data.worker_id, data.status || 'idle']);

      // Update Redis cache
      await redis.hSet(`remote_worker:${data.worker_id}`, {
        status: data.status || 'idle',
        last_heartbeat: new Date().toISOString(),
        active_tasks: data.active_tasks || 0,
        system_info: JSON.stringify(data.system_info || {})
      });

    } catch (error) {
      console.error('❌ Error processing remote worker heartbeat:', error);
    }
  }
})();

// ═══════════════════════════════════════════════════════════════
// MCP SERVER SETUP
// ═══════════════════════════════════════════════════════════════
const server = new Server(
  {
    name: "mcp-manager-docker-only",
    version: "2.0.0",
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
    // ═══════════════════════════════════════════════════════════════
    // DOCKER CONTAINER MANAGEMENT TOOLS
    // ═══════════════════════════════════════════════════════════════
    
    case "list_remote_workers": {
      const { include_stats = true, status_filter = "all" } = args;
      
      let query = `SELECT * FROM remote_workers`;
      let params = [];
      
      if (status_filter !== "all") {
        query += ` WHERE status = $1`;
        params.push(status_filter);
      }
      
      query += ` ORDER BY last_heartbeat DESC`;
      
      const result = await pgPool.query(query, params);
      const workers = [];
      
      for (const row of result.rows) {
        const worker = {
          worker_id: row.worker_id,
          hostname: row.hostname,
          manager_host: row.manager_host,
          status: row.status,
          capabilities: row.capabilities,
          system_info: row.system_info,
          registered_at: row.registered_at,
          last_heartbeat: row.last_heartbeat,
          updated_at: row.updated_at,
          metadata: row.metadata
        };
        
        if (include_stats) {
          // Get additional stats from Redis
          const redisData = await redis.hGetAll(`remote_worker:${row.worker_id}`);
          if (redisData && Object.keys(redisData).length > 0) {
            worker.active_tasks = parseInt(redisData.active_tasks) || 0;
            worker.mcp_servers_running = redisData.mcp_servers_running ? 
              JSON.parse(redisData.mcp_servers_running) : [];
          }
        }
        
        workers.push(worker);
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            count: workers.length,
            status_filter,
            workers,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
      };
    }

    case "get_remote_worker_status": {
      const { worker_id } = args;
      
      // Get PostgreSQL data
      const dbResult = await pgPool.query(
        `SELECT * FROM remote_workers WHERE worker_id = $1`,
        [worker_id]
      );
      
      if (dbResult.rows.length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Remote worker ${worker_id} not found`
            }, null, 2)
          }],
        };
      }
      
      // Get Redis data
      const redisData = await redis.hGetAll(`remote_worker:${worker_id}`);
      
      // Get recent events
      const eventsResult = await pgPool.query(
        `SELECT * FROM remote_worker_events 
         WHERE worker_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 10`,
        [worker_id]
      );
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            worker_id,
            current_state: {
              ...dbResult.rows[0],
              ...redisData
            },
            statistics: null,
            recent_events: eventsResult.rows,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
      };
    }

    case "assign_remote_task": {
      const { task_description, task_priority = "normal", timeout_ms = 300000, worker_id } = args;
      
      let targetWorker;
      
      if (worker_id) {
        // Check if specific worker is available
        const workerResult = await pgPool.query(
          `SELECT * FROM remote_workers WHERE worker_id = $1 AND status = 'idle'`,
          [worker_id]
        );
        
        if (workerResult.rows.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Worker ${worker_id} not found or not idle`
              }, null, 2)
            }],
          };
        }
        
        targetWorker = workerResult.rows[0];
      } else {
        // Find an idle worker
        const idleWorkerResult = await pgPool.query(
          `SELECT * FROM remote_workers 
           WHERE status = 'idle' 
           ORDER BY last_heartbeat DESC 
           LIMIT 1`
        );
        
        if (idleWorkerResult.rows.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "No idle remote workers available"
              }, null, 2)
            }],
          };
        }
        
        targetWorker = idleWorkerResult.rows[0];
      }
      
      const task_id = uuidv4();
      
      // Send task to worker via NATS
      const taskMessage = {
        task_id,
        worker_id: targetWorker.worker_id,
        task_description,
        task_priority,
        timeout_ms,
        timestamp: new Date().toISOString()
      };
      
      try {
        // Log the event
        await pgPool.query(`
          INSERT INTO remote_worker_events (worker_id, event_type, event_data)
          VALUES ($1, $2, $3)
        `, [
          targetWorker.worker_id,
          'task_assigned',
          JSON.stringify(taskMessage)
        ]);
        
        // Update worker status
        await pgPool.query(`
          UPDATE remote_workers 
          SET status = 'busy', updated_at = NOW()
          WHERE worker_id = $1
        `, [targetWorker.worker_id]);
        
        // Send via NATS
        await natsConnection.publish(
          `worker.task.${targetWorker.worker_id}`,
          sc.encode(JSON.stringify(taskMessage))
        );
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              task_id,
              worker_id: targetWorker.worker_id,
              message: "Task assigned successfully",
              timestamp: new Date().toISOString()
            }, null, 2)
          }],
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message,
              stack: error.stack
            }, null, 2)
          }],
        };
      }
    }

    case "broadcast_to_remote_workers": {
      const { message, message_type = "info", target_session_ids = [] } = args;
      
      let targetWorkers;
      
      if (target_session_ids.length > 0) {
        // Broadcast to specific sessions
        const sessionResult = await pgPool.query(
          `SELECT DISTINCT worker_id FROM remote_worker_sessions 
           WHERE session_id = ANY($1) AND status = 'active'`,
          [target_session_ids]
        );
        targetWorkers = sessionResult.rows.map(row => row.worker_id);
      } else {
        // Broadcast to all active workers
        const workersResult = await pgPool.query(
          `SELECT worker_id FROM remote_workers WHERE status != 'offline'`
        );
        targetWorkers = workersResult.rows.map(row => row.worker_id);
      }
      
      const broadcastMessage = {
        message,
        message_type,
        timestamp: new Date().toISOString(),
        broadcast_id: uuidv4()
      };
      
      let successCount = 0;
      
      for (const worker_id of targetWorkers) {
        try {
          await natsConnection.publish(
            `worker.broadcast.${worker_id}`,
            sc.encode(JSON.stringify(broadcastMessage))
          );
          successCount++;
        } catch (error) {
          console.error(`Failed to broadcast to worker ${worker_id}:`, error);
        }
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            message,
            recipients_count: successCount,
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
      };
    }

    case "get_task_status": {
      const { task_id, include_timeline = false } = args;
      
      // Get task analytics
      const analyticsResult = await pgPool.query(
        `SELECT * FROM task_analytics WHERE task_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [task_id]
      );
      
      // Get worker events related to this task
      const eventsResult = await pgPool.query(
        `SELECT * FROM remote_worker_events 
         WHERE event_data->>'task_id' = $1 
         ORDER BY timestamp DESC`,
        [task_id]
      );
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            task_id,
            analytics: analyticsResult.rows[0] || null,
            events: include_timeline ? eventsResult.rows : eventsResult.rows.slice(0, 5),
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
      };
    }

    case "get_worker_analytics": {
      const { time_range = "last_day" } = args;
      
      let timeCondition = "";
      switch (time_range) {
        case "last_hour":
          timeCondition = "WHERE timestamp >= NOW() - INTERVAL '1 hour'";
          break;
        case "last_day":
          timeCondition = "WHERE timestamp >= NOW() - INTERVAL '1 day'";
          break;
        case "last_week":
          timeCondition = "WHERE timestamp >= NOW() - INTERVAL '1 week'";
          break;
        default:
          timeCondition = "";
      }
      
      // Get task analytics
      const analyticsResult = await pgPool.query(`
        SELECT 
          COUNT(*) as total_tasks,
          COUNT(CASE WHEN success = true THEN 1 END) as completed_tasks,
          COUNT(CASE WHEN success = false THEN 1 END) as failed_tasks,
          AVG(execution_time_ms) as avg_execution_time,
          MAX(execution_time_ms) as max_execution_time,
          MIN(execution_time_ms) as min_execution_time,
          AVG(memory_usage_mb) as avg_memory_usage,
          AVG(cpu_usage_percent) as avg_cpu_usage
        FROM task_analytics 
        ${timeCondition}
      `);
      
      // Get active workers count
      const activeWorkersResult = await pgPool.query(`
        SELECT COUNT(*) as active_workers 
        FROM remote_workers 
        WHERE last_heartbeat >= NOW() - INTERVAL '5 minutes'
      `);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            time_range,
            analytics: analyticsResult.rows[0],
            active_workers: parseInt(activeWorkersResult.rows[0].active_workers),
            timestamp: new Date().toISOString()
          }, null, 2)
        }],
      };
    }

    case "query_redis": {
      const { key } = args;
      
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
        case 'zset':
          value = await redis.zRangeWithScores(key, 0, -1);
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
            value,
            timestamp: new Date().toISOString()
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
              query,
              rows: result.rows,
              row_count: result.rowCount,
              timestamp: new Date().toISOString()
            }, null, 2)
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              query,
              error: error.message,
              timestamp: new Date().toISOString()
            }, null, 2)
          }],
        };
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// TOOLS DEFINITION - DOCKER CONTAINERS ONLY
// ═══════════════════════════════════════════════════════════════
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_remote_workers",
        description: "List all remote Docker worker containers connected to the manager",
        inputSchema: {
          type: "object",
          properties: {
            include_stats: {
              type: "boolean",
              description: "Include detailed statistics",
              default: true,
            },
            status_filter: {
              type: "string",
              description: "Filter by status",
              enum: ["all", "idle", "busy", "offline"],
              default: "all",
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
            worker_id: {
              type: "string",
              description: "Specific worker ID (optional, auto-selects idle worker if not provided)",
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
    ],
  };
});

// ═══════════════════════════════════════════════════════════════
// SERVER STARTUP
// ═══════════════════════════════════════════════════════════════
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('✅ MCP Manager Docker-Only Server running on stdio with remote worker management');
