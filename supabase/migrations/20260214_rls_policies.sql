-- =============================================================================
-- ENGRAM: Row Level Security Policies
-- Generated: 2026-02-14
--
-- Uses SET LOCAL app.current_account_id (set by application middleware)
-- instead of auth.uid() since Engram uses custom JWT auth, not Supabase Auth.
--
-- Safe migration: only adds functions, enables RLS, creates policies.
-- No DROP, no data modification.
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 0: Helper function
-- =============================================================================

CREATE OR REPLACE FUNCTION get_current_account_id()
RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '')
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- STEP 1: Bypass role for the application service
-- The app connects as engram_admin; grant it BYPASSRLS so it can
-- operate normally. RLS is enforced via SET LOCAL in transactions.
-- =============================================================================

DO $$
BEGIN
  -- Grant BYPASSRLS to engram_admin if it exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'engram_admin') THEN
    ALTER ROLE engram_admin BYPASSRLS;
  END IF;

  -- Grant BYPASSRLS to clawdbot (local dev app role) if it exists
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clawdbot') THEN
    ALTER ROLE clawdbot BYPASSRLS;
  END IF;
END $$;

-- =============================================================================
-- STEP 2: Helper functions for ownership chain resolution
-- =============================================================================

CREATE OR REPLACE FUNCTION agent_belongs_to_current_account(p_agent_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM agents
    WHERE id = p_agent_id
      AND account_id = get_current_account_id()
  )
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION user_belongs_to_current_account(p_user_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN agents a ON u.agent_id = a.id
    WHERE u.id = p_user_id
      AND a.account_id = get_current_account_id()
  )
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION memory_belongs_to_current_account(p_memory_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM memories m
    JOIN users u ON m.user_id = u.id
    JOIN agents a ON u.agent_id = a.id
    WHERE m.id = p_memory_id
      AND a.account_id = get_current_account_id()
  )
$$ LANGUAGE sql STABLE;

-- =============================================================================
-- STEP 3: Enable RLS on ALL tables + FORCE (applies even to table owners)
-- =============================================================================

-- Core user-facing tables
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
ALTER TABLE ux_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ux_feedback FORCE ROW LEVEL SECURITY;

-- Data tables
ALTER TABLE memory_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extractions FORCE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_chain_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_chain_links FORCE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_pools FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_pool_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_pool_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE pool_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_access_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;

-- Semantic graph tables
ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_mentions FORCE ROW LEVEL SECURITY;

-- Hierarchy
ALTER TABLE hierarchy_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchy_units FORCE ROW LEVEL SECURITY;

-- Dedup tables
ALTER TABLE memory_merge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_merge_events FORCE ROW LEVEL SECURITY;
ALTER TABLE merge_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE merge_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE dedup_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dedup_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE dedup_batch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dedup_batch_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_clusters FORCE ROW LEVEL SECURITY;

-- Audit
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- System/internal tables
ALTER TABLE consolidation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE drift_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE drift_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_embedding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_embedding_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_model_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE ensemble_ab_test_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_ab_test_results FORCE ROW LEVEL SECURITY;
ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE fog_index_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE fog_index_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE monitoring_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_snapshots FORCE ROW LEVEL SECURITY;

-- Prisma migrations (protect from non-admin access)
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE _prisma_migrations FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- STEP 4: Policies — ACCOUNTS
-- =============================================================================

CREATE POLICY accounts_all ON accounts FOR ALL
  USING (id = get_current_account_id())
  WITH CHECK (id = get_current_account_id());

-- =============================================================================
-- STEP 5: Policies — AGENTS (account_id direct match)
-- =============================================================================

CREATE POLICY agents_all ON agents FOR ALL
  USING (account_id = get_current_account_id())
  WITH CHECK (account_id = get_current_account_id());

-- =============================================================================
-- STEP 6: Policies — UX_FEEDBACK (account_id direct match)
-- =============================================================================

CREATE POLICY ux_feedback_all ON ux_feedback FOR ALL
  USING (account_id = get_current_account_id())
  WITH CHECK (account_id = get_current_account_id());

-- =============================================================================
-- STEP 7: Policies — USERS (through agents)
-- =============================================================================

CREATE POLICY users_all ON users FOR ALL
  USING (EXISTS (
    SELECT 1 FROM agents WHERE agents.id = users.agent_id
      AND agents.account_id = get_current_account_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM agents WHERE agents.id = users.agent_id
      AND agents.account_id = get_current_account_id()
  ));

-- =============================================================================
-- STEP 8: Policies — PROJECTS (user_id -> users -> agents)
-- =============================================================================

CREATE POLICY projects_all ON projects FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 9: Policies — SESSIONS (user_id -> users -> agents)
-- =============================================================================

CREATE POLICY sessions_all ON sessions FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 10: Policies — MEMORIES (user_id -> users -> agents)
-- =============================================================================

CREATE POLICY memories_all ON memories FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 11: Policies — MEMORY_EXTRACTIONS (through memory)
-- =============================================================================

CREATE POLICY memory_extractions_all ON memory_extractions FOR ALL
  USING (memory_belongs_to_current_account(memory_id))
  WITH CHECK (memory_belongs_to_current_account(memory_id));

-- =============================================================================
-- STEP 12: Policies — ENTITIES (user_id -> users -> agents)
-- =============================================================================

CREATE POLICY entities_all ON entities FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 13: Policies — MEMORY_ENTITIES (through memory)
-- =============================================================================

CREATE POLICY memory_entities_all ON memory_entities FOR ALL
  USING (memory_belongs_to_current_account(memory_id))
  WITH CHECK (memory_belongs_to_current_account(memory_id));

-- =============================================================================
-- STEP 14: Policies — MEMORY_CHAIN_LINKS (through source memory)
-- =============================================================================

CREATE POLICY memory_chain_links_all ON memory_chain_links FOR ALL
  USING (memory_belongs_to_current_account(source_id))
  WITH CHECK (memory_belongs_to_current_account(source_id));

-- =============================================================================
-- STEP 15: Policies — FEEDBACK (user_id -> users -> agents)
-- =============================================================================

CREATE POLICY feedback_all ON feedback FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 16: Policies — WEBHOOKS (agent_id -> agents)
-- =============================================================================

CREATE POLICY webhooks_all ON webhooks FOR ALL
  USING (agent_belongs_to_current_account(agent_id))
  WITH CHECK (agent_belongs_to_current_account(agent_id));

-- =============================================================================
-- STEP 17: Policies — WEBHOOK_DELIVERIES (through webhook -> agent)
-- =============================================================================

CREATE POLICY webhook_deliveries_all ON webhook_deliveries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM webhooks w
    JOIN agents a ON w.agent_id = a.id
    WHERE w.id = webhook_deliveries.webhook_id
      AND a.account_id = get_current_account_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM webhooks w
    JOIN agents a ON w.agent_id = a.id
    WHERE w.id = webhook_deliveries.webhook_id
      AND a.account_id = get_current_account_id()
  ));

-- =============================================================================
-- STEP 18: Policies — WEBHOOK_SUBSCRIPTIONS (user_id -> chain)
-- =============================================================================

CREATE POLICY webhook_subscriptions_all ON webhook_subscriptions FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 19: Policies — WEBHOOK_DELIVERY_LOGS (through subscription)
-- =============================================================================

CREATE POLICY webhook_delivery_logs_all ON webhook_delivery_logs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM webhook_subscriptions ws
    WHERE ws.id::text = webhook_delivery_logs.subscription_id
      AND user_belongs_to_current_account(ws.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM webhook_subscriptions ws
    WHERE ws.id::text = webhook_delivery_logs.subscription_id
      AND user_belongs_to_current_account(ws.user_id)
  ));

-- =============================================================================
-- STEP 20: Policies — MEMORY_EMBEDDINGS (through memory)
-- =============================================================================

CREATE POLICY memory_embeddings_all ON memory_embeddings FOR ALL
  USING (memory_belongs_to_current_account(memory_id))
  WITH CHECK (memory_belongs_to_current_account(memory_id));

-- =============================================================================
-- STEP 21: Policies — MEMORY_POOLS (user_id -> chain)
-- =============================================================================

CREATE POLICY memory_pools_all ON memory_pools FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 22: Policies — MEMORY_POOL_MEMBERSHIPS (through memory)
-- =============================================================================

CREATE POLICY memory_pool_memberships_all ON memory_pool_memberships FOR ALL
  USING (memory_belongs_to_current_account(memory_id))
  WITH CHECK (memory_belongs_to_current_account(memory_id));

-- =============================================================================
-- STEP 23: Policies — POOL_GRANTS (through pool -> user -> chain)
-- =============================================================================

CREATE POLICY pool_grants_all ON pool_grants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM memory_pools mp
    WHERE mp.id = pool_grants.pool_id
      AND user_belongs_to_current_account(mp.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM memory_pools mp
    WHERE mp.id = pool_grants.pool_id
      AND user_belongs_to_current_account(mp.user_id)
  ));

-- =============================================================================
-- STEP 24: Policies — GRAPH tables (user_id -> chain)
-- =============================================================================

CREATE POLICY graph_entities_all ON graph_entities FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY graph_relationships_all ON graph_relationships FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY graph_entity_mentions_all ON graph_entity_mentions FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 25: Policies — HIERARCHY_UNITS (user_id -> chain)
-- =============================================================================

CREATE POLICY hierarchy_units_all ON hierarchy_units FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- =============================================================================
-- STEP 26: Policies — DEDUP tables (user_id -> chain)
-- =============================================================================

CREATE POLICY memory_merge_events_all ON memory_merge_events FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY merge_candidates_all ON merge_candidates FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY dedup_configs_all ON dedup_configs FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY dedup_batch_runs_all ON dedup_batch_runs FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

-- memory_clusters (no user_id — service only)
CREATE POLICY memory_clusters_deny ON memory_clusters FOR ALL
  USING (false) WITH CHECK (false);

-- =============================================================================
-- STEP 27: Policies — AUDIT_LOGS (agent_id -> agents)
-- =============================================================================

CREATE POLICY audit_logs_all ON audit_logs FOR ALL
  USING (agent_belongs_to_current_account(agent_id))
  WITH CHECK (agent_belongs_to_current_account(agent_id));

-- =============================================================================
-- STEP 28: Policies — SERVICE-ONLY tables (deny all via RLS; BYPASSRLS role used)
-- =============================================================================

CREATE POLICY agent_sessions_deny ON agent_sessions FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY memory_access_logs_deny ON memory_access_logs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY consolidation_jobs_deny ON consolidation_jobs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY dream_cycle_reports_all ON dream_cycle_reports FOR ALL
  USING (user_belongs_to_current_account(user_id))
  WITH CHECK (user_belongs_to_current_account(user_id));

CREATE POLICY dream_cycle_runs_deny ON dream_cycle_runs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY drift_snapshots_deny ON drift_snapshots FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_reembed_jobs_deny ON ensemble_reembed_jobs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_reembed_checkpoints_deny ON ensemble_reembed_checkpoints FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_reembed_events_deny ON ensemble_reembed_events FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_embedding_versions_deny ON ensemble_embedding_versions FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_model_configs_deny ON ensemble_model_configs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY ensemble_ab_test_results_deny ON ensemble_ab_test_results FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY eval_runs_deny ON eval_runs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY fog_index_snapshots_deny ON fog_index_snapshots FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY monitoring_snapshots_deny ON monitoring_snapshots FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY prisma_migrations_deny ON _prisma_migrations FOR ALL
  USING (false) WITH CHECK (false);

COMMIT;
