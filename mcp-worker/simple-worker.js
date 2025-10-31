#!/usr/bin/env node
import { connect, StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

const sc = StringCodec();
const WORKER_ID = `simple-worker-${os.hostname()}-${uuidv4().substring(0, 8)}`;

console.log(`Starting simple worker: ${WORKER_ID}`);

// Connect to NATS
const nc = await connect({ servers: 'nats://localhost:4222' });

// Register worker
const registration = {
  worker_id: WORKER_ID,
  worker_type: 'simple-enhanced',
  hostname: os.hostname(),
  capabilities: {
    features: ['analytics', 'real-time', 'monitoring'],
    mcpEnabled: true,
    maxConcurrentTasks: 1
  },
  system_info: {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memory: os.totalmem()
  }
};

await nc.publish('worker.registered', sc.encode(JSON.stringify(registration)));
console.log('✅ Registered with manager');

// Listen for tasks
const sub = nc.subscribe(`worker.task.${WORKER_ID}`);
(async () => {
  for await (const msg of sub) {
    const task = JSON.parse(sc.decode(msg.data));
    console.log(`📋 Received task: ${task.task_id}`);
    
    // Start processing
    await nc.publish(`worker.progress.${WORKER_ID}`, sc.encode(JSON.stringify({
      worker_id: WORKER_ID,
      task_id: task.task_id,
      status: 'executing',
      phase: 'initialization',
      metrics: { percent_complete: 10, current_operation: 'Starting analysis' }
    })));

    // Simulate work with analytics
    for (let i = 20; i <= 100; i += 20) {
      await new Promise(r => setTimeout(r, 2000));
      
      // Report progress
      await nc.publish(`worker.progress.${WORKER_ID}`, sc.encode(JSON.stringify({
        worker_id: WORKER_ID,
        task_id: task.task_id,
        status: 'executing',
        phase: 'analyzing',
        metrics: {
          percent_complete: i,
          current_operation: `Analyzing ${i < 40 ? 'performance' : i < 60 ? 'resources' : i < 80 ? 'quality' : 'finalizing'}`,
          memory_usage_mb: 256 + i,
          cpu_usage_percent: 15 + (i/10),
          files_analyzed: i/2,
          tests_run: i/5
        }
      })));
      
      // Stream real-time data
      await nc.publish(`worker.stream.analytics.${WORKER_ID}`, sc.encode(JSON.stringify({
        worker_id: WORKER_ID,
        task_id: task.task_id,
        stream_type: 'analytics',
        content: `Processing analytics batch ${i/20}/5`,
        priority: 'high',
        metadata: { batch_size: 100, items_processed: i * 10 }
      })));
      
      // Report analytics
      await nc.publish(`worker.analytics.performance`, sc.encode(JSON.stringify({
        worker_id: WORKER_ID,
        task_id: task.task_id,
        analytics_type: 'performance',
        data: {
          execution_time_ms: i * 100,
          memory_peak_mb: 256 + i,
          cpu_average_percent: 15 + (i/10),
          throughput: i * 5
        }
      })));
    }
    
    // Report milestone
    await nc.publish(`worker.milestone.${WORKER_ID}`, sc.encode(JSON.stringify({
      worker_id: WORKER_ID,
      task_id: task.task_id,
      milestone_name: 'Analysis Complete',
      milestone_type: 'phase_complete',
      impact: 'high',
      metrics: { quality_score: 95 }
    })));
    
    // Complete task
    await nc.publish(`worker.completion.${WORKER_ID}`, sc.encode(JSON.stringify({
      worker_id: WORKER_ID,
      task_id: task.task_id,
      status: 'success',
      summary: {
        total_execution_time_ms: 10000,
        files_analyzed: 50,
        tests_run: 20,
        quality_score: 95,
        performance_score: 88
      }
    })));
    
    console.log('✅ Task completed');
  }
})();

// Send heartbeats
setInterval(async () => {
  await nc.publish(`worker.heartbeat.${WORKER_ID}`, sc.encode(JSON.stringify({
    worker_id: WORKER_ID,
    status: 'active',
    health: { cpu_usage: 15, memory_usage: 30 }
  })));
}, 5000);

console.log('👷 Worker ready and waiting for tasks...');
