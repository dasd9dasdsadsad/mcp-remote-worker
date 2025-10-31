# MCP Worker - Remote Deployment Guide

## ✅ System Verified Working

The MCP Worker system has been successfully tested end-to-end with:
- ✅ Docker container deployment
- ✅ NATS/Redis/PostgreSQL connectivity  
- ✅ MCP Manager task assignment
- ✅ cursor-agent execution with `--model auto` flag
- ✅ Task completion and reporting

## 🚀 Quick Deployment

### Prerequisites
- Docker installed on remote server
- Access to manager server (NATS, Redis, PostgreSQL)
- Cursor API key

### 1. Build the Docker Image

```bash
cd /root/mcp-setup/remote-worker-mcp
docker build -t mcp-worker-production:latest .
```

### 2. Deploy on Remote Server

#### Option A: Direct Docker Run (Recommended for Testing)

```bash
docker run -d \
  --name mcp-worker \
  --network host \
  --entrypoint node \
  -e MANAGER_HOST=<MANAGER_IP> \
  -e NATS_HOST=<MANAGER_IP> \
  -e REDIS_HOST=<MANAGER_IP> \
  -e POSTGRES_HOST=<MANAGER_IP> \
  -e CURSOR_API_KEY=<YOUR_API_KEY> \
  -e WORKER_TAGS="mcp,docker,remote,production" \
  -e MAX_CONCURRENT_TASKS=5 \
  mcp-worker-production:latest \
  /app/remote-worker-mcp-client-simple.js
```

#### Option B: Docker Compose (Recommended for Production)

Create `docker-compose.remote.yml`:

```yaml
version: '3.8'

services:
  worker:
    image: mcp-worker-production:latest
    container_name: mcp-worker
    network_mode: host
    entrypoint: node
    command: /app/remote-worker-mcp-client-simple.js
    environment:
      MANAGER_HOST: ${MANAGER_HOST}
      NATS_HOST: ${MANAGER_HOST}
      REDIS_HOST: ${MANAGER_HOST}
      POSTGRES_HOST: ${MANAGER_HOST}
      CURSOR_API_KEY: ${CURSOR_API_KEY}
      WORKER_TAGS: "mcp,docker,remote,production"
      MAX_CONCURRENT_TASKS: 5
    restart: unless-stopped
```

Create `.env` file:
```bash
MANAGER_HOST=<MANAGER_IP>
CURSOR_API_KEY=<YOUR_API_KEY>
```

Deploy:
```bash
docker-compose -f docker-compose.remote.yml up -d
```

### 3. Install cursor-agent in Container

After the container starts, copy cursor-agent:

```bash
# On the host with cursor-agent installed:
CURSOR_AGENT_PATH=$(readlink -f ~/.local/bin/cursor-agent)
CURSOR_AGENT_DIR=$(dirname $CURSOR_AGENT_PATH)

# Create archive
tar -czf /tmp/cursor-agent.tar.gz -C $CURSOR_AGENT_DIR .

# Copy to container
docker cp /tmp/cursor-agent.tar.gz mcp-worker:/tmp/
docker exec mcp-worker bash -c "mkdir -p /root/.local/share/cursor-agent/versions/2025.10.28-0a91dc2 && cd /root/.local/share/cursor-agent/versions/2025.10.28-0a91dc2 && tar -xzf /tmp/cursor-agent.tar.gz && ln -sf /root/.local/share/cursor-agent/versions/2025.10.28-0a91dc2/cursor-agent /usr/local/bin/cursor-agent"

# Verify
docker exec mcp-worker cursor-agent --version
```

## 🔍 Verification

### Check Worker Registration

From Cursor IDE with MCP Manager connected:

```typescript
// List all remote workers
mcp_mcp-manager_list_remote_workers({
  status_filter: "idle",
  include_stats: true
})
```

### Assign Test Task

```typescript
// Assign a test task
mcp_mcp-manager_assign_remote_task({
  worker_id: "<WORKER_ID_FROM_LIST>",
  task_description: "Create a test file at /app/test.txt with message: Hello from remote worker!",
  task_priority: "high",
  timeout_ms: 60000
})
```

### Monitor Task Execution

```typescript
// Monitor in real-time
mcp_mcp-manager_monitor_task_realtime({
  task_id: "<TASK_ID>",
  duration_seconds: 30
})
```

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Remote Server (Anywhere)                   │
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │         Docker Container: mcp-worker               │   │
│  │                                                    │   │
│  │  • remote-worker-mcp-client-simple.js             │   │
│  │  • cursor-agent (--model auto)                    │   │
│  │  • Direct execution (no wrapper scripts)          │   │
│  │                                                    │   │
│  └────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          │ Network Connection                │
└──────────────────────────┼───────────────────────────────────┘
                           │
                           │ NATS/Redis/PostgreSQL
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                   Manager Server                             │
│                                                              │
│  ┌──────────┐  ┌─────────┐  ┌──────────────┐             │
│  │   NATS   │  │  Redis  │  │ PostgreSQL   │             │
│  └──────────┘  └─────────┘  └──────────────┘             │
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │              MCP Manager                           │   │
│  │  (Cursor IDE with MCP Manager connected)          │   │
│  └────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MANAGER_HOST` | Manager server IP/hostname | localhost | Yes |
| `NATS_HOST` | NATS broker host | MANAGER_HOST | No |
| `NATS_PORT` | NATS broker port | 4222 | No |
| `REDIS_HOST` | Redis host | MANAGER_HOST | No |
| `REDIS_PORT` | Redis port | 6379 | No |
| `POSTGRES_HOST` | PostgreSQL host | MANAGER_HOST | No |
| `POSTGRES_PORT` | PostgreSQL port | 5432 | No |
| `POSTGRES_DB` | Database name | mcp_manager | No |
| `POSTGRES_USER` | Database user | postgres | No |
| `POSTGRES_PASSWORD` | Database password | postgres | No |
| `CURSOR_API_KEY` | Cursor API key | - | Yes |
| `WORKER_TAGS` | Comma-separated tags | mcp,docker,remote | No |
| `MAX_CONCURRENT_TASKS` | Max tasks at once | 5 | No |
| `HEARTBEAT_INTERVAL_MS` | Heartbeat frequency | 10000 | No |

## 📋 Troubleshooting

### Worker Not Appearing in List

1. Check container logs:
```bash
docker logs mcp-worker --tail 50
```

2. Verify connectivity:
```bash
docker exec mcp-worker ping -c 3 <MANAGER_HOST>
```

3. Check if NATS/Redis/PostgreSQL are accessible:
```bash
docker exec mcp-worker nc -zv <MANAGER_HOST> 4222  # NATS
docker exec mcp-worker nc -zv <MANAGER_HOST> 6379  # Redis
docker exec mcp-worker nc -zv <MANAGER_HOST> 5432  # PostgreSQL
```

### Tasks Not Executing

1. Verify cursor-agent is installed:
```bash
docker exec mcp-worker cursor-agent --version
```

2. Check API key:
```bash
docker exec mcp-worker bash -c "echo \$CURSOR_API_KEY"
```

3. Test cursor-agent manually:
```bash
docker exec mcp-worker cursor-agent --model auto -p "Say: test"
```

### Container Keeps Restarting

1. Check logs for errors:
```bash
docker logs mcp-worker
```

2. Common issues:
   - Manager services not accessible
   - Invalid API key
   - Network connectivity problems
   - cursor-agent not installed

## 🎯 Production Recommendations

1. **Security**
   - Use TLS for NATS, Redis, PostgreSQL connections
   - Store API keys in secrets management (Docker secrets, Kubernetes secrets)
   - Use firewall rules to restrict access

2. **Monitoring**
   - Set up logging aggregation (ELK, Loki)
   - Monitor heartbeats and task completion rates
   - Alert on worker disconnections

3. **Scaling**
   - Deploy multiple workers across different servers
   - Use Docker Swarm or Kubernetes for orchestration
   - Implement load balancing for task distribution

4. **Backup**
   - Regular PostgreSQL backups
   - Document worker configurations
   - Version control Docker images

## ✅ Success Indicators

When everything is working correctly, you'll see:

1. **In worker logs:**
```
✅ Connected to NATS
✅ Connected to Redis
✅ Connected to PostgreSQL
✅ Worker registered: <worker-id>
✅ Worker ready and waiting for tasks!
```

2. **In MCP Manager:**
- Worker appears in `list_remote_workers` with status "idle"
- Last heartbeat is recent (< 30 seconds ago)
- Tasks can be assigned and complete successfully

3. **In PostgreSQL:**
```sql
SELECT worker_id, status, last_heartbeat 
FROM remote_workers 
WHERE last_heartbeat > NOW() - INTERVAL '1 minute';
```

## 🚨 Known Limitations

1. **cursor-agent Installation**
   - Must be manually copied after container starts
   - Future: Automate in Dockerfile or use init script

2. **Network Mode**
   - Currently uses `host` network mode
   - For bridge mode, need to expose and map ports

3. **MCP Servers Inside Container**
   - domlogger-unified requires Chrome (included)
   - Some MCP tools may not work in containerized environment

## 📚 Additional Resources

- [NATS Documentation](https://docs.nats.io/)
- [Redis Documentation](https://redis.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)

## 🎉 Success!

Your MCP Worker system is now ready for production deployment! Workers can be deployed on any server worldwide and will automatically connect to your manager for task execution.

**Test Result:** ✅ Successfully created file via task assignment
**Date:** 2025-10-30
**Version:** Production v1.0


