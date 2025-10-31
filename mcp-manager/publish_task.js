import { connect } from 'nats';

async function publishTask() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  
  const task = {
    task_id: '8e9cfe03-7701-4675-bac8-035fd970eea2',
    description: 'Visit the URL asdfazrcdfgqoiuibvkf934exsjcoluvq.oast.fun using browser automation. Use the DOMLogger Unified tools to navigate to the URL, take a screenshot, and capture any relevant page information. Report all analytics including performance metrics, network requests, and execution time.',
    priority: 'high',
    worker_id: 'mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-dba9478a'
  };
  
  console.log('📤 Publishing task to worker queue...');
  nc.publish('worker.task.mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-dba9478a', JSON.stringify(task));
  
  await nc.flush();
  console.log('✅ Task published to: worker.task.mcp-worker-ubuntu-s-8vcpu-16gb-amd-sfo3-01-dba9478a');
  
  await nc.close();
}

publishTask().catch(console.error);
