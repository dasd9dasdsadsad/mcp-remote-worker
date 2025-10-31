# 🔒 Deploy Workers from Private Registry

**Secure deployment using private Docker registry**

---

## 🎯 Option 1: Docker Hub Private Repository (Recommended)

### Step 1: Create Private Repository on Docker Hub

1. Go to https://hub.docker.com/
2. Click "Create Repository"
3. Name: `mcp-remote-worker`
4. Visibility: **Private** ✅
5. Click "Create"

### Step 2: Build & Push to Private Registry

```bash
cd /root/mcp-setup/remote-worker-mcp

# Set your Docker Hub username
export DOCKER_USERNAME="your-dockerhub-username"

# Build the image
docker build -t mcp-remote-worker:latest .

# Tag for private registry
docker tag mcp-remote-worker:latest ${DOCKER_USERNAME}/mcp-remote-worker:latest

# Login to Docker Hub
docker login
# Enter your username and password

# Push to private registry
docker push ${DOCKER_USERNAME}/mcp-remote-worker:latest

echo "✅ Image pushed to private registry: ${DOCKER_USERNAME}/mcp-remote-worker:latest"
```

### Step 3: Deploy Workers (with authentication)

**On ANY remote server:**

```bash
# Set your credentials
export DOCKER_USERNAME="your-dockerhub-username"
export DOCKER_PASSWORD="your-dockerhub-password-or-token"

# Login to Docker Hub
echo "${DOCKER_PASSWORD}" | docker login -u "${DOCKER_USERNAME}" --password-stdin

# Pull and run worker
docker pull ${DOCKER_USERNAME}/mcp-remote-worker:latest

docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -v /tmp/screenshots:/root \
  ${DOCKER_USERNAME}/mcp-remote-worker:latest

# Verify
docker logs -f mcp-worker
```

---

## 🎯 Option 2: GitHub Container Registry (GHCR)

### Step 1: Create Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Name: `mcp-worker-registry`
4. Scopes: Select `write:packages`, `read:packages`, `delete:packages`
5. Click "Generate token"
6. **Save the token!** (You won't see it again)

### Step 2: Build & Push to GHCR

```bash
cd /root/mcp-setup/remote-worker-mcp

# Set your GitHub username and token
export GH_USERNAME="your-github-username"
export GH_TOKEN="ghp_xxxxxxxxxxxxx"

# Login to GHCR
echo "${GH_TOKEN}" | docker login ghcr.io -u ${GH_USERNAME} --password-stdin

# Build and tag
docker build -t mcp-remote-worker:latest .
docker tag mcp-remote-worker:latest ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest

# Push to GHCR (private by default!)
docker push ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest

echo "✅ Image pushed to GHCR: ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest"
```

### Step 3: Deploy Workers (with GHCR authentication)

**On ANY remote server:**

```bash
# Set your credentials
export GH_USERNAME="your-github-username"
export GH_TOKEN="ghp_xxxxxxxxxxxxx"

# Login to GHCR
echo "${GH_TOKEN}" | docker login ghcr.io -u ${GH_USERNAME} --password-stdin

# Pull and run worker
docker pull ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest

docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -v /tmp/screenshots:/root \
  ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest

# Verify
docker logs -f mcp-worker
```

---

## 🎯 Option 3: Self-Hosted Private Registry

### Step 1: Set Up Private Registry (on manager server)

```bash
# On 165.232.134.47

# Create directories for registry data and certs
mkdir -p /opt/docker-registry/{data,certs,auth}

# Generate self-signed certificate (or use Let's Encrypt)
cd /opt/docker-registry/certs
openssl req -newkey rsa:4096 -nodes -sha256 \
  -keyout domain.key -x509 -days 365 -out domain.crt \
  -subj "/CN=165.232.134.47"

# Create htpasswd for authentication
cd /opt/docker-registry/auth
docker run --rm --entrypoint htpasswd httpd:2 -Bbn admin YOUR_REGISTRY_PASSWORD > htpasswd

# Run private registry
docker run -d \
  --name registry \
  --restart unless-stopped \
  -p 5000:5000 \
  -v /opt/docker-registry/data:/var/lib/registry \
  -v /opt/docker-registry/certs:/certs \
  -v /opt/docker-registry/auth:/auth \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/domain.crt \
  -e REGISTRY_HTTP_TLS_KEY=/certs/domain.key \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  registry:2

# Allow registry port
sudo ufw allow 5000/tcp

echo "✅ Private registry running at https://165.232.134.47:5000"
```

### Step 2: Build & Push to Self-Hosted Registry

```bash
cd /root/mcp-setup/remote-worker-mcp

# Login to your registry
docker login 165.232.134.47:5000
# Username: admin
# Password: YOUR_REGISTRY_PASSWORD

# Build and tag
docker build -t mcp-remote-worker:latest .
docker tag mcp-remote-worker:latest 165.232.134.47:5000/mcp-remote-worker:latest

# Push
docker push 165.232.134.47:5000/mcp-remote-worker:latest

echo "✅ Image pushed to private registry"
```

### Step 3: Deploy Workers (with self-hosted registry)

**On ANY remote server:**

```bash
# Copy registry certificate to worker server
mkdir -p /etc/docker/certs.d/165.232.134.47:5000
scp root@165.232.134.47:/opt/docker-registry/certs/domain.crt \
    /etc/docker/certs.d/165.232.134.47:5000/ca.crt

# Or for insecure registry (testing only!)
# Add to /etc/docker/daemon.json:
# {"insecure-registries": ["165.232.134.47:5000"]}
# systemctl restart docker

# Login to registry
docker login 165.232.134.47:5000
# Username: admin
# Password: YOUR_REGISTRY_PASSWORD

# Pull and run worker
docker pull 165.232.134.47:5000/mcp-remote-worker:latest

docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -v /tmp/screenshots:/root \
  165.232.134.47:5000/mcp-remote-worker:latest

# Verify
docker logs -f mcp-worker
```

---

## 🔐 Security Best Practices

### 1. Use Docker Credential Helpers

Instead of storing passwords in plain text:

```bash
# Install credential helper (Ubuntu/Debian)
sudo apt-get install pass gnupg2

# Configure Docker to use it
mkdir -p ~/.docker
cat > ~/.docker/config.json << EOF
{
  "credsStore": "pass"
}
EOF

# Now docker login will store credentials securely
docker login
```

### 2. Use Docker Secrets for Sensitive Data

```bash
# Create a secret for registry credentials
echo "your-registry-password" | docker secret create registry_password -

# Use in docker service (Swarm mode)
docker service create \
  --name mcp-worker \
  --secret registry_password \
  your-registry/mcp-remote-worker:latest
```

### 3. Rotate Registry Credentials Regularly

```bash
# Update Docker Hub password every 90 days
# Update GitHub tokens every 90 days
# Update private registry passwords every 90 days
```

---

## 📜 Automated Deployment Script (Private Registry)

Create `/root/mcp-setup/deploy-worker-private.sh`:

```bash
#!/bin/bash
#
# Deploy MCP Worker from Private Registry
#

set -e

# Configuration
REGISTRY_TYPE="${REGISTRY_TYPE:-dockerhub}"  # dockerhub, ghcr, or self-hosted
DOCKER_USERNAME="${DOCKER_USERNAME}"
DOCKER_PASSWORD="${DOCKER_PASSWORD}"
GH_USERNAME="${GH_USERNAME}"
GH_TOKEN="${GH_TOKEN}"
REGISTRY_HOST="${REGISTRY_HOST:-165.232.134.47:5000}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     🔒 MCP Worker Deployment (Private Registry)         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Login based on registry type
case "$REGISTRY_TYPE" in
  dockerhub)
    echo "🔑 Logging into Docker Hub..."
    echo "${DOCKER_PASSWORD}" | docker login -u "${DOCKER_USERNAME}" --password-stdin
    IMAGE="${DOCKER_USERNAME}/mcp-remote-worker:latest"
    ;;
  ghcr)
    echo "🔑 Logging into GitHub Container Registry..."
    echo "${GH_TOKEN}" | docker login ghcr.io -u "${GH_USERNAME}" --password-stdin
    IMAGE="ghcr.io/${GH_USERNAME}/mcp-remote-worker:latest"
    ;;
  self-hosted)
    echo "🔑 Logging into private registry..."
    echo "${DOCKER_PASSWORD}" | docker login "${REGISTRY_HOST}" -u "${DOCKER_USERNAME}" --password-stdin
    IMAGE="${REGISTRY_HOST}/mcp-remote-worker:latest"
    ;;
  *)
    echo "❌ Unknown registry type: $REGISTRY_TYPE"
    exit 1
    ;;
esac

# Pull latest image
echo "📥 Pulling latest worker image..."
docker pull ${IMAGE}

# Stop existing worker
if docker ps -a --format '{{.Names}}' | grep -q "^mcp-worker$"; then
  echo "🛑 Stopping existing worker..."
  docker stop mcp-worker 2>/dev/null || true
  docker rm mcp-worker 2>/dev/null || true
fi

# Deploy worker
echo "🚀 Deploying worker..."
docker run -d \
  --name mcp-worker \
  --restart unless-stopped \
  -e WORKER_TAGS="production,$(hostname)" \
  -v /tmp/screenshots:/root \
  ${IMAGE}

# Wait and verify
sleep 5

if docker ps --format '{{.Names}}' | grep -q "^mcp-worker$"; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║         ✅ WORKER DEPLOYED SUCCESSFULLY! ✅             ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  echo "📋 Worker Status:"
  docker ps | grep mcp-worker
  echo ""
  echo "🔍 Last 20 log lines:"
  docker logs --tail 20 mcp-worker
else
  echo "❌ Worker failed to start!"
  docker logs mcp-worker
  exit 1
fi
```

Make it executable:

```bash
chmod +x /root/mcp-setup/deploy-worker-private.sh
```

---

## 🌍 Deploy to Multiple Servers (Private Registry)

### Using Docker Hub Private

```bash
# On each remote server
export DOCKER_USERNAME="your-username"
export DOCKER_PASSWORD="your-password"

bash <(curl -s https://your-domain.com/deploy-worker-private.sh)
```

### Using GHCR

```bash
# On each remote server
export REGISTRY_TYPE="ghcr"
export GH_USERNAME="your-github-username"
export GH_TOKEN="ghp_xxxxxxxxxxxxx"

./deploy-worker-private.sh
```

### Using Self-Hosted

```bash
# On each remote server
export REGISTRY_TYPE="self-hosted"
export REGISTRY_HOST="165.232.134.47:5000"
export DOCKER_USERNAME="admin"
export DOCKER_PASSWORD="your-registry-password"

./deploy-worker-private.sh
```

---

## 🔍 Verify Private Deployment

### Check Authentication
```bash
# Should show successful login
docker login
cat ~/.docker/config.json
```

### Check Image Pull
```bash
# Should pull without "unauthorized" error
docker pull your-username/mcp-remote-worker:latest
```

### Check Worker Connection
```bash
# Should show worker registered
docker logs mcp-worker | grep -i "registered"
```

---

## 📊 Cost Comparison

| Registry | Free Tier | Private Repos | Best For |
|----------|-----------|---------------|----------|
| Docker Hub | 1 private repo | Unlimited pulls | Small teams |
| GitHub (GHCR) | Unlimited | 1GB storage | GitHub users |
| Self-Hosted | Unlimited | Unlimited | Enterprise |

---

## ✅ Quick Summary

**Docker Hub Private:**
```bash
docker login
docker push your-username/mcp-remote-worker:latest
# On workers: docker login && docker pull && docker run
```

**GitHub Container Registry:**
```bash
echo $GH_TOKEN | docker login ghcr.io -u $GH_USERNAME --password-stdin
docker push ghcr.io/your-username/mcp-remote-worker:latest
# On workers: same login + pull + run
```

**Self-Hosted:**
```bash
docker login 165.232.134.47:5000
docker push 165.232.134.47:5000/mcp-remote-worker:latest
# On workers: same login + pull + run
```

All workers still connect to `165.232.134.47` for NATS/Redis/PostgreSQL!

---

**Last Updated**: October 31, 2025  
**Security**: ✅ Private Registry Enabled
