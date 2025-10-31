# 🔄 MCP Analytics System - Complete Workflow Diagram

**Date**: October 31, 2025  
**System**: HOWL MCP Remote Worker with Full Analytics

---

## 📊 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MCP ANALYTICS ECOSYSTEM                             │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │   You/User   │
    │  (via Cursor)│
    └──────┬───────┘
           │
           │ Uses MCP Tools
           ▼
    ┌──────────────────────────────────────────────┐
    │         MCP Manager Enhanced                  │
    │  (Central Orchestrator & Analytics Hub)       │
    │                                               │
    │  Tools Available:                             │
    │  • assign_task                                │
    │  • monitor_task                               │
    │  • get_analytics                              │
    │  • performance_report                         │
    │  • quality_dashboard                          │
    │  • manage_workers                             │
    │  • view_realtime_streams                      │
    │  • error_analysis                             │
    └──────┬───────────────────────────────┬────────┘
           │                               │
           │ NATS Messages                 │ Store/Query
           │                               │
           ▼                               ▼
    ┌──────────────────┐          ┌──────────────────┐
    │  NATS Message    │          │   PostgreSQL     │
    │      Bus         │          │    Database      │
    │  (Pub/Sub)       │          │                  │
    │                  │          │  • tasks         │
    │  Topics:         │          │  • analytics     │
    │  • worker.task.* │◄─────────┤  • workers       │
    │  • task.progress │          │  • stream_data   │
    │  • task.analytics│          └──────────────────┘
    └──────┬───────────┘
           │                               ┌──────────────────┐
           │ Subscribes                    │   Redis Cache    │
           │                               │                  │
           ▼                               │  • Real-time     │
    ┌──────────────────────────────────┐  │    analytics     │
    │   Docker Worker Container        │  │  • Worker state  │
    │                                  │  │  • Session data  │
    │  ┌────────────────────────────┐ │  └──────────────────┘
    │  │ Remote Worker (Node.js)    │ │
    │  │ • Listens to NATS          │ │
    │  │ • Spawns cursor-agent      │ │
    │  │ • Reports completion       │ │
    │  └────────┬───────────────────┘ │
    │           │                      │
    │           │ Spawns               │
    │           ▼                      │
    │  ┌────────────────────────────┐ │
    │  │    Cursor Agent (AI)       │ │
    │  │                            │ │
    │  │  • Reads analytics prompt  │ │
    │  │  • Executes task           │ │
    │  │  • Uses MCP tools          │ │
    │  └────────┬───────────────────┘ │
    │           │                      │
    │           │ Uses                 │
    │           ▼                      │
    │  ┌────────────────────────────┐ │
    │  │  MCP Worker Enhanced       │ │
    │  │  (30+ Analytics Tools)     │ │
    │  │                            │ │
    │  │  • report_progress         │ │
    │  │  • report_milestone        │ │
    │  │  • report_analytics        │ │
    │  │  • report_performance      │ │
    │  │  • report_completion       │ │
    │  └────────┬───────────────────┘ │
    │           │                      │
    │           │ NATS Publish         │
    │           └──────────────────────┼──► Back to NATS
    │                                  │
    │  ┌────────────────────────────┐ │
    │  │  DOMLogger Unified         │ │
    │  │  (15+ Browser Tools)       │ │
    │  │                            │ │
    │  │  • browser_navigate        │ │
    │  │  • browser_screenshot      │ │
    │  │  • browser_inspect         │ │
    │  └────────────────────────────┘ │
    └──────────────────────────────────┘
```

---

## 🔄 Complete Task Execution Flow

### Phase 1: Task Assignment

```
┌─────────┐
│  User   │
└────┬────┘
     │
     │ 1. Call assign_task()
     │    - description: "Visit URL and screenshot"
     │    - priority: "critical"
     │    - worker_id: "mcp-worker-xxx"
     │
     ▼
┌─────────────────┐
│  MCP Manager    │
└────┬────────────┘
     │
     │ 2. Create task in PostgreSQL
     │    INSERT INTO tasks (task_id, description, status, ...)
     │
     ▼
┌─────────────────┐
│  PostgreSQL     │
│  tasks table    │
└────┬────────────┘
     │
     │ 3. Publish to NATS
     │    Topic: worker.task.{worker_id}
     │    Payload: {task_id, description, priority}
     │
     ▼
┌─────────────────┐
│  NATS Bus       │
└────┬────────────┘
     │
     │ 4. Worker receives message
     │
     ▼
┌─────────────────┐
│  Docker Worker  │
│  (Subscribed)   │
└─────────────────┘
```

### Phase 2: Task Execution with Analytics

```
┌──────────────────────────────────────────────────────────────┐
│                    DOCKER WORKER CONTAINER                    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. Remote Worker receives task via NATS            │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                            │                                  │
│                            │ Read analytics prompt            │
│                            ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  2. Load ai-analytics-prompt.txt                     │   │
│  │     - MANDATORY: Use report_progress at 0,25,50,75,100│  │
│  │     - MANDATORY: Use report_milestone                │   │
│  │     - MANDATORY: Use report_analytics                │   │
│  │     - MANDATORY: Save screenshot to /root/hamid.png  │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                            │                                  │
│                            │ Combine with task                │
│                            ▼                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  3. Spawn cursor-agent                               │   │
│  │     cursor-agent --model auto -p "PROMPT + TASK"     │   │
│  └────────────────────────┬─────────────────────────────┘   │
│                            │                                  │
│         ┌──────────────────┴──────────────────┐              │
│         │                                      │              │
│         ▼                                      ▼              │
│  ┌─────────────────┐                   ┌─────────────────┐  │
│  │ MCP Worker      │                   │ DOMLogger       │  │
│  │ Enhanced        │                   │ Unified         │  │
│  │                 │                   │                 │  │
│  │ 30+ Tools:      │                   │ 15+ Tools:      │  │
│  │ • report_*      │                   │ • browser_*     │  │
│  └────────┬────────┘                   └────────┬────────┘  │
│           │                                     │            │
│           │ Analytics via NATS                  │            │
│           └─────────────┬───────────────────────┘            │
│                         │                                    │
│                         ▼                                    │
│              ┌──────────────────────┐                        │
│              │  NATS Publish Topics │                        │
│              │  • task.progress     │                        │
│              │  • task.milestone    │                        │
│              │  • task.analytics    │                        │
│              │  • task.completion   │                        │
│              └──────────┬───────────┘                        │
└──────────────────────────┼────────────────────────────────────┘
                           │
                           │ Analytics flow out
                           ▼
```

### Phase 3: Analytics Collection

```
         ┌─────────────────┐
         │   NATS Bus      │
         │  (Analytics)    │
         └────┬────────────┘
              │
              │ Manager subscribes to:
              │ • task.progress
              │ • task.milestone
              │ • task.analytics
              │ • task.completion
              │
              ▼
    ┌──────────────────────┐
    │   MCP Manager        │
    │  Analytics Handler   │
    └────┬─────────────┬───┘
         │             │
         │ Store       │ Cache
         ▼             ▼
┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │   Redis Cache   │
│                 │  │                 │
│ analytics table │  │ analytics:*     │
│ • id            │  │ (fast access)   │
│ • type          │  │                 │
│ • source_type   │  └─────────────────┘
│ • source_id     │
│ • data (JSONB)  │
│ • timestamp     │
└─────────────────┘
```

### Phase 4: Analytics Retrieval

```
┌─────────┐
│  User   │
└────┬────┘
     │
     │ Query analytics via MCP tools
     │
     ├──► get_analytics()
     │    • Queries PostgreSQL
     │    • Returns: [{analytics_type, data, timestamp}]
     │
     ├──► performance_report()
     │    • Aggregates performance metrics
     │    • Returns: event counts, avg times, totals
     │
     ├──► quality_dashboard()
     │    • Aggregates quality metrics
     │    • Returns: quality scores, coverage, errors
     │
     ├──► monitor_task()
     │    • Checks task status
     │    • Returns: status, progress, phase
     │
     └──► view_realtime_streams()
          • Queries stream_data table
          • Returns: live execution logs
```

---

## 📊 Detailed Data Flow Example

### Example: Screenshot Task Execution

```
TIME   COMPONENT           ACTION                           ANALYTICS CAPTURED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

T+0s   User                assign_task("Visit URL...")      -
       ↓
T+0s   MCP Manager         Create task in PostgreSQL        -
       ↓                   Publish to NATS
       ↓
T+0s   Docker Worker       Receive task                     -
       ↓                   Load analytics prompt
       ↓
T+1s   Cursor Agent        Start execution                  report_progress(0%)
       ↓                                                     └→ PostgreSQL
       ↓
T+2s   DOMLogger           browser_navigate(url)            report_milestone("nav")
       ↓                                                     report_analytics({
       ↓                                                       execution_time: 1500ms,
       ↓                                                       network_requests: 1
       ↓                                                     })
       ↓
T+5s   Cursor Agent        Progress update                  report_progress(50%)
       ↓
T+7s   DOMLogger           browser_screenshot()             report_milestone("screenshot")
       ↓                   Save to /root/hamid.png          report_analytics({
       ↓                                                       execution_time: 800ms,
       ↓                                                       screenshot_captured: true
       ↓                                                     })
       ↓
T+10s  Cursor Agent        Complete task                    report_progress(100%)
       ↓                                                     report_completion({
       ↓                                                       status: "success",
       ↓                                                       quality_score: 100
       ↓                                                     })
       ↓
T+11s  Remote Worker       Publish completion               -
       ↓                   to NATS
       ↓
T+11s  MCP Manager         Update task status               Store in PostgreSQL
       ↓                   in database
       ↓
T+12s  User                get_analytics()                  Returns all captured
                           performance_report()              analytics from database
```

---

## 🔧 Key Components Explained

### 1. MCP Manager Enhanced
**Location**: `/root/mcp-setup/mcp-manager/index-enhanced.js`

**Responsibilities**:
- Accept task assignments via MCP tools
- Store tasks in PostgreSQL
- Publish tasks to NATS queues
- Subscribe to analytics messages
- Aggregate and store analytics
- Provide analytics query interface

**Key Functions**:
```javascript
assign_task()          // Create & route tasks
monitor_task()         // Track task status
get_analytics()        // Query analytics data
performance_report()   // Aggregate metrics
quality_dashboard()    // Quality metrics
```

### 2. Remote Worker (Docker Container)
**Location**: `/root/mcp-setup/remote-worker-mcp/`

**Responsibilities**:
- Subscribe to worker-specific NATS queue
- Load custom analytics prompt
- Spawn cursor-agent with enhanced prompt
- Report task completion

**Key Features**:
- Volume mount: `/root` for screenshot output
- Network: `host` mode for direct access
- Environment: NATS, Redis, PostgreSQL connection info

### 3. Cursor Agent (AI)
**Execution**: Inside Docker container

**Responsibilities**:
- Read and follow analytics prompt
- Execute the task description
- Use MCP Worker Enhanced tools to report progress
- Use DOMLogger tools for browser automation

**Analytics Prompt Forces**:
- report_progress at 0%, 25%, 50%, 75%, 100%
- report_milestone for each major step
- report_analytics with performance data
- report_completion with final summary

### 4. MCP Worker Enhanced
**Location**: `/root/mcp-setup/remote-worker-mcp/mcp-worker/index-enhanced.js`

**30+ Analytics Tools**:
```javascript
report_progress        // Task progress %
report_milestone       // Major achievements
report_analytics       // Performance metrics
report_decision        // Decision points
report_plan            // Task planning
report_test_results    // Test outcomes
report_code_quality    // Code metrics
report_resource_usage  // Resource tracking
report_performance     // Performance profiling
report_error           // Error tracking
report_completion      // Final results
report_heartbeat       // Keep-alive
ask_manager            // Manager queries
request_resources      // Resource requests
```

### 5. DOMLogger Unified
**Location**: `/root/mcp-setup/remote-worker-mcp/domlogger/`

**15+ Browser Tools**:
```javascript
browser_navigate       // Navigate to URL
browser_screenshot     // Capture screenshots
browser_click          // Click elements
browser_type           // Type text
browser_inspect        // Inspect DOM
browser_get_content    // Get page content
```

---

## 💾 Database Schema

### Tasks Table
```sql
CREATE TABLE tasks (
    task_id VARCHAR(255) PRIMARY KEY,
    description TEXT,
    status VARCHAR(50),
    priority VARCHAR(50),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### Analytics Table
```sql
CREATE TABLE analytics (
    id SERIAL PRIMARY KEY,
    analytics_type VARCHAR(100),
    source_type VARCHAR(50),
    source_id VARCHAR(255),
    data JSONB,
    timestamp TIMESTAMP DEFAULT NOW()
);
```

### Remote Workers Table
```sql
CREATE TABLE remote_workers (
    worker_id VARCHAR(255) PRIMARY KEY,
    hostname VARCHAR(255),
    status VARCHAR(50),
    capabilities JSONB,
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

---

## 🚀 Quick Start Workflow

```
1. Start Infrastructure
   └─► ./setup-infrastructure.sh
       ├─ NATS on port 4222
       ├─ Redis on port 6379
       └─ PostgreSQL on port 5432

2. Start MCP Manager
   └─► node mcp-manager/index-enhanced.js &
       ├─ Connects to NATS/Redis/PostgreSQL
       ├─ Initializes database schema
       └─ Exposes MCP tools to Cursor

3. Build & Start Worker
   └─► docker build -t mcp-remote-worker-enhanced .
       docker run -d --network host -v /root:/root ...
       ├─ Loads analytics prompt
       ├─ Registers with manager
       └─ Subscribes to task queue

4. Assign Task via MCP Tools
   └─► assign_task({
         description: "Visit URL and screenshot",
         priority: "critical"
       })
       ├─ Task created in database
       ├─ Published to NATS
       └─ Worker receives & executes

5. Monitor & Retrieve Analytics
   └─► monitor_task(task_id)
       get_analytics()
       performance_report()
       ├─ Real-time status tracking
       ├─ Performance metrics
       └─ Quality scores
```

---

## 📈 Analytics Flow Diagram

```
CURSOR AGENT EXECUTION WITH ANALYTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Start Task
    │
    ├─► report_progress(0, "Starting task")
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► report_milestone("Initializing browser")
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► browser_navigate("https://url.com")
    │   └─► DOMLogger executes
    │
    ├─► report_analytics({
    │       execution_time_ms: 1500,
    │       network_requests: 1,
    │       page_load_successful: true
    │   })
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► report_progress(50, "Navigation complete")
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► report_milestone("Taking screenshot")
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► browser_screenshot("/root/hamid.png")
    │   └─► DOMLogger executes & saves file
    │
    ├─► report_analytics({
    │       execution_time_ms: 800,
    │       screenshot_captured: true,
    │       file_path: "/root/hamid.png"
    │   })
    │   └─► NATS → Manager → PostgreSQL
    │
    ├─► report_progress(100, "Task complete")
    │   └─► NATS → Manager → PostgreSQL
    │
    └─► report_completion({
            success: true,
            quality_score: 100,
            total_duration_ms: 2300
        })
        └─► NATS → Manager → PostgreSQL

End Task
```

---

## 🎯 Success Metrics

### Performance Analytics Captured
```
Navigation:
├─ execution_time_ms: 1,500
├─ network_requests: 1
└─ page_load_successful: true

Screenshot:
├─ execution_time_ms: 800
├─ screenshot_captured: true
└─ file_path: /root/hamid.png

Overall:
├─ total_duration: 65.2 seconds
├─ quality_score: 100/100
├─ progress_reports: 5
├─ milestone_reports: 3
└─ errors: 0
```

---

## 📚 File References

| Component | File Path |
|-----------|-----------|
| MCP Manager | `/root/mcp-setup/mcp-manager/index-enhanced.js` |
| Remote Worker | `/root/mcp-setup/remote-worker-mcp/remote-worker-mcp-client-simple.js` |
| MCP Worker Enhanced | `/root/mcp-setup/remote-worker-mcp/mcp-worker/index-enhanced.js` |
| DOMLogger | `/root/mcp-setup/remote-worker-mcp/domlogger/server.js` |
| Analytics Prompt | `/root/mcp-setup/remote-worker-mcp/ai-analytics-prompt.txt` |
| Dockerfile | `/root/mcp-setup/remote-worker-mcp/Dockerfile` |
| MCP Config | `/root/mcp-setup/remote-worker-mcp/mcp-config.json` |
| Cursor MCP Config | `/root/.cursor/mcp.json` |

---

**Last Updated**: October 31, 2025  
**Status**: ✅ Fully Operational with Complete Analytics
