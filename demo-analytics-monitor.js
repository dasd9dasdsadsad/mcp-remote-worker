#!/usr/bin/env node
/**
 * Demo Analytics Monitor - Shows real-time system analytics
 */

import { connect, StringCodec } from 'nats';
import { createClient } from 'redis';

const sc = StringCodec();

async function monitorSystemAnalytics() {
  console.log('📊 HOWL MCP System Analytics Monitor');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    // Connect to NATS
    console.log('📡 Connecting to NATS...');
    const nc = await connect({
      servers: ['nats://localhost:4222'],
      reconnect: true,
    });
    console.log('✅ Connected to NATS');

    // Connect to Redis
    console.log('📡 Connecting to Redis...');
    const redis = createClient({
      socket: { host: 'localhost', port: 6379 }
    });
    await redis.connect();
    console.log('✅ Connected to Redis');

    console.log('');
    console.log('🔍 System Status Overview:');
    console.log('═══════════════════════════════════════════════════════════════');

    // Check active workers
    const workerKeys = await redis.keys('worker:*');
    console.log(`👥 Active Workers: ${workerKeys.length}`);
    
    for (const key of workerKeys.slice(0, 3)) { // Show first 3
      const workerData = await redis.hGetAll(key);
      console.log(`   - ${workerData.worker_id || 'Unknown'}: ${workerData.status || 'Unknown'}`);
    }

    // Check task queue
    const taskKeys = await redis.keys('task:*');
    console.log(`📋 Tasks in System: ${taskKeys.length}`);

    // Monitor real-time events
    console.log('');
    console.log('📡 Real-time Event Stream:');
    console.log('═══════════════════════════════════════════════════════════════');

    // Subscribe to all worker events
    const workerSub = nc.subscribe('worker.>');
    const managerSub = nc.subscribe('manager.>');

    let eventCount = 0;
    const maxEvents = 20;

    // Handle worker events
    (async () => {
      for await (const msg of workerSub) {
        if (eventCount >= maxEvents) break;
        
        try {
          const data = JSON.parse(sc.decode(msg.data));
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] 🤖 WORKER EVENT: ${msg.subject}`);
          
          if (data.task_id) console.log(`   Task: ${data.task_id}`);
          if (data.status) console.log(`   Status: ${data.status}`);
          if (data.metrics) console.log(`   Metrics: ${JSON.stringify(data.metrics)}`);
          
          eventCount++;
        } catch (e) {
          console.log(`[${new Date().toLocaleTimeString()}] 📡 Raw Event: ${msg.subject}`);
          eventCount++;
        }
      }
    })();

    // Handle manager events
    (async () => {
      for await (const msg of managerSub) {
        if (eventCount >= maxEvents) break;
        
        try {
          const data = JSON.parse(sc.decode(msg.data));
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] 🎯 MANAGER EVENT: ${msg.subject}`);
          console.log(`   Data: ${JSON.stringify(data).substring(0, 100)}...`);
          eventCount++;
        } catch (e) {
          console.log(`[${new Date().toLocaleTimeString()}] 📡 Manager Raw: ${msg.subject}`);
          eventCount++;
        }
      }
    })();

    // System metrics
    setInterval(async () => {
      try {
        const info = await redis.info('memory');
        const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
        const memory = memoryMatch ? memoryMatch[1] : 'Unknown';
        
        console.log(`[${new Date().toLocaleTimeString()}] 💾 Redis Memory: ${memory}`);
      } catch (e) {
        // Ignore errors
      }
    }, 10000);

    // Auto-exit after 2 minutes
    setTimeout(() => {
      console.log('');
      console.log('⏰ Demo monitoring complete');
      process.exit(0);
    }, 120000);

  } catch (error) {
    console.error('❌ Monitor failed:', error.message);
    process.exit(1);
  }
}

// Run the monitor
monitorSystemAnalytics().catch(console.error);
