/**
 * Remote Worker Management Tools
 * 
 * This module adds tools to the MCP manager for managing remote Docker workers
 * that connect via NATS from anywhere in the world.
 */

// ═══════════════════════════════════════════════════════════════
// REMOTE WORKER TOOLS DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const remoteWorkerTools = [
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
];

// ═══════════════════════════════════════════════════════════════
// REMOTE WORKER TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════

export function createRemoteWorkerHandlers(natsConnection, redis, pgPool, sc) {
  return {
    // List all remote workers
    async list_remote_workers(args) {
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
    },

    // Assign task to remote worker
    async assign_remote_task(args) {
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
    },

    // Get remote worker status
    async get_remote_worker_status(args) {
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
    },

    // Broadcast to remote workers
    async broadcast_to_remote_workers(args) {
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
    },
  };
}

