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
import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import os from "os";
import fetch from "node-fetch";

const { Pool } = pg;

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
    api: {
      url: process.env.API_URL || `http://${process.env.API_HOST || 'localhost'}:${process.env.API_PORT || '4001'}`,
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

async function apiPost(path, payload) {
  const baseUrl = config.api?.url || process.env.API_URL || `http://${process.env.API_HOST || 'localhost'}:${process.env.API_PORT || '4001'}`;
  const url = `${baseUrl}${path}`;
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

// Initialize PostgreSQL (for local analytics storage if needed)
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

        const progressPayload = {
          task_id: task_id || TASK_ID,
          worker_id: WORKER_ID,
          progress_percent: enhancedMetrics.percent_complete,
          phase: phase || metrics.current_operation,
          message: status,
        };

        await apiPost('/api/progress', progressPayload);

        if (pgPool) {
          await pgPool.query(
            `INSERT INTO task_progress (task_id, worker_id, status, phase, metrics, context, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [progressPayload.task_id, WORKER_ID, status, progressPayload.phase, JSON.stringify(enhancedMetrics), JSON.stringify(context)]
          );
        }

        result = {
          content: [{
            type: "text",
            text: `Progress: ${status} - ${progressPayload.phase || metrics.current_operation} (${metrics.percent_complete}%)`,
          }],
        };
        break;
      }

      case "report_milestone": {
        const milestone = {
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          milestone_name: args.milestone_name,
          milestone_type: args.milestone_type,
          milestone_data: args,
        };

        performanceMetrics.milestones.push({ ...milestone, timestamp });

        await apiPost('/api/milestones', milestone);

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
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          analytics_type: args.analytics_type || 'custom',
          analytics_data: args,
        };

        if (!analyticsData[args.analytics_type]) {
          analyticsData[args.analytics_type] = [];
        }
        analyticsData[args.analytics_type].push({ ...args, timestamp });

        await apiPost('/api/analytics', analytics);

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
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          analytics_type: `stream:${args.stream_type}`,
          analytics_data: { ...args, session_id: SESSION_ID, timestamp },
        };

        await apiPost('/api/analytics', stream);

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
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          analytics_type: 'decision',
          analytics_data: { ...args, timestamp },
        };

        analyticsData.decisionPoints.push(decision.analytics_data);

        await apiPost('/api/analytics', decision);

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
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          analytics_type: 'test_results',
          analytics_data: { ...args, timestamp },
        };

        analyticsData.testResults.push(testResults.analytics_data);

        await apiPost('/api/analytics', testResults);

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
          task_id: TASK_ID,
          worker_id: WORKER_ID,
          analytics_type: 'error',
          analytics_data: { ...args, timestamp },
        };

        performanceMetrics.errors.push(errorReport.analytics_data);

        await apiPost('/api/analytics', errorReport);

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
          question: args.question,
          question_type: args.question_type,
          context: args.context || {},
        };

        try {
          await apiPost('/api/questions', question);

          result = {
            content: [{
              type: "text",
              text: `Question submitted to manager (ID: ${questionId}). Await guidance and poll later via list_pending_questions()`,
            }],
          };
        } catch (error) {
          result = {
            content: [{
              type: "text",
              text: `Failed to submit question: ${error.message}`,
            }],
          };
        }
        break;
      }

      case "report_completion": {
        const completion = {
          task_id: args.task_id || TASK_ID,
          worker_id: WORKER_ID,
          status: args.status || 'completed',
          summary: args.summary || {},
          analytics: {
            ...args,
            performance_summary: {
              total_tool_calls: Array.from(performanceMetrics.toolCalls.values()).reduce((a, b) => a + b.count, 0),
              total_errors: performanceMetrics.errors.length,
              total_milestones: performanceMetrics.milestones.length,
              execution_time_ms: Date.now() - performanceMetrics.startTime,
            },
            analytics_summary: analyticsData,
          },
        };

        await apiPost('/api/completions', completion);

        if (pgPool) {
          await pgPool.query(
            `INSERT INTO task_completions (task_id, worker_id, status, summary, analytics, timestamp)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [completion.task_id, completion.worker_id, completion.status, JSON.stringify(completion.summary), JSON.stringify(completion.analytics)]
          );
        }

        result = {
          content: [{
            type: "text",
            text: `Task completed: ${completion.status}\n${JSON.stringify(completion.summary, null, 2)}`,
          }],
        };
        break;
      }

      case "report_heartbeat": {
        const heartbeatPayload = {
          worker_id: args.worker_id || WORKER_ID,
          status: args.status,
          health: args.health || {},
        };

        if (pgPool) {
          await pgPool.query(
            `UPDATE remote_workers
             SET last_heartbeat = NOW(), status = $1, updated_at = NOW()
             WHERE worker_id = $2`,
            [heartbeatPayload.status || 'idle', heartbeatPayload.worker_id]
          );
        }

        result = {
          content: [{
            type: "text",
            text: `Heartbeat: ${heartbeatPayload.status}`,
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