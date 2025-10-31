# 🌍 Remote Deployment Guide - MCP Workers Anywhere

This guide explains how to deploy MCP-enabled Docker workers on any server worldwide.

## 📋 Prerequisites

### On Manager Server (where Cursor IDE runs):
- ✅ MCP Manager running in Cursor
- ✅ NATS, Redis, PostgreSQL installed
- ✅ Ports open in firewall (4222, 6379, 5432)
- ✅ Services listening on `0.0.0.0` (not `127.0.0.1`)

### On Remote Server (where worker will run):
- ✅ Docker installed
- ✅ Docker Compose installed
- ✅ Outbound internet access
- ✅ Can connect to manager server ports

---

## 🚀 Quick Start

### 1. **Prepare Manager Server**

On your manager server (where Cursor runs):

```bash
# Open firewall ports
sudo ufw allow 4222/tcp  # NATS
sudo ufw allow 6379/tcp  # Redis
sudo ufw allow 5432/tcp  # PostgreSQL

# Verify services are listening on all interfaces
netstat -tlnp | grep -E "(4222|6379|5432)"
# Should show 0.0.0.0:PORT not 127.0.0.1:PORT
```

### 2. **Deploy to Remote Server**

On the remote server:

```bash
# Clone the repository (or copy the remote-worker-mcp folder)
git clone [your-repo] /opt/mcp-worker
cd /opt/mcp-worker/remote-worker-mcp

# Setup environment
./deploy-remote.sh setup

# Edit configuration
vim .env
# Change MANAGER_HOST to your manager's public IP
# Set your CURSOR_API_KEY

# Test connectivity
./deploy-remote.sh test

# Deploy
./deploy-remote.sh deploy
```

---

## 📝 Configuration Details

### **Essential Settings in .env**

```bash
# Your manager server's public IP or domain
MANAGER_HOST=123.45.67.89

# Your Cursor API key
CURSOR_API_KEY=key_your_actual_key_here

# Worker identification
WORKER_NUMBER=1  # Increment for multiple workers on same host
WORKER_TAGS=production,aws,us-east-1  # Custom tags
```

### **Advanced Settings**

```bash
# If services are on different servers
NATS_HOST=nats.example.com
REDIS_HOST=redis.example.com
POSTGRES_HOST=db.example.com

# Security (recommended for production)
REDIS_PASSWORD=strong_password_here
POSTGRES_PASSWORD=another_strong_password

# Resource limits
WORKER_CPU_LIMIT=4      # 4 CPU cores
WORKER_MEMORY_LIMIT=8G  # 8GB RAM
```

---

## 🔧 Manager Server Configuration

### **1. Configure NATS** (`/etc/nats-server.conf`)

```yaml
# Listen on all interfaces
host: 0.0.0.0
port: 4222

# Optional: Authentication
authorization {
  token: "your_secret_token"
}
```

### **2. Configure Redis** (`/etc/redis/redis.conf`)

```bash
# Bind to all interfaces
bind 0.0.0.0

# Disable protected mode or set password
protected-mode no
# OR
requirepass your_redis_password
```

### **3. Configure PostgreSQL**

`/etc/postgresql/*/main/postgresql.conf`:
```bash
listen_addresses = '*'
```

`/etc/postgresql/*/main/pg_hba.conf`:
```bash
# Allow connections from worker subnet
host    mcp_manager    postgres    10.0.0.0/8    md5
host    mcp_manager    postgres    172.16.0.0/12  md5
host    mcp_manager    postgres    192.168.0.0/16 md5
# Or specific IPs
host    mcp_manager    postgres    YOUR_WORKER_IP/32  md5
```

Restart services:
```bash
sudo systemctl restart nats-server redis-server postgresql
```

---

## 🌐 Deployment Scenarios

### **Scenario 1: Single Remote Worker**

```bash
# On remote server
cd /opt/mcp-worker/remote-worker-mcp
./deploy-remote.sh deploy
```

### **Scenario 2: Multiple Workers on Same Server**

```bash
# Deploy 3 workers
./deploy-remote.sh scale 3

# Each gets unique name: mcp-remote-worker-1, -2, -3
```

### **Scenario 3: Workers Across Multiple Regions**

```bash
# AWS US-East
ssh us-east-server
WORKER_TAGS=aws,us-east-1 ./deploy-remote.sh deploy

# AWS EU-West
ssh eu-west-server
WORKER_TAGS=aws,eu-west-1 ./deploy-remote.sh deploy

# GCP Asia
ssh asia-server
WORKER_TAGS=gcp,asia-southeast1 ./deploy-remote.sh deploy
```

---

## 🔍 Verification

### **1. Check Worker Status**

On remote server:
```bash
./deploy-remote.sh status
```

### **2. From Manager (Cursor IDE)**

```javascript
// List all workers including remote ones
list_remote_workers()

// You should see workers with their locations
{
  worker_id: "mcp-worker-xxx",
  hostname: "remote-server-1",
  tags: ["aws", "us-east-1"],
  status: "idle"
}
```

### **3. Test Task Assignment**

```javascript
assign_remote_task({
  worker_id: "mcp-worker-xxx",
  task_description: "Create file /tmp/remote_test.txt with 'Hello from remote!'"
})
```

---

## 🔒 Security Best Practices

### **1. Use TLS/SSL**

For production, configure services with encryption:

```bash
# NATS with TLS
tls {
  cert_file: "/path/to/server-cert.pem"
  key_file:  "/path/to/server-key.pem"
}

# Redis with TLS
tls-port 6380
tls-cert-file /path/to/redis.crt
tls-key-file /path/to/redis.key
```

### **2. Use Strong Authentication**

```bash
# .env file
REDIS_PASSWORD=<generate-with-openssl-rand-base64-32>
POSTGRES_PASSWORD=<generate-with-openssl-rand-base64-32>
NATS_TOKEN=<generate-with-openssl-rand-base64-32>
```

### **3. Restrict Network Access**

```bash
# Only allow specific IPs
sudo ufw allow from WORKER_IP to any port 4222
sudo ufw allow from WORKER_IP to any port 6379
sudo ufw allow from WORKER_IP to any port 5432
```

### **4. Use VPN or Private Network**

Consider using:
- WireGuard VPN
- AWS VPC Peering
- GCP Private Service Connect
- Tailscale

---

## 🛠️ Troubleshooting

### **Connection Refused**

```bash
# Check if services are listening
sudo netstat -tlnp | grep -E "(4222|6379|5432)"

# Check firewall
sudo ufw status

# Test from worker server
telnet MANAGER_IP 4222
telnet MANAGER_IP 6379
telnet MANAGER_IP 5432
```

### **Authentication Failed**

```bash
# Verify passwords match
# Manager server: check service configs
# Worker server: check .env file

# Test Redis connection
redis-cli -h MANAGER_IP -a YOUR_PASSWORD ping

# Test PostgreSQL
psql -h MANAGER_IP -U postgres -d mcp_manager
```

### **Worker Not Appearing**

```bash
# Check worker logs
docker logs mcp-remote-worker-1

# Verify registration
docker exec mcp-remote-worker-1 \
  psql -h $POSTGRES_HOST -U postgres -d mcp_manager \
  -c "SELECT * FROM remote_workers WHERE worker_id LIKE '%$(hostname)%'"
```

---

## 📊 Monitoring

### **Worker Health Dashboard**

Create a simple monitoring script:

```bash
#!/bin/bash
# monitor-workers.sh

while true; do
  clear
  echo "=== MCP Worker Monitor ==="
  echo "Time: $(date)"
  echo ""
  
  # Show all workers
  docker ps --filter "name=mcp-remote-worker" \
    --format "table {{.Names}}\t{{.Status}}\t{{.Stats}}"
  
  echo ""
  echo "=== Recent Activity ==="
  docker logs --tail=5 --since=10s mcp-remote-worker-1 2>&1 | grep -E "(Task|Heartbeat)"
  
  sleep 5
done
```

---

## 🎯 Best Practices

1. **Resource Planning**
   - 1 worker per 2-4 CPU cores
   - 2-4GB RAM per worker
   - Monitor disk usage in /tmp

2. **Geographic Distribution**
   - Deploy workers close to data sources
   - Use region tags for task routing
   - Consider latency to manager

3. **High Availability**
   - Run multiple workers
   - Use different cloud providers
   - Implement health checks

4. **Maintenance**
   - Regular Docker image updates
   - Log rotation
   - Periodic restart schedule

---

## 📚 Example Deployments

### **AWS EC2**
```bash
# Launch EC2 instance
# Install Docker
# Copy worker files
# Run deployment
```

### **Google Cloud Run**
```dockerfile
# Adapt Dockerfile for Cloud Run
# Use environment variables
# Deploy as service
```

### **DigitalOcean Droplet**
```bash
# Create droplet
# SSH and install Docker
# Deploy worker
```

### **Home Server**
```bash
# Port forward from router
# Use dynamic DNS
# Deploy worker
```

---

## 🚨 Important Notes

1. **Worker Always Connects TO Manager**
   - No inbound ports needed on worker
   - All connections are outbound
   - Works behind NAT/firewall

2. **Automatic Failover**
   - Workers reconnect automatically
   - Tasks are retried on failure
   - No data loss

3. **Scalability**
   - Can run 100s of workers
   - Limited by manager resources
   - PostgreSQL connection pool

---

## 🎉 Success!

Once deployed, your remote workers will:
- ✅ Connect to manager automatically
- ✅ Register in the system
- ✅ Show up in `list_remote_workers()`
- ✅ Execute tasks with full MCP capabilities
- ✅ Report progress in real-time
- ✅ Reconnect if connection drops

Enjoy your globally distributed MCP workforce! 🌍🚀
