#!/usr/bin/env node
/**
 * MCP Worker Enhanced - Advanced Analytics & Reporting
 * Comprehensive worker with extensive telemetry and real-time monitoring
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
import os from "os";

const { Pool } = pg;
const sc = StringCodec();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION & INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════

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
console.error("🚀 MCP WORKER - ENHANCED ANALYTICS VERSION");
console.error("═══════════════════════════════════════════════════════════════");

// Worker Identity & Session Management
const WORKER_ID = process.env.WORKER_ID || `worker-${uuidv4()}`;
const TASK_ID = process.env.TASK_ID;
const SESSION_ID = process.env.SESSION_ID || `session-${uuidv4()}`;
const WORKER_VERSION = "2.0.0";
const WORKER_TYPE = process.env.WORKER_TYPE || "enhanced";

// Performance Tracking
const performanceMetrics = {
  startTime: Date.now(),
  toolCalls: new Map(),
  memorySnapshots: [],
  cpuSnapshots: [],
  networkCalls: [],
  fileOperations: [],
  errors: [],
  warnings: [],
  milestones: [],
};

// Analytics Collectors
const analyticsData = {
  taskPhases: [],
  decisionPoints: [],
  resourceUsage: [],
  dependencies: [],
  codeChanges: [],
  testResults: [],
  qualityMetrics: {},
};

console.error(`Worker ID: ${WORKER_ID}`);
console.error(`Task ID: ${TASK_ID}`);
console.error(`Session ID: ${SESSION_ID}`);
console.error(`Worker Type: ${WORKER_TYPE}`);
console.error(`Version: ${WORKER_VERSION}`);

// ═══════════════════════════════════════════════════════════════════════
// CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════

// Initialize NATS
let natsConnection;
try {
  const natsHost = process.env.NATS_HOST || 'localhost';
  const natsPort = process.env.NATS_PORT || '4222';
  console.error(`Connecting to NATS at ${natsHost}:${natsPort}`);
  natsConnection = await connect({
    servers: [`nats://${natsHost}:${natsPort}`],
    reconnect: true,
    maxReconnectAttempts: -1,
  });
  console.error("✅ Connected to NATS");
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
console.error("✅ Connected to Redis");

// Initialize PostgreSQL
const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

console.error("✅ Connected to PostgreSQL");

// ═══════════════════════════════════════════════════════════════════════
// MCP SERVER SETUP
// ═══════════════════════════════════════════════════════════════════════

const server = new Server(
  {
    name: "mcp-worker-enhanced",
    version: WORKER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ═══════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ═════════════════════════════════════════════════════════════════
      // CORE REPORTING TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_progress",
        description: "Report detailed progress with analytics to manager",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string", description: "Task ID" },
            status: {
              type: "string",
              enum: ["initializing", "analyzing", "planning", "executing", "testing", "validating", "completing", "paused", "error"],
            },
            phase: {
              type: "string",
              description: "Current phase of execution",
            },
            metrics: {
              type: "object",
              properties: {
                percent_complete: { type: "number" },
                current_operation: { type: "string" },
                items_processed: { type: "number" },
                total_items: { type: "number" },
                estimated_time_remaining_ms: { type: "number" },
                memory_usage_mb: { type: "number" },
                cpu_usage_percent: { type: "number" },
                files_analyzed: { type: "number" },
                files_modified: { type: "number" },
                tests_run: { type: "number" },
                tests_passed: { type: "number" },
                errors_encountered: { type: "number" },
                warnings_count: { type: "number" },
              },
            },
            context: {
              type: "object",
              description: "Additional context about current operation",
              properties: {
                current_file: { type: "string" },
                current_function: { type: "string" },
                stack_depth: { type: "number" },
                dependencies: { type: "array" },
              },
            },
          },
          required: ["task_id", "status", "metrics"],
        },
      },

      {
        name: "report_milestone",
        description: "Report significant milestones during task execution",
        inputSchema: {
          type: "object",
          properties: {
            milestone_name: { type: "string" },
            milestone_type: {
              type: "string",
              enum: ["phase_complete", "feature_implemented", "test_passed", "bug_fixed", "optimization_done", "checkpoint"],
            },
            description: { type: "string" },
            impact: {
              type: "string",
              enum: ["critical", "high", "medium", "low"],
            },
            metrics: {
              type: "object",
              properties: {
                time_taken_ms: { type: "number" },
                resources_used: { type: "object" },
                quality_score: { type: "number" },
              },
            },
          },
          required: ["milestone_name", "milestone_type"],
        },
      },

      {
        name: "report_analytics",
        description: "Report comprehensive analytics data",
        inputSchema: {
          type: "object",
          properties: {
            analytics_type: {
              type: "string",
              enum: ["performance", "quality", "resource", "code", "test", "security", "dependency"],
            },
            data: {
              type: "object",
              properties: {
                // Performance Analytics
                execution_time_ms: { type: "number" },
                memory_peak_mb: { type: "number" },
                cpu_average_percent: { type: "number" },
                io_operations: { type: "number" },
                network_requests: { type: "number" },

                // Code Analytics
                lines_added: { type: "number" },
                lines_removed: { type: "number" },
                files_created: { type: "number" },
                files_deleted: { type: "number" },
                functions_added: { type: "number" },
                complexity_score: { type: "number" },

                // Quality Analytics
                test_coverage: { type: "number" },
                lint_errors: { type: "number" },
                security_issues: { type: "number" },
                performance_issues: { type: "number" },

                // Custom data
                custom: { type: "object" },
              },
            },
            timestamp: { type: "string" },
          },
          required: ["analytics_type", "data"],
        },
      },

      {
        name: "stream_realtime_data",
        description: "Stream real-time execution data for live monitoring",
        inputSchema: {
          type: "object",
          properties: {
            stream_type: {
              type: "string",
              enum: ["thinking", "reasoning", "planning", "executing", "debugging", "testing", "output", "tool_call", "decision", "error"],
            },
            content: { type: "string" },
            metadata: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                tool_params: { type: "object" },
                tool_result: { type: "object" },
                tool_duration_ms: { type: "number" },

                reasoning_chain: { type: "array" },
                decision_factors: { type: "array" },
                alternatives_considered: { type: "array" },
                confidence_score: { type: "number" },

                file_path: { type: "string" },
                line_number: { type: "number" },
                function_name: { type: "string" },

                error_type: { type: "string" },
                error_severity: { type: "string" },
                stack_trace: { type: "array" },
              },
            },
            priority: {
              type: "string",
              enum: ["critical", "high", "medium", "low", "debug"],
            },
          },
          required: ["stream_type", "content"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // DECISION & PLANNING TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_decision",
        description: "Report important decisions made during execution",
        inputSchema: {
          type: "object",
          properties: {
            decision_type: {
              type: "string",
              enum: ["architecture", "implementation", "optimization", "error_handling", "testing_strategy", "tool_selection"],
            },
            description: { type: "string" },
            chosen_option: { type: "string" },
            alternatives: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  option: { type: "string" },
                  pros: { type: "array" },
                  cons: { type: "array" },
                  score: { type: "number" },
                },
              },
            },
            reasoning: { type: "string" },
            impact_assessment: {
              type: "object",
              properties: {
                performance_impact: { type: "string" },
                maintainability_impact: { type: "string" },
                complexity_impact: { type: "string" },
                risk_level: { type: "string" },
              },
            },
          },
          required: ["decision_type", "description", "chosen_option"],
        },
      },

      {
        name: "report_plan",
        description: "Report execution plan and strategy",
        inputSchema: {
          type: "object",
          properties: {
            plan_type: {
              type: "string",
              enum: ["overall", "phase", "subtask", "contingency"],
            },
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step_id: { type: "string" },
                  description: { type: "string" },
                  estimated_duration_ms: { type: "number" },
                  dependencies: { type: "array" },
                  resources_required: { type: "object" },
                  success_criteria: { type: "array" },
                },
              },
            },
            total_estimated_time_ms: { type: "number" },
            complexity_assessment: { type: "string" },
            risk_factors: { type: "array" },
          },
          required: ["plan_type", "steps"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // QUALITY & TESTING TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_test_results",
        description: "Report detailed test execution results",
        inputSchema: {
          type: "object",
          properties: {
            test_suite: { type: "string" },
            test_type: {
              type: "string",
              enum: ["unit", "integration", "e2e", "performance", "security", "regression"],
            },
            results: {
              type: "object",
              properties: {
                total_tests: { type: "number" },
                passed: { type: "number" },
                failed: { type: "number" },
                skipped: { type: "number" },
                duration_ms: { type: "number" },
                coverage_percent: { type: "number" },
              },
            },
            failed_tests: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  test_name: { type: "string" },
                  error_message: { type: "string" },
                  stack_trace: { type: "string" },
                  file_path: { type: "string" },
                  line_number: { type: "number" },
                },
              },
            },
            performance_metrics: {
              type: "object",
              properties: {
                avg_test_duration_ms: { type: "number" },
                slowest_test: { type: "string" },
                slowest_duration_ms: { type: "number" },
              },
            },
          },
          required: ["test_suite", "test_type", "results"],
        },
      },

      {
        name: "report_code_quality",
        description: "Report code quality metrics and issues",
        inputSchema: {
          type: "object",
          properties: {
            file_path: { type: "string" },
            metrics: {
              type: "object",
              properties: {
                cyclomatic_complexity: { type: "number" },
                cognitive_complexity: { type: "number" },
                lines_of_code: { type: "number" },
                duplicate_lines: { type: "number" },
                maintainability_index: { type: "number" },
              },
            },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  severity: { type: "string" },
                  message: { type: "string" },
                  line: { type: "number" },
                  column: { type: "number" },
                  rule: { type: "string" },
                },
              },
            },
            suggestions: { type: "array" },
          },
          required: ["file_path", "metrics"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // RESOURCE & PERFORMANCE TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_resource_usage",
        description: "Report detailed resource usage statistics",
        inputSchema: {
          type: "object",
          properties: {
            resource_type: {
              type: "string",
              enum: ["memory", "cpu", "disk", "network", "api", "database"],
            },
            metrics: {
              type: "object",
              properties: {
                current_usage: { type: "number" },
                peak_usage: { type: "number" },
                average_usage: { type: "number" },
                usage_trend: { type: "string" },
                threshold_warnings: { type: "array" },
              },
            },
            detailed_breakdown: {
              type: "object",
              properties: {
                by_operation: { type: "object" },
                by_component: { type: "object" },
                by_time_window: { type: "object" },
              },
            },
          },
          required: ["resource_type", "metrics"],
        },
      },

      {
        name: "report_performance_profile",
        description: "Report performance profiling data",
        inputSchema: {
          type: "object",
          properties: {
            profile_type: {
              type: "string",
              enum: ["cpu", "memory", "io", "network", "overall"],
            },
            hotspots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  location: { type: "string" },
                  impact_percent: { type: "number" },
                  samples: { type: "number" },
                  suggestions: { type: "array" },
                },
              },
            },
            bottlenecks: { type: "array" },
            optimization_opportunities: { type: "array" },
          },
          required: ["profile_type"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // INTERACTION & COLLABORATION TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "ask_manager",
        description: "Ask manager for guidance or clarification",
        inputSchema: {
          type: "object",
          properties: {
            question: { type: "string" },
            question_type: {
              type: "string",
              enum: ["technical", "architectural", "requirements", "priority", "permission", "resource"],
            },
            context: {
              type: "object",
              properties: {
                current_operation: { type: "string" },
                blocking_issue: { type: "string" },
                alternatives: { type: "array" },
                urgency: { type: "string" },
              },
            },
            response_needed_by_ms: { type: "number" },
          },
          required: ["question", "question_type"],
        },
      },

      {
        name: "request_resources",
        description: "Request additional resources from manager",
        inputSchema: {
          type: "object",
          properties: {
            resource_type: {
              type: "string",
              enum: ["compute", "memory", "storage", "api_quota", "tool_access", "dependency"],
            },
            amount_needed: { type: "string" },
            justification: { type: "string" },
            duration: { type: "string" },
            priority: {
              type: "string",
              enum: ["critical", "high", "medium", "low"],
            },
          },
          required: ["resource_type", "amount_needed", "justification"],
        },
      },

      {
        name: "collaborate_with_worker",
        description: "Request collaboration with another worker",
        inputSchema: {
          type: "object",
          properties: {
            collaboration_type: {
              type: "string",
              enum: ["code_review", "pair_programming", "testing", "debugging", "consultation"],
            },
            target_worker_id: { type: "string" },
            task_description: { type: "string" },
            shared_context: { type: "object" },
            expected_duration_ms: { type: "number" },
          },
          required: ["collaboration_type", "task_description"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // ERROR & RECOVERY TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_error",
        description: "Report detailed error information",
        inputSchema: {
          type: "object",
          properties: {
            error_type: {
              type: "string",
              enum: ["syntax", "runtime", "logic", "resource", "dependency", "permission", "network", "unknown"],
            },
            severity: {
              type: "string",
              enum: ["critical", "error", "warning", "info"],
            },
            message: { type: "string" },
            stack_trace: { type: "string" },
            context: {
              type: "object",
              properties: {
                file_path: { type: "string" },
                line_number: { type: "number" },
                function_name: { type: "string" },
                variables: { type: "object" },
              },
            },
            recovery_attempted: { type: "boolean" },
            recovery_strategy: { type: "string" },
            recovery_successful: { type: "boolean" },
          },
          required: ["error_type", "severity", "message"],
        },
      },

      {
        name: "report_completion",
        description: "Report task completion with comprehensive summary",
        inputSchema: {
          type: "object",
          properties: {
            task_id: { type: "string" },
            status: {
              type: "string",
              enum: ["success", "partial_success", "failed", "cancelled"],
            },
            summary: {
              type: "object",
              properties: {
                objectives_met: { type: "array" },
                objectives_missed: { type: "array" },
                deliverables: { type: "array" },

                total_execution_time_ms: { type: "number" },
                total_cpu_time_ms: { type: "number" },
                peak_memory_mb: { type: "number" },

                files_created: { type: "number" },
                files_modified: { type: "number" },
                files_deleted: { type: "number" },
                lines_added: { type: "number" },
                lines_removed: { type: "number" },

                tests_written: { type: "number" },
                tests_passed: { type: "number" },
                code_coverage: { type: "number" },

                errors_encountered: { type: "number" },
                errors_resolved: { type: "number" },
                warnings_generated: { type: "number" },

                decisions_made: { type: "number" },
                tools_used: { type: "array" },
                external_apis_called: { type: "number" },

                quality_score: { type: "number" },
                performance_score: { type: "number" },
                maintainability_score: { type: "number" },
              },
            },
            learnings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  insight: { type: "string" },
                  recommendation: { type: "string" },
                },
              },
            },
            follow_up_tasks: { type: "array" },
          },
          required: ["task_id", "status", "summary"],
        },
      },

      // ═════════════════════════════════════════════════════════════════
      // SYSTEM & METADATA TOOLS
      // ═════════════════════════════════════════════════════════════════
      {
        name: "report_heartbeat",
        description: "Send detailed heartbeat with system status",
        inputSchema: {
          type: "object",
          properties: {
            worker_id: { type: "string" },
            status: {
              type: "string",
              enum: ["idle", "busy", "overloaded", "error", "maintenance"],
            },
            health: {
              type: "object",
              properties: {
                cpu_usage: { type: "number" },
                memory_usage: { type: "number" },
                disk_usage: { type: "number" },
                network_latency_ms: { type: "number" },
                error_rate: { type: "number" },
                queue_depth: { type: "number" },
              },
            },
            capabilities: {
              type: "object",
              properties: {
                available_tools: { type: "array" },
                supported_languages: { type: "array" },
                max_parallel_tasks: { type: "number" },
                specialized_skills: { type: "array" },
              },
            },
            current_load: {
              type: "object",
              properties: {
                active_tasks: { type: "number" },
                queued_tasks: { type: "number" },
                estimated_completion_ms: { type: "number" },
              },
            },
          },
          required: ["worker_id", "status"],
        },
      },

      {
        name: "register_capability",
        description: "Register new capability or skill acquired",
        inputSchema: {
          type: "object",
          properties: {
            capability_type: {
              type: "string",
              enum: ["tool", "language", "framework", "pattern", "domain"],
            },
            name: { type: "string" },
            version: { type: "string" },
            proficiency_level: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced", "expert"],
            },
            learned_from: { type: "string" },
            applications: { type: "array" },
          },
          required: ["capability_type", "name"],
        },
      },
    ],
  };
});

// ═══════════════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════════════

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const timestamp = new Date().toISOString();

  // Track tool usage
  if (!performanceMetrics.toolCalls.has(name)) {
    performanceMetrics.toolCalls.set(name, { count: 0, totalDuration: 0 });
  }
  const toolMetric = performanceMetrics.toolCalls.get(name);
  toolMetric.count++;
  const toolStartTime = Date.now();

  try {
    let result;

    switch (name) {
      case "report_progress": {
        const { task_id, status, phase, metrics, context } = args;

        // Enhance metrics with system data
        const enhancedMetrics = {
          ...metrics,
          memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          cpu_usage_percent: os.loadavg()[0] * 100 / os.cpus().length,
          uptime_ms: Date.now() - performanceMetrics.startTime,
        };

        const progressUpdate = {
          worker_id: WORKER_ID,
          task_id,
          status,
          phase,
          metrics: enhancedMetrics,
          context,
          timestamp,
          session_id: SESSION_ID,
        };

        // Publish to NATS
        await natsConnection.publish(
          `worker.progress.${WORKER_ID}`,
          sc.encode(JSON.stringify(progressUpdate))
        );

        // Store in Redis for quick access
        await redis.hSet(`task:${task_id}:progress`, {
          status,
          phase: phase || "",
          percent_complete: metrics.percent_complete.toString(),
          last_update: timestamp,
        });

        // Store in PostgreSQL for historical tracking
        if (pgPool) {
          await pgPool.query(
            `INSERT INTO task_progress (task_id, worker_id, status, phase, metrics, context, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [task_id, WORKER_ID, status, phase, JSON.stringify(enhancedMetrics), JSON.stringify(context)]
          );
        }

        result = {
          content: [{
            type: "text",
            text: `Progress: ${status} - ${phase || metrics.current_operation} (${metrics.percent_complete}%)`,
          }],
        };
        break;
      }

      case "report_milestone": {
        const milestone = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        performanceMetrics.milestones.push(milestone);

        await natsConnection.publish(
          `worker.milestone.${WORKER_ID}`,
          sc.encode(JSON.stringify(milestone))
        );

        result = {
          content: [{
            type: "text",
            text: `Milestone: ${args.milestone_name} (${args.milestone_type})`,
          }],
        };
        break;
      }

      case "report_analytics": {
        const analytics = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        // Store in analytics data
        if (!analyticsData[args.analytics_type]) {
          analyticsData[args.analytics_type] = [];
        }
        analyticsData[args.analytics_type].push(analytics);

        await natsConnection.publish(
          `worker.analytics.${args.analytics_type}`,
          sc.encode(JSON.stringify(analytics))
        );

        result = {
          content: [{
            type: "text",
            text: `Analytics recorded: ${args.analytics_type}`,
          }],
        };
        break;
      }

      case "stream_realtime_data": {
        const stream = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          session_id: SESSION_ID,
          timestamp,
          ...args,
        };

        await natsConnection.publish(
          `worker.stream.${args.stream_type}.${WORKER_ID}`,
          sc.encode(JSON.stringify(stream))
        );

        // Store important streams in Redis
        if (args.priority === "critical" || args.priority === "high") {
          await redis.lPush(
            `stream:${TASK_ID}:${args.stream_type}`,
            JSON.stringify(stream)
          );
          await redis.lTrim(`stream:${TASK_ID}:${args.stream_type}`, 0, 999);
        }

        result = {
          content: [{
            type: "text",
            text: `Streamed: ${args.stream_type} - ${args.content.substring(0, 50)}...`,
          }],
        };
        break;
      }

      case "report_decision": {
        const decision = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        analyticsData.decisionPoints.push(decision);

        await natsConnection.publish(
          `worker.decision.${WORKER_ID}`,
          sc.encode(JSON.stringify(decision))
        );

        result = {
          content: [{
            type: "text",
            text: `Decision: ${args.chosen_option} (${args.decision_type})`,
          }],
        };
        break;
      }

      case "report_test_results": {
        const testResults = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        analyticsData.testResults.push(testResults);

        await natsConnection.publish(
          `worker.tests.${WORKER_ID}`,
          sc.encode(JSON.stringify(testResults))
        );

        // Store summary in Redis
        await redis.hSet(`task:${TASK_ID}:tests`, {
          total: args.results.total_tests.toString(),
          passed: args.results.passed.toString(),
          failed: args.results.failed.toString(),
          coverage: args.results.coverage_percent?.toString() || "0",
        });

        result = {
          content: [{
            type: "text",
            text: `Tests: ${args.results.passed}/${args.results.total_tests} passed`,
          }],
        };
        break;
      }

      case "report_error": {
        const errorReport = {
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        performanceMetrics.errors.push(errorReport);

        await natsConnection.publish(
          `worker.error.${WORKER_ID}`,
          sc.encode(JSON.stringify(errorReport))
        );

        // Store in Redis for quick access
        await redis.lPush(`errors:${TASK_ID}`, JSON.stringify(errorReport));

        result = {
          content: [{
            type: "text",
            text: `Error reported: ${args.error_type} - ${args.message}`,
          }],
        };
        break;
      }

      case "ask_manager": {
        const questionId = uuidv4();
        const question = {
          question_id: questionId,
          worker_id: WORKER_ID,
          task_id: TASK_ID,
          timestamp,
          ...args,
        };

        try {
          const response = await natsConnection.request(
            `manager.question.${args.question_type}`,
            sc.encode(JSON.stringify(question)),
            { timeout: args.response_needed_by_ms || 30000 }
          );

          const answer = JSON.parse(sc.decode(response.data));

          result = {
            content: [{
              type: "text",
              text: `Manager: ${answer.response}`,
            }],
          };
        } catch (error) {
          result = {
            content: [{
              type: "text",
              text: `Manager unavailable: ${error.message}`,
            }],
          };
        }
        break;
      }

      case "report_completion": {
        const completion = {
          worker_id: WORKER_ID,
          timestamp,
          ...args,
          performance_summary: {
            total_tool_calls: Array.from(performanceMetrics.toolCalls.values()).reduce((a, b) => a + b.count, 0),
            total_errors: performanceMetrics.errors.length,
            total_milestones: performanceMetrics.milestones.length,
            execution_time_ms: Date.now() - performanceMetrics.startTime,
          },
          analytics_summary: analyticsData,
        };

        await natsConnection.publish(
          `worker.completion.${WORKER_ID}`,
          sc.encode(JSON.stringify(completion))
        );

        // Store completion in PostgreSQL
        if (pgPool) {
          await pgPool.query(
            `INSERT INTO task_completions (task_id, worker_id, status, summary, analytics, timestamp)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [args.task_id, WORKER_ID, args.status, JSON.stringify(args.summary), JSON.stringify(completion)]
          );
        }

        result = {
          content: [{
            type: "text",
            text: `Task completed: ${args.status}\n${JSON.stringify(args.summary, null, 2)}`,
          }],
        };
        break;
      }

      case "report_heartbeat": {
        const heartbeat = {
          timestamp,
          ...args,
          uptime_ms: Date.now() - performanceMetrics.startTime,
        };

        await natsConnection.publish(
          `worker.heartbeat.${args.worker_id || WORKER_ID}`,
          sc.encode(JSON.stringify(heartbeat))
        );

        // Update Redis
        await redis.hSet(`worker:${args.worker_id || WORKER_ID}`, {
          status: args.status,
          last_heartbeat: timestamp,
          health: JSON.stringify(args.health || {}),
        });

        result = {
          content: [{
            type: "text",
            text: `Heartbeat: ${args.status}`,
          }],
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Track tool duration
    toolMetric.totalDuration += Date.now() - toolStartTime;

    return result;

  } catch (error) {
    // Track tool errors
    performanceMetrics.errors.push({
      tool: name,
      error: error.message,
      timestamp,
    });

    return {
      content: [{
        type: "text",
        text: `Error in ${name}: ${error.message}`,
      }],
    };
  }
});

// ═══════════════════════════════════════════════════════════════════════
// MONITORING & TELEMETRY
// ═══════════════════════════════════════════════════════════════════════

// Periodic system monitoring
setInterval(async () => {
  const snapshot = {
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    cpu: os.loadavg(),
    uptime: process.uptime(),
  };

  performanceMetrics.memorySnapshots.push(snapshot);
  performanceMetrics.cpuSnapshots.push(snapshot);

  // Keep only last 100 snapshots
  if (performanceMetrics.memorySnapshots.length > 100) {
    performanceMetrics.memorySnapshots.shift();
  }
  if (performanceMetrics.cpuSnapshots.length > 100) {
    performanceMetrics.cpuSnapshots.shift();
  }
}, 10000); // Every 10 seconds

// ═══════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("═══════════════════════════════════════════════════════════════");
console.error("✅ MCP Worker Enhanced - Ready");
console.error("📊 Analytics Engine: Active");
console.error("📡 Real-time Streaming: Enabled");
console.error("🔄 Bidirectional Communication: Established");
console.error("═══════════════════════════════════════════════════════════════");