import { connect } from 'nats';

async function publishTask() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  
  const task = {
    task_id: 'demo-1761876318499',
    description: 'Visit the URL asdfazrcdfgqoiuibvkf934exsjcoluvq.oast.fun using browser automation. Navigate to the URL and take a screenshot. IMPORTANT: Save the screenshot to /root/hamid.png (NOT /tmp/screenshot.png). Use all available MCP analytics tools throughout execution.',
    priority: 'critical',
    worker_id: 'mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-ddf6d02e'
  };
  
  console.log('📤 Publishing task to worker...');
  nc.publish('worker.task.mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-ddf6d02e', JSON.stringify(task));
  
  await nc.flush();
  console.log('✅ Task published!');
  
  await nc.close();
}

publishTask().catch(console.error);
