-- Update existing tables to support interactive sessions

-- Add session_id to workers table if it doesn't exist
ALTER TABLE workers ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);

-- Add session_id to task_updates table if it doesn't exist
ALTER TABLE task_updates ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);

-- Create new tables for interactive features
CREATE TABLE IF NOT EXISTS worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    tasks_completed INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'active',
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS worker_questions (
    question_id VARCHAR(255) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255),
    question TEXT NOT NULL,
    question_type VARCHAR(50),
    answer TEXT,
    answered_by VARCHAR(255),
    asked_at TIMESTAMP DEFAULT NOW(),
    answered_at TIMESTAMP,
    context JSONB
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_workers_session_id ON workers(session_id);
CREATE INDEX IF NOT EXISTS idx_task_updates_session_id ON task_updates(session_id);
CREATE INDEX IF NOT EXISTS idx_worker_sessions_worker_id ON worker_sessions(worker_id);
CREATE INDEX IF NOT EXISTS idx_worker_questions_worker_id ON worker_questions(worker_id);

-- Grant permissions if needed (adjust user as necessary)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;


