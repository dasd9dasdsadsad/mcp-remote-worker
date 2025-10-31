# 🚀 Deploy MCP Workers Anywhere - SIMPLE GUIDE

**Deploy workers on ANY server that connect back to: `165.232.134.47`**

---

## ⚡ Quick Deploy (One Command)

### On ANY server with Docker installed:

```bash
docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -e WORKER_TAGS="production,$(hostname)" \
  -v /tmp/screenshots:/root \
  ghcr.io/your-username/mcp-remote-worker:latest
```

**That's it!** The worker will automatically connect to `165.232.134.47` and register itself.

---

## 📋 What You Need

### On the Manager Server (165.232.134.47):
- [x] NATS running on port 4222
- [x] Redis running on port 6379  
- [x] PostgreSQL running on port 5432
- [x] MCP Manager running
- [x] Ports 4222, 6379, 5432 open in firewall

### On Worker Servers (anywhere in the world):
- ✅ Docker installed
- ✅ Internet access to 165.232.134.47
- ✅ No ports need to be open (workers connect outbound only!)

---

## 🔧 Step-by-Step Setup

### Step 1: Build & Push Docker Image (Do this ONCE on manager server)

```bash
cd /root/mcp-setup/remote-worker-mcp

# Build the image
docker build -t mcp-remote-worker:latest .

# Tag it for your registry (Docker Hub example)
docker tag mcp-remote-worker:latest YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest

# Push to registry
docker login
docker push YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### Step 2: Deploy Workers on Remote Servers

**On ANY server anywhere in the world:**

```bash
# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Pull and run the worker
docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -v /tmp/screenshots:/root \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest

# Check logs
docker logs -f mcp-worker
```

### Step 3: Verify Worker Connected

**On manager server or via Cursor:**

```javascript
// Use MCP Manager tools
manage_workers({ action: "list" })

// You should see your new worker!
```

---

## 🌍 Deploy to Multiple Locations

### AWS (us-east-1)
```bash
ssh user@aws-server
docker run -d --name mcp-worker-aws \
  -e WORKER_TAGS="production,aws,us-east-1" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### DigitalOcean (nyc3)
```bash
ssh user@do-server
docker run -d --name mcp-worker-do \
  -e WORKER_TAGS="production,digitalocean,nyc3" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### Google Cloud (europe-west1)
```bash
ssh user@gcp-server
docker run -d --name mcp-worker-gcp \
  -e WORKER_TAGS="production,gcp,europe-west1" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### Your Home Lab
```bash
docker run -d --name mcp-worker-home \
  -e WORKER_TAGS="production,homelab" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

---

## 🎯 Customization Options

### Custom Worker ID
```bash
docker run -d \
  --name mcp-worker \
  -e WORKER_ID="my-special-worker-001" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### Custom Tags
```bash
docker run -d \
  --name mcp-worker \
  -e WORKER_TAGS="production,highcpu,europe,testing" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### More Resources
```bash
docker run -d \
  --name mcp-worker \
  -e MAX_CONCURRENT_TASKS="10" \
  -e MAX_MEMORY_MB="8192" \
  --memory="8g" \
  --cpus="4" \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

### Custom Screenshot Location
```bash
docker run -d \
  --name mcp-worker \
  -v /home/user/screenshots:/root \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
```

---

## 🔍 Verification & Monitoring

### Check if Worker is Running
```bash
docker ps | grep mcp-worker
```

### View Worker Logs
```bash
docker logs -f mcp-worker
```

### Check Connection Status
```bash
docker logs mcp-worker | grep -i "connected"
docker logs mcp-worker | grep -i "register"
```

### Restart Worker
```bash
docker restart mcp-worker
```

### Stop Worker
```bash
docker stop mcp-worker
docker rm mcp-worker
```

---

## 🐛 Troubleshooting

### Worker Won't Connect

**Check network connectivity to manager:**
```bash
# Test NATS port
nc -zv 165.232.134.47 4222

# Test Redis port
nc -zv 165.232.134.47 6379

# Test PostgreSQL port
nc -zv 165.232.134.47 5432
```

**Check Docker logs:**
```bash
docker logs mcp-worker | grep -i error
docker logs mcp-worker | tail -100
```

**Firewall on manager server:**
```bash
# On 165.232.134.47
sudo ufw status
sudo ufw allow 4222/tcp
sudo ufw allow 6379/tcp
sudo ufw allow 5432/tcp
```

### Worker Crashes Immediately

**Check cursor-agent installation:**
```bash
docker exec mcp-worker which cursor-agent
docker exec mcp-worker cursor-agent --version
```

**Check environment variables:**
```bash
docker exec mcp-worker env | grep MANAGER
```

**Rebuild with verbose output:**
```bash
docker run -it --rm \
  --name mcp-worker-debug \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest \
  /bin/bash
```

---

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Manager Server                            │
│                   165.232.134.47                             │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐ │
│  │  NATS    │  │  Redis   │  │PostgreSQL│  │MCP Manager │ │
│  │  :4222   │  │  :6379   │  │  :5432   │  │   :3000    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           │ Internet / Public Network
          ═════════════════╪═════════════════════════════════
                           │
                           │ Workers Connect OUT to Manager
                           │ (No inbound ports needed!)
                           │
          ┌────────────────┼────────────────┬────────────────┐
          │                │                │                │
          ▼                ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Worker 1 │     │ Worker 2 │    │ Worker 3 │    │ Worker N │
    │  (AWS)   │     │  (GCP)   │    │ (Azure)  │    │(HomeServ)│
    │          │     │          │    │          │    │          │
    │ ANY IP   │     │ ANY IP   │    │ ANY IP   │    │ ANY IP   │
    │ Any Port │     │ Any Port │    │ Any Port │    │ Any Port │
    └──────────┘     └──────────┘    └──────────┘    └──────────┘
```

**Key Points:**
- ✅ Workers connect TO manager (outbound connections)
- ✅ Manager doesn't need to know worker IPs
- ✅ Workers can be behind NAT/firewall (no port forwarding needed!)
- ✅ Workers auto-register with unique IDs
- ✅ Manager tracks all workers via heartbeats

---

## 🚀 Scaling to 100+ Workers

### Deploy Script for Mass Deployment

Create `deploy-workers.sh`:

```bash
#!/bin/bash

# List of your servers
SERVERS=(
  "user@server1.example.com"
  "user@server2.example.com"
  "user@server3.example.com"
  # Add more servers...
)

# Deploy to all servers
for SERVER in "${SERVERS[@]}"; do
  echo "Deploying to $SERVER..."
  ssh "$SERVER" << 'EOF'
    docker pull YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
    docker stop mcp-worker 2>/dev/null || true
    docker rm mcp-worker 2>/dev/null || true
    docker run -d \
      --name mcp-worker \
      --restart unless-stopped \
      -e WORKER_TAGS="production,$(hostname)" \
      -v /tmp/screenshots:/root \
      YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
    echo "✅ Worker deployed on $(hostname)"
EOF
done

echo "✅ All workers deployed!"
```

Make it executable and run:
```bash
chmod +x deploy-workers.sh
./deploy-workers.sh
```

---

## 📝 Quick Reference

### Essential Commands

```bash
# Deploy new worker
docker run -d --name mcp-worker --restart unless-stopped \
  -v /tmp/screenshots:/root \
  YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest

# View logs
docker logs -f mcp-worker

# Restart worker
docker restart mcp-worker

# Stop worker
docker stop mcp-worker

# Remove worker
docker rm -f mcp-worker

# Update worker (pull latest image)
docker pull YOUR_DOCKERHUB_USERNAME/mcp-remote-worker:latest
docker stop mcp-worker && docker rm mcp-worker
# Then deploy again with docker run...
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MANAGER_HOST` | `165.232.134.47` | Manager server IP |
| `WORKER_ID` | auto-generated | Unique worker ID |
| `WORKER_TAGS` | `mcp,docker,remote` | Worker tags |
| `MAX_CONCURRENT_TASKS` | `5` | Max parallel tasks |
| `MAX_MEMORY_MB` | `4096` | Memory limit |

---

## ✅ Success Checklist

- [ ] Docker image built and pushed to registry
- [ ] Manager server (165.232.134.47) accessible
- [ ] Ports 4222, 6379, 5432 open on manager
- [ ] Worker deployed with `docker run` command
- [ ] Worker logs show "Connected" and "Registered"
- [ ] Worker appears in `manage_workers` list
- [ ] Test task executes successfully

---

**Last Updated**: October 31, 2025  
**Manager IP**: 165.232.134.47  
**Status**: ✅ Ready for Global Deployment
