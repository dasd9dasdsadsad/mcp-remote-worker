-- MCP Manager Database Schema

-- Create archived_tasks table
CREATE TABLE IF NOT EXISTS archived_tasks (
    task_id UUID PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) NOT NULL,
    progress_history JSONB,
    metadata JSONB,
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_archived_tasks_worker_id ON archived_tasks(worker_id);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_status ON archived_tasks(status);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_created_at ON archived_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_archived_tasks_archived_at ON archived_tasks(archived_at);
