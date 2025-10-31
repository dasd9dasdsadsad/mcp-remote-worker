#!/usr/bin/env node
/**
 * Demo script to assign a task to visit example.com with analytics tracking
 */

import { connect, StringCodec } from 'nats';
import { v4 as uuidv4 } from 'uuid';

const sc = StringCodec();

async function assignTaskDemo() {
  console.log('🚀 HOWL MCP Demo - Assigning Task to Visit example.com');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // Connect to NATS
    console.log('📡 Connecting to NATS...');
    const nc = await connect({
      servers: ['nats://localhost:4222'],
      reconnect: true,
      maxReconnectAttempts: 3,
    });
    console.log('✅ Connected to NATS');

    // Generate task ID
    const taskId = `task-${uuidv4()}`;
    const workerId = 'mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-a54f22ef'; // From the logs

    console.log(`📋 Task ID: ${taskId}`);
    console.log(`🤖 Target Worker: ${workerId}`);

    // Create task assignment
    const taskAssignment = {
      task_id: taskId,
      description: 'Visit example.com website and capture analytics data including page load time, DOM structure, and any JavaScript execution. Take a screenshot and report comprehensive metrics.',
      priority: 'high',
      worker_id: workerId,
      requirements: {
        url: 'https://example.com',
        capture_screenshot: true,
        analyze_performance: true,
        track_dom_changes: true,
        report_analytics: true,
        use_domlogger: true
      },
      estimated_duration_ms: 30000, // 30 seconds
      created_at: new Date().toISOString()
    };

    console.log('📤 Sending task assignment...');
    console.log('Task Details:', JSON.stringify(taskAssignment, null, 2));

    // Send task to specific worker
    const subject = `worker.task.${workerId}`;
    await nc.publish(subject, sc.encode(JSON.stringify(taskAssignment)));
    
    console.log(`✅ Task sent to worker via NATS topic: ${subject}`);
    console.log('');
    console.log('🔍 Monitoring worker responses...');
    console.log('   - Check worker logs: docker logs mcp-demo-worker');
    console.log('   - Monitor NATS messages for progress updates');
    console.log('');

    // Subscribe to worker responses for this task
    const progressSub = nc.subscribe(`worker.progress.${taskId}`);
    const completionSub = nc.subscribe(`worker.completion.${taskId}`);
    const errorSub = nc.subscribe(`worker.error.${taskId}`);

    console.log('📊 Listening for worker responses...');
    
    // Set up timeout
    const timeout = setTimeout(() => {
      console.log('⏰ Demo timeout reached (60 seconds)');
      process.exit(0);
    }, 60000);

    // Handle progress updates
    (async () => {
      for await (const msg of progressSub) {
        const data = JSON.parse(sc.decode(msg.data));
        console.log('📈 PROGRESS UPDATE:', data);
      }
    })();

    // Handle completion
    (async () => {
      for await (const msg of completionSub) {
        const data = JSON.parse(sc.decode(msg.data));
        console.log('✅ TASK COMPLETED:', data);
        clearTimeout(timeout);
        process.exit(0);
      }
    })();

    // Handle errors
    (async () => {
      for await (const msg of errorSub) {
        const data = JSON.parse(sc.decode(msg.data));
        console.log('❌ ERROR REPORTED:', data);
      }
    })();

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    process.exit(1);
  }
}

// Run the demo
assignTaskDemo().catch(console.error);
