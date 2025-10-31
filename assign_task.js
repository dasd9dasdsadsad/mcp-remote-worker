import { connect } from 'nats';
import pg from 'pg';
const { Pool } = pg;

const pgPool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mcp_manager',
  user: 'postgres',
  password: 'postgres'
});

async function assignTask() {
  const nc = await connect({ servers: 'nats://localhost:4222' });
  
  const taskData = {
    task_id: 'demo-' + Date.now(),
    description: 'Visit the URL asdfazrcdfgqoiuibvkf934exsjcoluvq.oast.fun using browser automation. Navigate to the URL and take a screenshot. IMPORTANT: Save the screenshot to /root/hamid.png (NOT /tmp/screenshot.png). Use all available MCP analytics tools throughout execution.',
    priority: 'critical',
    estimated_duration_ms: 45000,
    created_at: new Date().toISOString()
  };
  
  // Store in DB
  await pgPool.query(
    'INSERT INTO tasks (task_id, description, status, priority, created_at) VALUES ($1, $2, $3, $4, NOW())',
    [taskData.task_id, taskData.description, 'pending', taskData.priority]
  );
  
  console.log('✅ Task created:', taskData.task_id);
  
  await nc.close();
  await pgPool.end();
}

assignTask().catch(console.error);
