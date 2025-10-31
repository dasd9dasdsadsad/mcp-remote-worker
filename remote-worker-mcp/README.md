# MCP-Enabled Remote Worker

This is an enhanced version of the remote worker that includes **full MCP (Model Context Protocol) capabilities** inside the Docker container.

## 🌟 Key Features

### **MCP Tools Integration**
- Workers can use MCP tools to dynamically report progress
- Access to `mcp-worker` tools for bidirectional communication
- Integrated `domlogger-unified` for web automation

### **Enhanced Reporting**
Instead of just executing commands, workers can:
- Use `report_progress` to send detailed updates
- Use `ask_manager_question` to request clarification
- Use `stream_llm_output` for real-time analytics
- Use `request_next_task` for continuous operation

### **Architecture Comparison**

#### Old Worker (Command-Only)
```
Worker → Executes cursor-agent → Reports completion
```

#### New MCP-Enabled Worker
```
Worker → Loads MCP servers → Uses MCP tools → Dynamic reporting
         ├── mcp-worker-tools (reporting, questions)
         └── domlogger-unified (web automation)
```

## 🚀 Quick Start

### **Local Testing**
```bash
# Start the MCP-enabled worker
./deploy-mcp-worker.sh start

# Check status
./deploy-mcp-worker.sh status

# View logs
./deploy-mcp-worker.sh logs
```

### **Remote Deployment**

For deploying on any server worldwide:

```bash
# Quick deployment
./deploy-remote.sh setup     # Create .env file
vim .env                     # Set MANAGER_HOST to your IP
./deploy-remote.sh deploy    # Build and start

# Or use docker-compose directly
docker-compose -f docker-compose.remote.yml up -d
```

**Key files for remote deployment:**
- `docker-compose.remote.yml` - Production-ready compose file
- `env.template` - Environment configuration template
- `deploy-remote.sh` - Easy deployment script
- `REMOTE_DEPLOYMENT_GUIDE.md` - Complete deployment guide

**Essential configuration:**
```bash
# .env file
MANAGER_HOST=your.manager.ip  # REQUIRED: Your manager server IP
CURSOR_API_KEY=key_xxx         # REQUIRED: Your Cursor API key
```

## 📦 MCP Tools Available

### **From mcp-worker:**
- `report_progress` - Report task progress with metrics
- `report_completion` - Report task completion with results
- `report_heartbeat` - Send heartbeat with system info
- `stream_llm_output` - Stream LLM thinking and outputs
- `ask_manager_question` - Ask manager for guidance
- `request_next_task` - Request next task after completion
- `request_session_end` - Request to end worker session
- `query_redis_cache` - Query Redis for data
- `query_task_database` - Query PostgreSQL for history
- `request_worker_status` - Check status of other workers

### **From domlogger-unified:**
- Web automation tools
- DOM inspection
- Browser control
- Screenshot capabilities

## 🔧 Configuration

### **Environment Variables**
```bash
# Infrastructure
MANAGER_HOST=localhost      # Manager server IP
NATS_HOST=localhost        # NATS broker
REDIS_HOST=localhost       # Redis cache
POSTGRES_HOST=localhost    # PostgreSQL database

# Worker Settings
WORKER_ID=                 # Auto-generated if empty
WORKER_TAGS=mcp,enhanced   # Tags for categorization
CURSOR_API_KEY=key_xxx     # Your Cursor API key

# MCP Settings
MCP_ENABLED=true
MCP_SERVERS=mcp-worker,domlogger-unified
```

## 📊 How It Works

1. **Container Starts**
   - Connects to NATS, Redis, PostgreSQL
   - Starts internal MCP servers
   - Registers as MCP-enabled worker

2. **Task Assignment**
   - Manager assigns task via NATS
   - Worker receives task description

3. **MCP Execution**
   - Worker runs `cursor-agent` with MCP config
   - Agent can use all MCP tools
   - Real-time reporting via MCP tools

4. **Dynamic Reporting**
   - Progress updates via `report_progress`
   - Questions via `ask_manager_question`
   - Results via `report_completion`

## 🛠️ Management Commands

```bash
# Build image
./deploy-mcp-worker.sh build

# Start worker
./deploy-mcp-worker.sh start

# Stop worker
./deploy-mcp-worker.sh stop

# Restart worker
./deploy-mcp-worker.sh restart

# View logs
./deploy-mcp-worker.sh logs

# Check status
./deploy-mcp-worker.sh status

# Open shell
./deploy-mcp-worker.sh shell

# Test MCP tools
./deploy-mcp-worker.sh test-mcp

# Clean up
./deploy-mcp-worker.sh clean
```

## 🔍 Debugging

### **Check MCP servers are running:**
```bash
docker exec mcp-remote-worker-enhanced-1 ps aux | grep node
```

### **View MCP configuration:**
```bash
docker exec mcp-remote-worker-enhanced-1 cat /root/.cursor/mcp.json
```

### **Test MCP tools:**
```bash
./deploy-mcp-worker.sh test-mcp
```

## 🌐 Use Cases

1. **Interactive Tasks**
   - Worker can ask questions during execution
   - Manager can provide guidance via MCP tools

2. **Web Automation**
   - Use domlogger for browser automation
   - Capture screenshots and DOM state

3. **Continuous Operation**
   - Worker requests next task after completion
   - No need to restart for each task

4. **Advanced Analytics**
   - Stream LLM outputs for analysis
   - Real-time progress tracking

## 📈 Benefits Over Standard Worker

| Feature | Standard Worker | MCP-Enabled Worker |
|---------|----------------|-------------------|
| Task Execution | ✅ cursor-agent | ✅ cursor-agent with MCP |
| Progress Reporting | ❌ Only completion | ✅ Real-time updates |
| Bidirectional Comm | ❌ One-way | ✅ Questions & answers |
| Web Automation | ❌ Limited | ✅ Full domlogger |
| Tool Access | ❌ CLI only | ✅ All MCP tools |
| Session Management | ❌ Single task | ✅ Continuous tasks |

## 🚨 Important Notes

1. **Resource Usage**: MCP servers require more memory (~4GB recommended)
2. **Chrome/Chromium**: Required for domlogger functionality
3. **Network**: Ensure all ports are accessible for remote deployment
4. **Security**: Use strong passwords and TLS for production

## 🔮 Future Enhancements

- [ ] Add more MCP servers (filesystem, git, etc.)
- [ ] Implement worker pooling with MCP
- [ ] Add web UI for MCP tool visualization
- [ ] Create custom MCP tools for specific tasks
