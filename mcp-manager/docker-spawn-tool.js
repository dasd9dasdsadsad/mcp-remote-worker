#!/usr/bin/env node
/**
 * Docker Container Spawning Tool for MCP Manager
 * This tool allows the MCP Manager to spawn new worker containers dynamically
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// Docker image name for remote workers
const WORKER_IMAGE = 'mcp-remote-worker:latest';

/**
 * Spawn a new Docker worker container
 */
export async function spawnWorkerContainer({
  workerTags = 'mcp,docker,remote,spawned',
  maxConcurrentTasks = 5,
  maxMemoryMB = 4096,
  cursorApiKey = process.env.CURSOR_API_KEY,
  managerHost = 'localhost',
  natsHost = null,
  redisHost = null,
  postgresHost = null,
  networkMode = 'host',
  customName = null
} = {}) {
  // Generate unique container name
  const containerNum = Date.now().toString().slice(-4);
  const containerName = customName || `mcp-worker-${containerNum}-${uuidv4().substring(0, 8)}`;
  
  // Use manager host as default for all services if not specified
  natsHost = natsHost || managerHost;
  redisHost = redisHost || managerHost;
  postgresHost = postgresHost || managerHost;
  
  // Build docker run command
  const dockerCmd = [
    'docker run -d',
    `--name "${containerName}"`,
    `--hostname "${containerName}"`,
    `--network ${networkMode}`,
    `-e MANAGER_HOST=${managerHost}`,
    `-e NATS_HOST=${natsHost}`,
    `-e NATS_PORT=4222`,
    `-e REDIS_HOST=${redisHost}`,
    `-e REDIS_PORT=6379`,
    `-e POSTGRES_HOST=${postgresHost}`,
    `-e POSTGRES_PORT=5432`,
    `-e POSTGRES_DB=mcp_manager`,
    `-e POSTGRES_USER=postgres`,
    `-e POSTGRES_PASSWORD=postgres`,
    `-e CURSOR_API_KEY=${cursorApiKey}`,
    `-e WORKER_TAGS="${workerTags}"`,
    `-e MAX_CONCURRENT_TASKS=${maxConcurrentTasks}`,
    `-e MAX_MEMORY_MB=${maxMemoryMB}`,
    `-e NODE_ENV=production`,
    '--security-opt seccomp=unconfined',
    '--shm-size 2gb',
    `--memory="${maxMemoryMB}m"`,
    `--cpus="2"`,
    WORKER_IMAGE
  ].join(' ');
  
  try {
    console.error(`Spawning worker container: ${containerName}`);
    
    // Execute docker run command
    const { stdout, stderr } = await execAsync(dockerCmd);
    const containerId = stdout.trim();
    
    if (stderr && !stderr.includes('WARNING')) {
      console.error(`Docker stderr: ${stderr}`);
    }
    
    // Get container info
    const { stdout: inspectOutput } = await execAsync(`docker inspect ${containerId}`);
    const containerInfo = JSON.parse(inspectOutput)[0];
    
    return {
      success: true,
      containerId,
      containerName,
      status: containerInfo.State.Status,
      startedAt: containerInfo.State.StartedAt,
      config: {
        workerTags,
        maxConcurrentTasks,
        maxMemoryMB,
        managerHost,
        networkMode
      }
    };
  } catch (error) {
    console.error(`Failed to spawn worker container: ${error.message}`);
    return {
      success: false,
      error: error.message,
      containerName
    };
  }
}

/**
 * List all worker containers
 */
export async function listWorkerContainers() {
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "label=mcp-worker=true" --format "{{json .}}"'
    );
    
    const containers = stdout
      .trim()
      .split('\n')
      .filter(line => line)
      .map(line => JSON.parse(line));
    
    return {
      success: true,
      containers
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      containers: []
    };
  }
}

/**
 * Stop a worker container
 */
export async function stopWorkerContainer(containerIdOrName) {
  try {
    const { stdout } = await execAsync(`docker stop ${containerIdOrName}`);
    return {
      success: true,
      containerId: stdout.trim()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Remove a worker container
 */
export async function removeWorkerContainer(containerIdOrName) {
  try {
    const { stdout } = await execAsync(`docker rm -f ${containerIdOrName}`);
    return {
      success: true,
      containerId: stdout.trim()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get logs from a worker container
 */
export async function getWorkerLogs(containerIdOrName, tail = 100) {
  try {
    const { stdout } = await execAsync(`docker logs --tail ${tail} ${containerIdOrName}`);
    return {
      success: true,
      logs: stdout
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if Docker is available
 */
export async function checkDockerAvailable() {
  try {
    const { stdout } = await execAsync('docker version --format "{{.Server.Version}}"');
    return {
      available: true,
      version: stdout.trim()
    };
  } catch (error) {
    return {
      available: false,
      error: error.message
    };
  }
}

/**
 * Build worker image if needed
 */
export async function buildWorkerImage(dockerfilePath = './remote-worker-mcp/Dockerfile') {
  try {
    console.error('Building worker image...');
    const { stdout, stderr } = await execAsync(
      `docker build -t ${WORKER_IMAGE} -f ${dockerfilePath} ./remote-worker-mcp`
    );
    
    return {
      success: true,
      output: stdout + stderr
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Export for use in MCP Manager
export default {
  spawnWorkerContainer,
  listWorkerContainers,
  stopWorkerContainer,
  removeWorkerContainer,
  getWorkerLogs,
  checkDockerAvailable,
  buildWorkerImage
};




