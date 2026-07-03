-- ============================================================================
-- RLS Migration: Identity & Delegation Tables (HEY-332)
-- 
-- Adds Row-Level Security policies to 15 tables that were added after the
-- initial RLS migration (20260216230000_enable_rls_policies).
--
-- Pattern: rls_account_id() IS NULL allows admin/system mode (no tenant filter).
-- When set, rows are filtered to the authenticated account's ownership chain.
-- ============================================================================

-- ============================================================================
-- TIER 1: Direct accountId
-- ============================================================================

-- awareness_states: direct account_id
ALTER TABLE awareness_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON awareness_states FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- ============================================================================
-- TIER 3: Tables with userId (→ users → agents → accounts)
-- ============================================================================

-- trust_signals
ALTER TABLE trust_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON trust_signals FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- trust_scores
ALTER TABLE trust_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON trust_scores FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- capability_checkpoints
ALTER TABLE capability_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON capability_checkpoints FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- experience_weights
ALTER TABLE experience_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON experience_weights FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- agent_capability_profiles
ALTER TABLE agent_capability_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_capability_profiles FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- agent_work_styles
ALTER TABLE agent_work_styles ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_work_styles FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- identity_snapshots
ALTER TABLE identity_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON identity_snapshots FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- agent_teams
ALTER TABLE agent_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_teams FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- delegated_tasks
ALTER TABLE delegated_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON delegated_tasks FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- delegation_templates
ALTER TABLE delegation_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON delegation_templates FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- delegation_contracts
ALTER TABLE delegation_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON delegation_contracts FOR ALL USING (
  rls_account_id() IS NULL OR user_id IN (SELECT rls_user_ids())
);

-- ============================================================================
-- TIER 5: Tables linked through team_id → agent_teams.user_id
-- ============================================================================

-- agent_team_members: via team_id → agent_teams
ALTER TABLE agent_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_team_members FOR ALL USING (
  rls_account_id() IS NULL
  OR team_id IN (SELECT id FROM agent_teams WHERE user_id IN (SELECT rls_user_ids()))
);

-- agent_team_collaborations: via team_id → agent_teams
ALTER TABLE agent_team_collaborations ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_team_collaborations FOR ALL USING (
  rls_account_id() IS NULL
  OR team_id IN (SELECT id FROM agent_teams WHERE user_id IN (SELECT rls_user_ids()))
);

-- ============================================================================
-- SPECIAL CASE: task_completions
-- ============================================================================
-- task_completions has delegated_to and delegated_by (string session keys)
-- but NO userId or accountId column. Proper RLS requires a schema change.
--
-- TODO (HEY-332 follow-up): Add user_id column to task_completions and
-- backfill from delegated_tasks.user_id via task_id FK.
--
-- For now, we enable RLS with a permissive policy scoped through the
-- delegated_tasks table via task_id.
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON task_completions FOR ALL USING (
  rls_account_id() IS NULL
  OR task_id IN (SELECT id FROM delegated_tasks WHERE user_id IN (SELECT rls_user_ids()))
);

-- ============================================================================
-- GRANTS: Ensure the `engram_app` role can access these tables
-- Only apply if the role exists (production has it; CI/dev may not)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'engram_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON trust_signals TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON trust_scores TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON capability_checkpoints TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON experience_weights TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_capability_profiles TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_work_styles TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON identity_snapshots TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_teams TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_team_members TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent_team_collaborations TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON delegated_tasks TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON delegation_templates TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON delegation_contracts TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON task_completions TO engram_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON awareness_states TO engram_app;
  END IF;
END
$$;

-- ============================================================================
-- ROLLBACK SQL (run manually if needed — Prisma does not auto-rollback)
-- ============================================================================
-- DROP POLICY IF EXISTS account_isolation ON trust_signals;
-- ALTER TABLE trust_signals DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON trust_scores;
-- ALTER TABLE trust_scores DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON capability_checkpoints;
-- ALTER TABLE capability_checkpoints DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON experience_weights;
-- ALTER TABLE experience_weights DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON agent_capability_profiles;
-- ALTER TABLE agent_capability_profiles DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON agent_work_styles;
-- ALTER TABLE agent_work_styles DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON identity_snapshots;
-- ALTER TABLE identity_snapshots DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON agent_teams;
-- ALTER TABLE agent_teams DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON agent_team_members;
-- ALTER TABLE agent_team_members DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON agent_team_collaborations;
-- ALTER TABLE agent_team_collaborations DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON delegated_tasks;
-- ALTER TABLE delegated_tasks DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON delegation_templates;
-- ALTER TABLE delegation_templates DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON delegation_contracts;
-- ALTER TABLE delegation_contracts DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON task_completions;
-- ALTER TABLE task_completions DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS account_isolation ON awareness_states;
-- ALTER TABLE awareness_states DISABLE ROW LEVEL SECURITY;
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON trust_signals, trust_scores, capability_checkpoints, experience_weights, agent_capability_profiles, agent_work_styles, identity_snapshots, agent_teams, agent_team_members, agent_team_collaborations, delegated_tasks, delegation_templates, delegation_contracts, task_completions, awareness_states FROM engram_app;  -- only if role exists
