-- Enable Row Level Security on all tenant-scoped tables
-- 
-- Architecture:
--   1. Create an `app` role WITHOUT BYPASSRLS (postgres has BYPASSRLS which overrides all RLS)
--   2. The RLS interceptor does SET LOCAL ROLE app + SET LOCAL app.current_account_id = '...'
--   3. Policies allow all access when app.current_account_id is not set (admin/system mode)
--   4. Policies filter by account when app.current_account_id IS set (tenant mode)
--
-- The app role was already created before this migration (CREATE ROLE app NOLOGIN NOBYPASSRLS).
-- This migration focuses on enabling RLS and creating policies.

-- ============================================================================
-- HELPER: reusable function to get current account ID (NULL = admin mode)
-- ============================================================================
CREATE OR REPLACE FUNCTION rls_account_id() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '');
$$ LANGUAGE sql STABLE;

-- Helper: get user IDs belonging to current account (for deep-chain tables)
CREATE OR REPLACE FUNCTION rls_user_ids() RETURNS SETOF TEXT AS $$
  SELECT u.id FROM users u
  JOIN agents a ON u.agent_id = a.id
  WHERE a.account_id = rls_account_id();
$$ LANGUAGE sql STABLE;

-- Helper: get agent IDs belonging to current account
CREATE OR REPLACE FUNCTION rls_agent_ids() RETURNS SETOF TEXT AS $$
  SELECT id FROM agents WHERE account_id = rls_account_id();
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- TIER 1: Tables with direct accountId
-- ============================================================================

-- accounts: own row only
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON accounts FOR ALL USING (
  rls_account_id() IS NULL OR id = rls_account_id()
);

-- agents: direct account_id
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agents FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- cloud_links: direct account_id
ALTER TABLE cloud_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON cloud_links FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- instance_api_keys: direct account_id
ALTER TABLE instance_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON instance_api_keys FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- instance_sync_keys: direct account_id
ALTER TABLE instance_sync_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON instance_sync_keys FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- ux_feedback: direct account_id
ALTER TABLE ux_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON ux_feedback FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- cloud_instances: direct account_id
ALTER TABLE cloud_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON cloud_instances FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- sync_events: direct account_id
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON sync_events FOR ALL USING (
  rls_account_id() IS NULL OR account_id = rls_account_id()
);

-- ============================================================================
-- TIER 2: Tables linked through agents (agent_id → agents.account_id)
-- ============================================================================

-- users: via agent_id
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON users FOR ALL USING (
  rls_account_id() IS NULL
  OR agent_id IN (SELECT rls_agent_ids())
);

-- webhooks: via agent_id
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON webhooks FOR ALL USING (
  rls_account_id() IS NULL
  OR agent_id IN (SELECT rls_agent_ids())
);

-- audit_logs: via agent_id
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON audit_logs FOR ALL USING (
  rls_account_id() IS NULL
  OR agent_id IN (SELECT rls_agent_ids())
);

-- ============================================================================
-- TIER 3: Tables linked through users → agents
-- ============================================================================

-- memories: via user_id → agent → account
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memories FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- sessions: via user_id
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON sessions FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- projects: via user_id
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON projects FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- feedback: via user_id
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON feedback FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- entities: via user_id
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON entities FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- graph_entities: via user_id
ALTER TABLE graph_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON graph_entities FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- graph_relationships: via user_id
ALTER TABLE graph_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON graph_relationships FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- graph_entity_mentions: via user_id
ALTER TABLE graph_entity_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON graph_entity_mentions FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- memory_pools: via user_id
ALTER TABLE memory_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_pools FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- consolidation_jobs: via user_id
ALTER TABLE consolidation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON consolidation_jobs FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- webhook_subscriptions: via user_id
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON webhook_subscriptions FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- hierarchy_units: via user_id
ALTER TABLE hierarchy_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON hierarchy_units FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- dream_cycle_reports: via user_id
ALTER TABLE dream_cycle_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON dream_cycle_reports FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- dedup_configs: via user_id
ALTER TABLE dedup_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON dedup_configs FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- dedup_batch_runs: via user_id
ALTER TABLE dedup_batch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON dedup_batch_runs FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- merge_candidates: via user_id
ALTER TABLE merge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON merge_candidates FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- memory_merge_events: via user_id
ALTER TABLE memory_merge_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_merge_events FOR ALL USING (
  rls_account_id() IS NULL
  OR user_id IN (SELECT rls_user_ids())
);

-- ============================================================================
-- TIER 4: Tables linked through memory_id → memories
-- ============================================================================

-- memory_extractions: via memory_id
ALTER TABLE memory_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_extractions FOR ALL USING (
  rls_account_id() IS NULL
  OR memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- memory_entities: via memory_id
ALTER TABLE memory_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_entities FOR ALL USING (
  rls_account_id() IS NULL
  OR memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- memory_chain_links: via source_id
ALTER TABLE memory_chain_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_chain_links FOR ALL USING (
  rls_account_id() IS NULL
  OR source_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- memory_embeddings: via memory_id
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_embeddings FOR ALL USING (
  rls_account_id() IS NULL
  OR memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- memory_pool_memberships: via memory_id
ALTER TABLE memory_pool_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_pool_memberships FOR ALL USING (
  rls_account_id() IS NULL
  OR memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- memory_access_logs: via memory_id
ALTER TABLE memory_access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON memory_access_logs FOR ALL USING (
  rls_account_id() IS NULL
  OR memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- ============================================================================
-- TIER 5: Other linked tables
-- ============================================================================

-- webhook_deliveries: via webhook_id → webhooks.agent_id
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON webhook_deliveries FOR ALL USING (
  rls_account_id() IS NULL
  OR webhook_id IN (SELECT id FROM webhooks WHERE agent_id IN (SELECT rls_agent_ids()))
);

-- webhook_delivery_logs: via subscription_id
ALTER TABLE webhook_delivery_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON webhook_delivery_logs FOR ALL USING (
  rls_account_id() IS NULL
  OR subscription_id IN (SELECT id FROM webhook_subscriptions WHERE user_id IN (SELECT rls_user_ids()))
);

-- sync_agent_map: via cloud_agent_id
ALTER TABLE sync_agent_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON sync_agent_map FOR ALL USING (
  rls_account_id() IS NULL
  OR cloud_agent_id IN (SELECT rls_agent_ids())
);

-- sync_user_map: via cloud_user_id
ALTER TABLE sync_user_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON sync_user_map FOR ALL USING (
  rls_account_id() IS NULL
  OR cloud_user_id IN (SELECT rls_user_ids())
);

-- sync_id_map: via cloud_memory_id
ALTER TABLE sync_id_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON sync_id_map FOR ALL USING (
  rls_account_id() IS NULL
  OR cloud_memory_id IN (SELECT id FROM memories WHERE user_id IN (SELECT rls_user_ids()))
);

-- pool_grants: via pool_id → memory_pools
ALTER TABLE pool_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON pool_grants FOR ALL USING (
  rls_account_id() IS NULL
  OR pool_id IN (SELECT id FROM memory_pools WHERE user_id IN (SELECT rls_user_ids()))
);

-- agent_sessions: via pool_grants → memory_pools
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_isolation ON agent_sessions FOR ALL USING (
  rls_account_id() IS NULL
  OR id IN (
    SELECT agent_session_id FROM pool_grants WHERE pool_id IN (
      SELECT id FROM memory_pools WHERE user_id IN (SELECT rls_user_ids())
    )
  )
);

-- ============================================================================
-- SYSTEM/GLOBAL tables — NO RLS needed
-- ============================================================================
-- _prisma_migrations (Supabase managed)
-- ensemble_model_configs, ensemble_reembed_jobs, ensemble_reembed_checkpoints
-- ensemble_reembed_events, ensemble_embedding_versions, ensemble_ab_test_results
-- monitoring_snapshots, eval_runs, fog_index_snapshots, drift_snapshots
-- dream_cycle_runs, memory_clusters
