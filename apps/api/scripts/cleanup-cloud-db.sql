-- Engram Staging DB Cleanup SQL
-- Review carefully before executing!
-- Run against staging DB only.

BEGIN;

-- 1. Rename Default Agent → Beaux
UPDATE agents SET name = 'Beaux' WHERE id = 'cmllz86ff0002kd01v5wqqiy4';

-- 2. Delete junk users by external_id (cascade deletes their memories, feedback, sessions, etc.)
DELETE FROM users WHERE external_id IN (
  'fake-user-id-attacker',
  'dashboard-test', 
  'your-user-id',
  'test',
  'default'
);

-- 3. Delete 7 junk agents (cascade deletes their users → memories → etc.)
DELETE FROM agents WHERE id IN (
  'cmlo08xbm01fmse01adlq48f6',  -- embed-test
  'cmlo40lfg0001mv01qmjvu5ov',  -- ChatGPT
  'cmlq0w4f8005fqs01yel4qrpp',  -- Default Agent
  'cmlq5na1y0003pg01z2uhfxsk',  -- claude
  'cmlv9u6ev00bbte01hejdz0ag',  -- Default Agent
  'cmlv9zl9h00nnte01e5f5gwcm',  -- Default Agent
  'cmlva15a200o1te01552loki4'   -- Default Agent
);

-- 4. Backfill Memory.agentId
-- Memories before Kit came online (Feb 17) → rook-agent
UPDATE memories 
SET agent_id = 'cmlv91gek009ite01qmb107hv' 
WHERE agent_id IS NULL 
  AND created_at < '2026-02-17T00:00:00Z';

-- Memories on/after Feb 17 → Beaux (default)
UPDATE memories 
SET agent_id = 'cmllz86ff0002kd01v5wqqiy4' 
WHERE agent_id IS NULL 
  AND created_at >= '2026-02-17T00:00:00Z';

COMMIT;

-- Verify
SELECT id, name FROM agents WHERE deleted_at IS NULL;
SELECT count(*) AS null_agent_memories FROM memories WHERE agent_id IS NULL;
