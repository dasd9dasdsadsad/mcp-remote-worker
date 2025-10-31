# 🐛 Debug GitHub Actions Workers in Real-Time

## Overview

You can now get an **interactive SSH shell** directly into the GitHub Actions runner to debug workers in real-time!

---

## 🚀 Quick Start

### 1. Trigger the Debug Workflow

Go to: https://github.com/dasd9dasdsadsad/mcp-remote-worker/actions

Click on **"🐛 Debug Workers (Interactive SSH Shell)"**

Click **"Run workflow"**

Set parameters:
- `num_workers`: How many workers to spawn (default: 2)

Click **"Run workflow"**

### 2. Wait for SSH Link

The workflow will:
1. ✅ Connect to your server (165.232.134.47)
2. ✅ Pull worker Docker image
3. ✅ Spawn workers
4. ✅ Generate SSH link via tmate

**Look for this in the logs:**

```
═══════════════════════════════════════════════════════════════
🐛 SSH SESSION READY!
═══════════════════════════════════════════════════════════════

Web Shell:  https://tmate.io/t/xxxxxxxxxxx
SSH:        ssh xxxxxxxxxxx@nyc1.tmate.io

Copy one of these links to connect!
═══════════════════════════════════════════════════════════════
```

### 3. Connect via SSH

**Option A: Web Browser** (Easiest)
- Click the `https://tmate.io/t/...` link
- Opens in your browser
- Full terminal access!

**Option B: SSH Client**
```bash
ssh xxxxxxxxxxx@nyc1.tmate.io
```

---

## 🔧 What You Can Do Once Connected

### View Running Workers

```bash
# List all containers
docker ps

# Should show:
# github-worker-{RUN_ID}-1
# github-worker-{RUN_ID}-2
```

### Check Worker Logs

```bash
# View logs
docker logs github-worker-18962919292-1

# Follow logs in real-time
docker logs -f github-worker-18962919292-1

# Last 100 lines
docker logs --tail 100 github-worker-18962919292-1
```

### Exec Into Worker Container

```bash
# Get a shell inside the worker
docker exec -it github-worker-18962919292-1 bash

# Now you're INSIDE the worker container!
# Check if cursor-agent is installed
which cursor-agent

# Check MCP config
cat /root/.cursor/mcp.json

# Check environment variables
env | grep -E "NATS|REDIS|POSTGRES|MANAGER"

# Exit worker container
exit
```

### Test Connectivity from Worker

```bash
# Test NATS connection FROM worker
docker exec github-worker-18962919292-1 nc -zv 165.232.134.47 4222

# Test Redis
docker exec github-worker-18962919292-1 nc -zv 165.232.134.47 6379

# Test PostgreSQL
docker exec github-worker-18962919292-1 nc -zv 165.232.134.47 5432
```

### Manually Trigger Worker Actions

```bash
# Send a test task to worker (requires custom script)
# First, check if worker is listening

# View worker's Node.js process
docker exec github-worker-18962919292-1 ps aux | grep node

# Check worker's network connections
docker exec github-worker-18962919292-1 netstat -tulpn
```

### Monitor System Resources

```bash
# View resource usage
docker stats

# View specific container stats
docker stats github-worker-18962919292-1

# Check disk usage
df -h

# Check memory
free -h
```

### Debug Database Connections

```bash
# Install PostgreSQL client if needed
sudo apt-get update
sudo apt-get install -y postgresql-client

# Connect to your database
psql -h 165.232.134.47 -U postgres -d mcp_manager

# Check workers
SELECT * FROM remote_workers ORDER BY registered_at DESC;

# Check tasks
SELECT * FROM tasks ORDER BY created_at DESC;

# Exit psql
\q
```

### Test Worker Registration

```bash
# Check if worker registered
psql -h 165.232.134.47 -U postgres -d mcp_manager -c "
  SELECT worker_id, status, manager_host, last_heartbeat 
  FROM remote_workers 
  WHERE worker_id LIKE 'github-debug%';
"
```

### Restart a Worker

```bash
# Stop worker
docker stop github-worker-18962919292-1

# Start it again
docker start github-worker-18962919292-1

# Or restart
docker restart github-worker-18962919292-1

# View new logs
docker logs -f github-worker-18962919292-1
```

### Manually Assign a Task (via Database)

```bash
# Insert task directly into database
psql -h 165.232.134.47 -U postgres -d mcp_manager << 'EOFSQL'
INSERT INTO tasks (task_id, worker_id, description, status, priority)
VALUES (
  'manual-test-task',
  'github-debug-worker-18962919292-1',
  'Visit https://example.com and take screenshot',
  'assigned',
  'high'
);
EOFSQL

# Check if worker picked it up
docker logs -f github-worker-18962919292-1
```

### Check GitHub Actions Environment

```bash
# View all environment variables
env | sort

# GitHub-specific variables
env | grep GITHUB

# Runner information
echo "Runner: $RUNNER_NAME"
echo "Workflow: $GITHUB_WORKFLOW"
echo "Run ID: $GITHUB_RUN_ID"
```

---

## 🎯 Common Debugging Scenarios

### Scenario 1: Worker Not Registering

```bash
# 1. Check worker logs
docker logs github-worker-18962919292-1

# 2. Look for errors:
#    - "relation remote_workers does not exist" → Database issue
#    - "Connection refused" → Network issue
#    - "spawn cursor-agent ENOENT" → Missing binary

# 3. Test connectivity
docker exec github-worker-18962919292-1 nc -zv 165.232.134.47 5432

# 4. Check database table exists
psql -h 165.232.134.47 -U postgres -d mcp_manager -c "\d remote_workers"
```

### Scenario 2: Worker Not Receiving Tasks

```bash
# 1. Check if worker is subscribed to NATS topic
docker logs github-worker-18962919292-1 | grep "Subscribed to"

# Should show: "✅ Subscribed to: worker.task.github-debug-worker-..."

# 2. Test NATS connection
docker exec github-worker-18962919292-1 nc -zv 165.232.134.47 4222

# 3. Check worker status in database
psql -h 165.232.134.47 -U postgres -d mcp_manager -c "
  SELECT worker_id, status, last_heartbeat 
  FROM remote_workers 
  WHERE worker_id LIKE 'github-debug%';
"
```

### Scenario 3: Cursor Agent Not Working

```bash
# 1. Exec into worker
docker exec -it github-worker-18962919292-1 bash

# 2. Check cursor-agent exists
which cursor-agent
ls -la /root/.local/bin/cursor-agent

# 3. Try running it manually
cursor-agent --version

# 4. Check API key
echo $CURSOR_API_KEY

# 5. Check MCP config
cat /root/.cursor/mcp.json

# 6. Exit
exit
```

### Scenario 4: Screenshot Not Saving

```bash
# 1. Check if Chromium is installed
docker exec github-worker-18962919292-1 which chromium

# 2. Check screenshot directory
docker exec github-worker-18962919292-1 ls -la /root/

# 3. Try manual screenshot (if worker has puppeteer)
docker exec -it github-worker-18962919292-1 bash
node -e "const puppeteer = require('puppeteer'); (async () => { const browser = await puppeteer.launch(); const page = await browser.newPage(); await page.goto('https://example.com'); await page.screenshot({path: '/root/test.png'}); await browser.close(); })();"
exit

# 4. Check if file was created
docker exec github-worker-18962919292-1 ls -la /root/test.png
```

---

## 💡 Tips

### Keep Session Alive

The SSH session will timeout after 5 hours (300 minutes). To keep it alive:

```bash
# In your local terminal, keep pinging
while true; do echo "alive"; sleep 60; done
```

### Download Files from Worker

```bash
# Copy screenshot from worker container
docker cp github-worker-18962919292-1:/root/screenshot.png ./screenshot.png

# View locally (if you have image viewer)
# Or upload to GitHub release artifacts
```

### View Multiple Logs at Once

```bash
# Follow all worker logs simultaneously
docker logs -f github-worker-18962919292-1 &
docker logs -f github-worker-18962919292-2 &

# To stop, press Ctrl+C multiple times or:
killall docker
```

### Exit Cleanly

When done debugging:

1. Press `Ctrl+D` or type `exit` in SSH session
2. Workflow will continue and cleanup automatically
3. Or click "Cancel workflow" in GitHub Actions UI

---

## ⚠️ Important Notes

### Timeout Limits

- **Workflow timeout**: 6 hours max (360 minutes)
- **SSH session timeout**: 5 hours (300 minutes)
- **GitHub Actions hard limit**: 6 hours total

### Security

- SSH link is publicly accessible (anyone with link can connect)
- Don't expose sensitive data in the session
- Links expire after workflow ends

### Costs

- This uses GitHub Actions minutes
- Free tier: 2,000 minutes/month
- 6-hour session = 360 minutes used

---

## 🚀 Advanced: Custom Test Scripts

### Create a Test Script

While in SSH session:

```bash
# Create test script
cat > /tmp/test-worker.sh << 'EOFSCRIPT'
#!/bin/bash

WORKER_ID=$(docker ps --format "{{.Names}}" | grep github-worker | head -1)

echo "Testing worker: $WORKER_ID"

# Test 1: Check registration
echo "1. Checking registration..."
psql -h 165.232.134.47 -U postgres -d mcp_manager -c "
  SELECT worker_id, status FROM remote_workers WHERE worker_id LIKE 'github-debug%';
"

# Test 2: Check connectivity
echo "2. Testing connectivity..."
docker exec $WORKER_ID nc -zv 165.232.134.47 4222

# Test 3: View logs
echo "3. Recent logs..."
docker logs --tail 20 $WORKER_ID

echo "Done!"
EOFSCRIPT

chmod +x /tmp/test-worker.sh
/tmp/test-worker.sh
```

---

## 📚 Next Steps

After debugging, you can:

1. **Fix issues** in your local code
2. **Rebuild Docker image**
3. **Push to Docker Hub**
4. **Trigger regular workflow** to test

Or continue debugging with this interactive session!

---

## ✅ Summary

```
1. Trigger workflow   → Get SSH link
2. Connect via SSH    → Full terminal access
3. Debug in real-time → View logs, exec into containers
4. Test changes       → Restart containers, modify files
5. Exit cleanly       → Workflow cleans up automatically
```

**This is THE BEST way to debug GitHub Actions workers!** 🎉

