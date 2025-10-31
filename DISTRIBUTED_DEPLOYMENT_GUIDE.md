# 🌍 Distributed MCP Worker Deployment Guide

**Deploy MCP Workers Anywhere in the World**

---

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Manager Server Setup](#manager-server-setup)
4. [Remote Worker Deployment](#remote-worker-deployment)
5. [Security Configuration](#security-configuration)
6. [Networking & Firewall](#networking--firewall)
7. [Production Considerations](#production-considerations)
8. [Troubleshooting](#troubleshooting)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DISTRIBUTED DEPLOYMENT                        │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────────────────────────────────┐
    │          MANAGER SERVER (Central Hub)                    │
    │          IP: YOUR.MANAGER.IP.ADDRESS                     │
    │                                                          │
    │  ┌────────────┐  ┌────────────┐  ┌──────────────┐     │
    │  │   NATS     │  │   Redis    │  │  PostgreSQL  │     │
    │  │  Port 4222 │  │  Port 6379 │  │  Port 5432   │     │
    │  └────────────┘  └────────────┘  └──────────────┘     │
    │                                                          │
    │  ┌──────────────────────────────────────────────┐      │
    │  │        MCP Manager Enhanced                   │      │
    │  │        Port 3000 (MCP Tools)                  │      │
    │  └──────────────────────────────────────────────┘      │
    └──────────────────────────────────────────────────────────┘
                           ▲
                           │
          Internet / Public Network / VPN
          ═════════════════╪═════════════════════════════
                           │
          ┌────────────────┼────────────────┬───────────────────┐
          │                │                │                   │
          ▼                ▼                ▼                   ▼
    ┌──────────┐     ┌──────────┐    ┌──────────┐       ┌──────────┐
    │ Worker 1 │     │ Worker 2 │    │ Worker 3 │       │ Worker N │
    │ (AWS)    │     │ (Azure)  │    │ (GCP)    │  ...  │ (DigOcn) │
    │          │     │          │    │          │       │          │
    │ Docker   │     │ Docker   │    │ Docker   │       │ Docker   │
    └──────────┘     └──────────┘    └──────────┘       └──────────┘
```

---

## 🔧 Prerequisites

### Manager Server Requirements
- Linux server (Ubuntu 20.04+ recommended)
- Public IP address or domain name
- Minimum 2 CPU cores, 4GB RAM
- 20GB disk space
- Ports 4222, 6379, 5432, 3000 open to worker IPs

### Worker Server Requirements
- Any server with Docker installed
- Minimum 1 CPU core, 2GB RAM
- Internet access to manager server
- No inbound ports required (workers connect outbound)

---

## 🖥️ Manager Server Setup

### Step 1: Install Infrastructure

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt-get install docker-compose -y
```

### Step 2: Configure Firewall

```bash
# Allow infrastructure ports (adjust source IPs as needed)
sudo ufw allow 22/tcp        # SSH
sudo ufw allow 4222/tcp      # NATS
sudo ufw allow 6379/tcp      # Redis
sudo ufw allow 5432/tcp      # PostgreSQL
sudo ufw allow 3000/tcp      # MCP Manager (optional)

# Enable firewall
sudo ufw enable
```

### Step 3: Create Docker Compose for Infrastructure

Create `/root/mcp-setup/docker-compose-infrastructure.yml`:

```yaml
version: '3.8'

services:
  nats:
    image: nats:2.10-alpine
    container_name: nats
    ports:
      - "4222:4222"
      - "8222:8222"  # HTTP monitoring
    command: 
      - "-js"
      - "-m"
      - "8222"
      - "--max_payload"
      - "10485760"
    restart: unless-stopped
    networks:
      - mcp-network

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    command: redis-server --requirepass YOUR_REDIS_PASSWORD
    restart: unless-stopped
    volumes:
      - redis-data:/data
    networks:
      - mcp-network

  postgres:
    image: postgres:16-alpine
    container_name: postgres
    environment:
      POSTGRES_DB: mcp_manager
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: YOUR_POSTGRES_PASSWORD
    ports:
      - "5432:5432"
    restart: unless-stopped
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - mcp-network

volumes:
  redis-data:
  postgres-data:

networks:
  mcp-network:
    driver: bridge
```

### Step 4: Start Infrastructure

```bash
cd /root/mcp-setup

# Set strong passwords
export REDIS_PASSWORD="$(openssl rand -base64 32)"
export POSTGRES_PASSWORD="$(openssl rand -base64 32)"

# Update docker-compose file with passwords
sed -i "s/YOUR_REDIS_PASSWORD/${REDIS_PASSWORD}/g" docker-compose-infrastructure.yml
sed -i "s/YOUR_POSTGRES_PASSWORD/${POSTGRES_PASSWORD}/g" docker-compose-infrastructure.yml

# Start services
docker-compose -f docker-compose-infrastructure.yml up -d

# Verify services are running
docker-compose -f docker-compose-infrastructure.yml ps

# Save credentials
echo "REDIS_PASSWORD=${REDIS_PASSWORD}" >> /root/mcp-setup/.env
echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" >> /root/mcp-setup/.env
chmod 600 /root/mcp-setup/.env
```

### Step 5: Start MCP Manager

```bash
cd /root/mcp-setup/mcp-manager

# Set environment variables
export MANAGER_HOST="0.0.0.0"
export NATS_HOST="localhost"
export REDIS_HOST="localhost"
export POSTGRES_HOST="localhost"
export REDIS_PASSWORD="YOUR_REDIS_PASSWORD"
export POSTGRES_PASSWORD="YOUR_POSTGRES_PASSWORD"

# Start manager
node index-enhanced.js &

# Or use PM2 for production
npm install -g pm2
pm2 start index-enhanced.js --name mcp-manager
pm2 save
pm2 startup
```

---

## 🚀 Remote Worker Deployment

### Method 1: Docker Run (Quick Start)

On any remote server with Docker:

```bash
# Set your manager server IP
export MANAGER_IP="YOUR.MANAGER.IP.ADDRESS"
export REDIS_PASSWORD="your_redis_password"
export POSTGRES_PASSWORD="your_postgres_password"
export CURSOR_API_KEY="your_cursor_api_key"

# Pull the worker image (or build it)
docker pull your-registry/mcp-remote-worker-enhanced:latest

# Run worker container
docker run -d \
  --name mcp-worker-$(hostname)-$(date +%s) \
  --restart unless-stopped \
  -e MANAGER_HOST="${MANAGER_IP}" \
  -e NATS_HOST="${MANAGER_IP}" \
  -e NATS_PORT="4222" \
  -e REDIS_HOST="${MANAGER_IP}" \
  -e REDIS_PORT="6379" \
  -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
  -e POSTGRES_HOST="${MANAGER_IP}" \
  -e POSTGRES_PORT="5432" \
  -e POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  -e CURSOR_API_KEY="${CURSOR_API_KEY}" \
  -e WORKER_TAGS="remote,production,$(hostname)" \
  -v /tmp/screenshots:/root \
  your-registry/mcp-remote-worker-enhanced:latest

# Check logs
docker logs -f mcp-worker-*
```

### Method 2: Docker Compose (Recommended)

Create `docker-compose-worker.yml` on remote server:

```yaml
version: '3.8'

services:
  worker:
    image: your-registry/mcp-remote-worker-enhanced:latest
    container_name: mcp-worker
    restart: unless-stopped
    environment:
      WORKER_ID: "${WORKER_ID:-}"
      HOSTNAME: "${HOSTNAME:-}"
      MANAGER_HOST: "${MANAGER_HOST}"
      NATS_HOST: "${MANAGER_HOST}"
      NATS_PORT: "4222"
      REDIS_HOST: "${MANAGER_HOST}"
      REDIS_PORT: "6379"
      REDIS_PASSWORD: "${REDIS_PASSWORD}"
      POSTGRES_HOST: "${MANAGER_HOST}"
      POSTGRES_PORT: "5432"
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
      CURSOR_API_KEY: "${CURSOR_API_KEY}"
      MAX_CONCURRENT_TASKS: "5"
      MAX_MEMORY_MB: "4096"
      WORKER_TAGS: "remote,production,${REGION:-unknown}"
      HEARTBEAT_INTERVAL_MS: "10000"
    volumes:
      - screenshots:/root
    healthcheck:
      test: ["CMD", "nc", "-z", "${MANAGER_HOST}", "4222"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  screenshots:
```

Create `.env` file on remote server:

```bash
MANAGER_HOST=YOUR.MANAGER.IP.ADDRESS
REDIS_PASSWORD=your_redis_password
POSTGRES_PASSWORD=your_postgres_password
CURSOR_API_KEY=your_cursor_api_key
REGION=us-east-1
```

Deploy:

```bash
docker-compose -f docker-compose-worker.yml up -d
```

### Method 3: Kubernetes (Enterprise)

Create `k8s-worker-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-worker
  labels:
    app: mcp-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcp-worker
  template:
    metadata:
      labels:
        app: mcp-worker
    spec:
      containers:
      - name: worker
        image: your-registry/mcp-remote-worker-enhanced:latest
        env:
        - name: MANAGER_HOST
          valueFrom:
            configMapKeyRef:
              name: mcp-config
              key: manager_host
        - name: NATS_HOST
          valueFrom:
            configMapKeyRef:
              name: mcp-config
              key: manager_host
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: redis_password
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: postgres_password
        - name: CURSOR_API_KEY
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: cursor_api_key
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
        volumeMounts:
        - name: screenshots
          mountPath: /root
      volumes:
      - name: screenshots
        emptyDir: {}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: mcp-config
data:
  manager_host: "YOUR.MANAGER.IP.ADDRESS"
  nats_port: "4222"
  redis_port: "6379"
  postgres_port: "5432"
---
apiVersion: v1
kind: Secret
metadata:
  name: mcp-secrets
type: Opaque
stringData:
  redis_password: "your_redis_password"
  postgres_password: "your_postgres_password"
  cursor_api_key: "your_cursor_api_key"
```

Deploy:

```bash
kubectl apply -f k8s-worker-deployment.yaml
kubectl get pods -l app=mcp-worker
```

---

## 🔒 Security Configuration

### 1. Enable Authentication

#### NATS Authentication

Update NATS configuration:

```yaml
# nats-auth.conf
authorization {
  users = [
    {user: "worker", password: "STRONG_WORKER_PASSWORD"}
    {user: "manager", password: "STRONG_MANAGER_PASSWORD"}
  ]
}
```

Start NATS with auth:

```bash
docker run -d \
  --name nats \
  -p 4222:4222 \
  -v $(pwd)/nats-auth.conf:/etc/nats/nats.conf \
  nats:2.10-alpine \
  -c /etc/nats/nats.conf
```

Update worker connection:

```javascript
// In remote-worker-mcp-client-simple.js
natsConnection = await connect({
  servers: [`nats://${CONFIG.nats.host}:${CONFIG.nats.port}`],
  user: 'worker',
  pass: process.env.NATS_PASSWORD,
  reconnect: true,
});
```

#### Redis Authentication

Already configured with `--requirepass` in docker-compose.

#### PostgreSQL Authentication

Use strong passwords and limit connections by IP:

```sql
-- In postgresql.conf
listen_addresses = '*'

-- In pg_hba.conf
host    mcp_manager     postgres        WORKER_IP_1/32        md5
host    mcp_manager     postgres        WORKER_IP_2/32        md5
```

### 2. Enable TLS/SSL

#### NATS TLS

Generate certificates:

```bash
# Create CA
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 365 -key ca-key.pem -out ca.pem

# Create server cert
openssl genrsa -out server-key.pem 4096
openssl req -new -key server-key.pem -out server.csr
openssl x509 -req -days 365 -in server.csr -CA ca.pem -CAkey ca-key.pem -set_serial 01 -out server-cert.pem
```

Update NATS config:

```yaml
tls {
  cert_file: "/certs/server-cert.pem"
  key_file:  "/certs/server-key.pem"
  ca_file:   "/certs/ca.pem"
  verify: true
}
```

Update worker connection:

```javascript
natsConnection = await connect({
  servers: [`nats://${CONFIG.nats.host}:${CONFIG.nats.port}`],
  tls: {
    caFile: '/app/certs/ca.pem',
    certFile: '/app/certs/client-cert.pem',
    keyFile: '/app/certs/client-key.pem',
  },
});
```

### 3. Network Security

#### VPN/VPC Setup

Deploy manager and workers in a VPN or VPC for private networking:

```
Manager Server:    10.0.1.10  (Private IP)
Worker 1:          10.0.1.20  (Private IP)
Worker 2:          10.0.1.30  (Private IP)
```

#### SSH Tunneling (Development)

For development/testing, use SSH tunnels:

```bash
# On worker machine, tunnel NATS, Redis, PostgreSQL
ssh -L 4222:localhost:4222 \
    -L 6379:localhost:6379 \
    -L 5432:localhost:5432 \
    user@manager-server -N &

# Then run worker with localhost
export MANAGER_HOST="localhost"
```

#### Firewall Rules

```bash
# On manager server, allow only specific worker IPs
sudo ufw delete allow 4222/tcp  # Remove open rule
sudo ufw allow from WORKER_IP_1 to any port 4222
sudo ufw allow from WORKER_IP_2 to any port 4222
# Repeat for 6379, 5432
```

---

## 🌐 Networking & Firewall

### Required Ports (Manager Server)

| Port | Service    | Protocol | Access       |
|------|------------|----------|--------------|
| 4222 | NATS       | TCP      | Workers only |
| 6379 | Redis      | TCP      | Workers only |
| 5432 | PostgreSQL | TCP      | Workers only |
| 8222 | NATS HTTP  | TCP      | Admin only   |

### Worker Outbound Requirements

- Outbound TCP to manager server ports (4222, 6379, 5432)
- Outbound HTTP/HTTPS for:
  - Cursor API: `https://api.cursor.sh`
  - Target URLs (for browser automation)
  - OAST callbacks (your testing domains)

### Network Topology Options

#### Option 1: Direct Internet (Simple)
```
Worker → Internet → Manager (Public IP)
```
- ✅ Easy to set up
- ⚠️ Requires strong authentication
- ⚠️ Expose ports to internet (use firewall)

#### Option 2: VPN (Secure)
```
Worker → VPN Tunnel → Manager (Private IP)
```
- ✅ Encrypted traffic
- ✅ Private IPs
- ⚠️ Requires VPN setup (WireGuard, OpenVPN)

#### Option 3: Cloud VPC (Enterprise)
```
Worker (VPC Subnet) → VPC Peering → Manager (VPC Subnet)
```
- ✅ Native cloud security
- ✅ High performance
- ⚠️ Cloud-specific setup

---

## 🏭 Production Considerations

### 1. High Availability

#### Multiple Managers (Load Balanced)

```
       ┌─► Manager 1
HAProxy├─► Manager 2
       └─► Manager 3
```

Use HAProxy or Nginx to load balance across multiple manager instances.

#### Clustered Infrastructure

- **NATS Cluster**: 3+ NATS servers with clustering
- **Redis Sentinel**: 3+ Redis instances with automatic failover
- **PostgreSQL Replication**: Primary + replicas

### 2. Monitoring & Observability

#### Prometheus + Grafana

Expose metrics from MCP Manager:

```javascript
// Add to index-enhanced.js
import prometheus from 'prom-client';

const register = new prometheus.Registry();
prometheus.collectDefaultMetrics({ register });

const tasksAssigned = new prometheus.Counter({
  name: 'mcp_tasks_assigned_total',
  help: 'Total tasks assigned',
  registers: [register]
});

const activeWorkers = new prometheus.Gauge({
  name: 'mcp_active_workers',
  help: 'Number of active workers',
  registers: [register]
});

// HTTP endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

#### Health Check Endpoints

```javascript
// Add to index-enhanced.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    connections: {
      nats: natsConnection?.isClosed() ? 'disconnected' : 'connected',
      redis: redis?.isReady ? 'connected' : 'disconnected',
      postgres: 'connected', // Check with simple query
    },
    workers: activeWorkersCount,
    tasks: activeTasksCount,
  });
});
```

### 3. Scaling

#### Horizontal Worker Scaling

Deploy multiple workers per region:

```bash
# Auto-scaling script
for i in {1..10}; do
  docker run -d \
    --name mcp-worker-${REGION}-${i} \
    -e WORKER_ID="worker-${REGION}-${i}" \
    -e MANAGER_HOST="${MANAGER_IP}" \
    your-registry/mcp-remote-worker-enhanced:latest
done
```

#### Regional Distribution

```
US-EAST:    10 workers
EU-WEST:    10 workers
ASIA-PACIFIC: 10 workers
```

### 4. Logging

#### Centralized Logging (ELK Stack)

Configure workers to ship logs to Elasticsearch:

```yaml
# docker-compose-worker.yml
services:
  worker:
    logging:
      driver: "fluentd"
      options:
        fluentd-address: "logs.yourdomain.com:24224"
        tag: "mcp.worker.{{.ID}}"
```

---

## 🐛 Troubleshooting

### Worker Can't Connect to Manager

**Symptom**: `ECONNREFUSED` errors in worker logs

**Solutions**:
```bash
# 1. Check network connectivity
nc -zv MANAGER_IP 4222

# 2. Check firewall
sudo ufw status
telnet MANAGER_IP 4222

# 3. Check NATS is listening
netstat -tuln | grep 4222

# 4. Check Docker network
docker network inspect bridge

# 5. Test with curl (NATS HTTP monitoring)
curl http://MANAGER_IP:8222/varz
```

### Authentication Errors

**Symptom**: `Authorization Violation` in NATS logs

**Solutions**:
```bash
# 1. Verify credentials
echo $REDIS_PASSWORD
echo $POSTGRES_PASSWORD

# 2. Check NATS auth config
docker exec nats cat /etc/nats/nats.conf

# 3. Test Redis auth
redis-cli -h MANAGER_IP -a $REDIS_PASSWORD PING

# 4. Test PostgreSQL auth
PGPASSWORD=$POSTGRES_PASSWORD psql -h MANAGER_IP -U postgres -d mcp_manager -c "SELECT 1"
```

### Worker Registration Fails

**Symptom**: Worker starts but doesn't show in `manage_workers` list

**Solutions**:
```bash
# 1. Check database connectivity
docker logs mcp-worker | grep -i postgres

# 2. Verify remote_workers table exists
psql -h MANAGER_IP -U postgres -d mcp_manager -c "\dt"

# 3. Check heartbeat messages
# On manager server
nc -l 4222 | grep heartbeat

# 4. Check worker logs for registration
docker logs mcp-worker | grep -i "register"
```

### Tasks Not Executing

**Symptom**: Tasks assigned but never start

**Solutions**:
```bash
# 1. Check NATS subscriptions
curl http://MANAGER_IP:8222/subsz

# 2. Verify task messages
# On manager
docker logs mcp-manager | grep "task.assigned"

# 3. Check worker queue
docker logs mcp-worker | grep "Received task"

# 4. Check cursor-agent status
docker exec mcp-worker ps aux | grep cursor-agent
```

---

## 🎯 Quick Deployment Checklist

### Manager Server
- [ ] Install Docker & Docker Compose
- [ ] Configure firewall (4222, 6379, 5432)
- [ ] Generate strong passwords
- [ ] Deploy infrastructure (NATS, Redis, PostgreSQL)
- [ ] Start MCP Manager
- [ ] Verify health endpoints
- [ ] Set up monitoring (optional)

### Worker Server(s)
- [ ] Install Docker
- [ ] Get manager server IP/hostname
- [ ] Get authentication credentials
- [ ] Pull/build worker image
- [ ] Set environment variables
- [ ] Deploy worker container
- [ ] Verify connection in logs
- [ ] Test task assignment

### Verification
- [ ] Worker appears in `manage_workers` list
- [ ] Can assign test task
- [ ] Task executes successfully
- [ ] Analytics are captured
- [ ] Screenshots are saved

---

## 📚 Additional Resources

- [NATS Clustering](https://docs.nats.io/running-a-nats-service/configuration/clustering)
- [Redis Sentinel](https://redis.io/docs/management/sentinel/)
- [PostgreSQL Replication](https://www.postgresql.org/docs/current/high-availability.html)
- [Docker Networking](https://docs.docker.com/network/)
- [Kubernetes Documentation](https://kubernetes.io/docs/home/)

---

**Last Updated**: October 31, 2025  
**Status**: ✅ Production Ready for Global Deployment
