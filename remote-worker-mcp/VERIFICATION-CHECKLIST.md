# MCP Worker System - Verification Checklist

## ✅ System Health Check

Use this checklist to verify your MCP Worker deployment is functioning correctly.

### 1. Infrastructure Services

```bash
# Check NATS
curl -s http://localhost:8222/varz | jq '.connections'

# Check Redis
redis-cli ping

# Check PostgreSQL
PGPASSWORD=postgres psql -h localhost -U postgres -d mcp_manager -c "SELECT COUNT(*) FROM remote_workers;"
```

**Expected Results:**
- NATS: Returns connection count
- Redis: Returns "PONG"
- PostgreSQL: Returns worker count

### 2. Docker Container Status

```bash
docker ps --filter "name=mcp-worker"
docker logs mcp-worker --tail 20
```

**Expected Output:**
```
✅ Connected to NATS
✅ Connected to Redis
✅ Connected to PostgreSQL
✅ Worker registered: <worker-id>
✅ Worker ready and waiting for tasks!
```

### 3. Worker Registration

From Cursor IDE with MCP Manager:

```typescript
// Should return your worker
mcp_mcp-manager_list_remote_workers({
  status_filter: "idle",
  include_stats: true
})
```

**Expected:**
- Worker appears in list
- Status: "idle"
- Last heartbeat: recent (< 30 seconds ago)
- MCP servers: ["mcp-worker-tools", "domlogger-unified"]

### 4. cursor-agent Installation

```bash
docker exec mcp-worker cursor-agent --version
```

**Expected:** Version number (e.g., `2025.10.28-0a91dc2`)

### 5. API Key Configuration

```bash
docker exec mcp-worker bash -c 'echo $CURSOR_API_KEY | cut -c1-10'
```

**Expected:** Should show first 10 chars of your API key

### 6. End-to-End Task Execution

```typescript
// Assign a simple test task
const result = await mcp_mcp-manager_assign_remote_task({
  worker_id: "<YOUR_WORKER_ID>",
  task_description: "Create a file at /app/test.txt with the text: Hello from MCP Worker!",
  task_priority: "high",
  timeout_ms: 60000
})

// Monitor the task
await mcp_mcp-manager_monitor_task_realtime({
  task_id: result.task_id,
  duration_seconds: 30
})
```

**Expected:**
- Task assigns successfully
- Worker executes task
- File is created
- Task completes with exit code 0

### 7. Verify Task Output

```bash
docker exec mcp-worker cat /app/test.txt
```

**Expected:** `Hello from MCP Worker!`

### 8. Database Verification

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d mcp_manager -c "
  SELECT 
    worker_id,
    status,
    last_heartbeat,
    EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) as seconds_ago
  FROM remote_workers
  WHERE last_heartbeat > NOW() - INTERVAL '1 minute';
"
```

**Expected:** Your worker with recent heartbeat

### 9. Real-time Monitoring

```typescript
// Get worker analytics
await mcp_mcp-manager_get_worker_analytics({
  time_range: "last_hour"
})
```

**Expected:** Statistics about task execution

### 10. Network Connectivity (Remote Deployment)

```bash
# From remote server, test connections to manager
docker exec mcp-worker nc -zv <MANAGER_IP> 4222  # NATS
docker exec mcp-worker nc -zv <MANAGER_IP> 6379  # Redis
docker exec mcp-worker nc -zv <MANAGER_IP> 5432  # PostgreSQL
```

**Expected:** All connections succeed

## 🔧 Troubleshooting

### Worker Not Appearing

1. Check container logs:
   ```bash
   docker logs mcp-worker --tail 100
   ```

2. Verify services are accessible:
   ```bash
   docker exec mcp-worker ping -c 3 <MANAGER_HOST>
   ```

3. Check worker registration in PostgreSQL:
   ```bash
   PGPASSWORD=postgres psql -h localhost -U postgres -d mcp_manager -c "
     SELECT * FROM remote_workers ORDER BY registered_at DESC LIMIT 5;
   "
   ```

### Tasks Not Executing

1. Verify cursor-agent:
   ```bash
   docker exec mcp-worker cursor-agent --version
   ```

2. Test cursor-agent manually:
   ```bash
   docker exec mcp-worker bash -c "
     export CURSOR_API_KEY=<YOUR_KEY> && 
     cursor-agent --model auto -p 'Say: test'
   "
   ```

3. Check task listener:
   ```bash
   docker logs mcp-worker | grep "Subscribed to"
   ```

### API Key Issues

1. Verify key is set:
   ```bash
   docker exec mcp-worker printenv | grep CURSOR_API_KEY
   ```

2. Test with curl (if using API directly):
   ```bash
   curl -H "Authorization: Bearer $CURSOR_API_KEY" https://api.cursor.com/v1/health
   ```

### Network Issues (Remote Deployment)

1. Check firewall rules allow:
   - Port 4222 (NATS)
   - Port 6379 (Redis)
   - Port 5432 (PostgreSQL)

2. Verify security groups/iptables:
   ```bash
   # On manager server
   sudo iptables -L -n | grep -E "4222|6379|5432"
   ```

## 📊 Success Metrics

Your system is working correctly if:

- [ ] Worker appears in `list_remote_workers`
- [ ] Heartbeats are current (< 30 seconds old)
- [ ] Tasks can be assigned successfully
- [ ] cursor-agent executes without errors
- [ ] Files are created as expected
- [ ] Task completion is reported
- [ ] Database shows worker activity
- [ ] No error messages in logs

## 🎯 Performance Benchmarks

Typical performance metrics:

- **Worker Registration:** < 2 seconds
- **Heartbeat Interval:** 10 seconds
- **Task Assignment Latency:** < 100ms
- **Simple Task Execution:** 5-15 seconds
- **Complex Task Execution:** 30-120 seconds
- **File I/O Operations:** < 1 second

## 📝 Maintenance Tasks

Regular checks to perform:

### Daily
- [ ] Check worker heartbeats
- [ ] Review task completion rates
- [ ] Monitor error logs

### Weekly
- [ ] Review database growth
- [ ] Check Redis memory usage
- [ ] Analyze task performance metrics
- [ ] Review and clean up old task records

### Monthly
- [ ] Update Docker images
- [ ] Review and optimize queries
- [ ] Backup PostgreSQL database
- [ ] Review security configurations

## 🚨 Alert Conditions

Set up alerts for:

- Worker heartbeat > 60 seconds old
- Task failure rate > 10%
- Database connection errors
- Redis memory > 80% usage
- NATS connection failures
- Disk space < 20% free

## 📞 Support Information

If issues persist:

1. Check DEPLOYMENT-GUIDE.md
2. Review all error logs
3. Verify all environment variables
4. Test each component independently
5. Check network connectivity
6. Verify API key validity

---

**Last Updated:** 2025-10-30
**Version:** Production v1.0
**Status:** ✅ Verified Working
