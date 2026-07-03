-- =============================================================================
-- ROLLBACK: Disable RLS on all tables and drop policies/functions
-- Generated: 2026-02-14
-- =============================================================================

BEGIN;

-- =============================================================================
-- Drop all policies (must drop before disabling RLS)
-- =============================================================================

-- accounts
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;
DROP POLICY IF EXISTS accounts_insert_service ON accounts;
DROP POLICY IF EXISTS accounts_delete_service ON accounts;

-- agents
DROP POLICY IF EXISTS agents_select ON agents;
DROP POLICY IF EXISTS agents_insert ON agents;
DROP POLICY IF EXISTS agents_update ON agents;
DROP POLICY IF EXISTS agents_delete ON agents;

-- users
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;

-- projects
DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

-- sessions
DROP POLICY IF EXISTS sessions_select ON sessions;
DROP POLICY IF EXISTS sessions_insert ON sessions;
DROP POLICY IF EXISTS sessions_update ON sessions;
DROP POLICY IF EXISTS sessions_delete ON sessions;

-- memories
DROP POLICY IF EXISTS memories_select ON memories;
DROP POLICY IF EXISTS memories_insert ON memories;
DROP POLICY IF EXISTS memories_update ON memories;
DROP POLICY IF EXISTS memories_delete ON memories;

-- ux_feedback
DROP POLICY IF EXISTS ux_feedback_select ON ux_feedback;
DROP POLICY IF EXISTS ux_feedback_insert ON ux_feedback;
DROP POLICY IF EXISTS ux_feedback_update ON ux_feedback;
DROP POLICY IF EXISTS ux_feedback_delete ON ux_feedback;

-- memory_extractions
DROP POLICY IF EXISTS memory_extractions_select ON memory_extractions;
DROP POLICY IF EXISTS memory_extractions_insert ON memory_extractions;
DROP POLICY IF EXISTS memory_extractions_update ON memory_extractions;
DROP POLICY IF EXISTS memory_extractions_delete ON memory_extractions;

-- entities
DROP POLICY IF EXISTS entities_select ON entities;
DROP POLICY IF EXISTS entities_insert ON entities;
DROP POLICY IF EXISTS entities_update ON entities;
DROP POLICY IF EXISTS entities_delete ON entities;

-- memory_entities
DROP POLICY IF EXISTS memory_entities_select ON memory_entities;
DROP POLICY IF EXISTS memory_entities_insert ON memory_entities;
DROP POLICY IF EXISTS memory_entities_update ON memory_entities;
DROP POLICY IF EXISTS memory_entities_delete ON memory_entities;

-- memory_chain_links
DROP POLICY IF EXISTS memory_chain_links_select ON memory_chain_links;
DROP POLICY IF EXISTS memory_chain_links_insert ON memory_chain_links;
DROP POLICY IF EXISTS memory_chain_links_update ON memory_chain_links;
DROP POLICY IF EXISTS memory_chain_links_delete ON memory_chain_links;

-- feedback
DROP POLICY IF EXISTS feedback_select ON feedback;
DROP POLICY IF EXISTS feedback_insert ON feedback;
DROP POLICY IF EXISTS feedback_update ON feedback;
DROP POLICY IF EXISTS feedback_delete ON feedback;

-- webhooks
DROP POLICY IF EXISTS webhooks_select ON webhooks;
DROP POLICY IF EXISTS webhooks_insert ON webhooks;
DROP POLICY IF EXISTS webhooks_update ON webhooks;
DROP POLICY IF EXISTS webhooks_delete ON webhooks;

-- webhook_deliveries
DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_insert ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_update ON webhook_deliveries;
DROP POLICY IF EXISTS webhook_deliveries_delete ON webhook_deliveries;

-- webhook_subscriptions
DROP POLICY IF EXISTS webhook_subscriptions_select ON webhook_subscriptions;
DROP POLICY IF EXISTS webhook_subscriptions_insert ON webhook_subscriptions;
DROP POLICY IF EXISTS webhook_subscriptions_update ON webhook_subscriptions;
DROP POLICY IF EXISTS webhook_subscriptions_delete ON webhook_subscriptions;

-- webhook_delivery_logs
DROP POLICY IF EXISTS webhook_delivery_logs_select ON webhook_delivery_logs;
DROP POLICY IF EXISTS webhook_delivery_logs_insert ON webhook_delivery_logs;
DROP POLICY IF EXISTS webhook_delivery_logs_update ON webhook_delivery_logs;
DROP POLICY IF EXISTS webhook_delivery_logs_delete ON webhook_delivery_logs;

-- memory_embeddings
DROP POLICY IF EXISTS memory_embeddings_select ON memory_embeddings;
DROP POLICY IF EXISTS memory_embeddings_insert ON memory_embeddings;
DROP POLICY IF EXISTS memory_embeddings_update ON memory_embeddings;
DROP POLICY IF EXISTS memory_embeddings_delete ON memory_embeddings;

-- memory_pools
DROP POLICY IF EXISTS memory_pools_select ON memory_pools;
DROP POLICY IF EXISTS memory_pools_insert ON memory_pools;
DROP POLICY IF EXISTS memory_pools_update ON memory_pools;
DROP POLICY IF EXISTS memory_pools_delete ON memory_pools;

-- memory_pool_memberships
DROP POLICY IF EXISTS memory_pool_memberships_select ON memory_pool_memberships;
DROP POLICY IF EXISTS memory_pool_memberships_insert ON memory_pool_memberships;
DROP POLICY IF EXISTS memory_pool_memberships_update ON memory_pool_memberships;
DROP POLICY IF EXISTS memory_pool_memberships_delete ON memory_pool_memberships;

-- pool_grants
DROP POLICY IF EXISTS pool_grants_select ON pool_grants;
DROP POLICY IF EXISTS pool_grants_insert ON pool_grants;
DROP POLICY IF EXISTS pool_grants_update ON pool_grants;
DROP POLICY IF EXISTS pool_grants_delete ON pool_grants;

-- agent_sessions
DROP POLICY IF EXISTS agent_sessions_deny_all ON agent_sessions;

-- memory_access_logs
DROP POLICY IF EXISTS memory_access_logs_deny_all ON memory_access_logs;

-- graph_entities
DROP POLICY IF EXISTS graph_entities_select ON graph_entities;
DROP POLICY IF EXISTS graph_entities_insert ON graph_entities;
DROP POLICY IF EXISTS graph_entities_update ON graph_entities;
DROP POLICY IF EXISTS graph_entities_delete ON graph_entities;

-- graph_relationships
DROP POLICY IF EXISTS graph_relationships_select ON graph_relationships;
DROP POLICY IF EXISTS graph_relationships_insert ON graph_relationships;
DROP POLICY IF EXISTS graph_relationships_update ON graph_relationships;
DROP POLICY IF EXISTS graph_relationships_delete ON graph_relationships;

-- graph_entity_mentions
DROP POLICY IF EXISTS graph_entity_mentions_select ON graph_entity_mentions;
DROP POLICY IF EXISTS graph_entity_mentions_insert ON graph_entity_mentions;
DROP POLICY IF EXISTS graph_entity_mentions_update ON graph_entity_mentions;
DROP POLICY IF EXISTS graph_entity_mentions_delete ON graph_entity_mentions;

-- hierarchy_units
DROP POLICY IF EXISTS hierarchy_units_select ON hierarchy_units;
DROP POLICY IF EXISTS hierarchy_units_insert ON hierarchy_units;
DROP POLICY IF EXISTS hierarchy_units_update ON hierarchy_units;
DROP POLICY IF EXISTS hierarchy_units_delete ON hierarchy_units;

-- memory_merge_events
DROP POLICY IF EXISTS memory_merge_events_select ON memory_merge_events;
DROP POLICY IF EXISTS memory_merge_events_insert ON memory_merge_events;
DROP POLICY IF EXISTS memory_merge_events_update ON memory_merge_events;
DROP POLICY IF EXISTS memory_merge_events_delete ON memory_merge_events;

-- merge_candidates
DROP POLICY IF EXISTS merge_candidates_select ON merge_candidates;
DROP POLICY IF EXISTS merge_candidates_insert ON merge_candidates;
DROP POLICY IF EXISTS merge_candidates_update ON merge_candidates;
DROP POLICY IF EXISTS merge_candidates_delete ON merge_candidates;

-- dedup_configs
DROP POLICY IF EXISTS dedup_configs_select ON dedup_configs;
DROP POLICY IF EXISTS dedup_configs_insert ON dedup_configs;
DROP POLICY IF EXISTS dedup_configs_update ON dedup_configs;
DROP POLICY IF EXISTS dedup_configs_delete ON dedup_configs;

-- dedup_batch_runs
DROP POLICY IF EXISTS dedup_batch_runs_select ON dedup_batch_runs;
DROP POLICY IF EXISTS dedup_batch_runs_insert ON dedup_batch_runs;
DROP POLICY IF EXISTS dedup_batch_runs_update ON dedup_batch_runs;
DROP POLICY IF EXISTS dedup_batch_runs_delete ON dedup_batch_runs;

-- memory_clusters
DROP POLICY IF EXISTS memory_clusters_deny_all ON memory_clusters;

-- audit_logs
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
DROP POLICY IF EXISTS audit_logs_update ON audit_logs;
DROP POLICY IF EXISTS audit_logs_delete ON audit_logs;

-- consolidation_jobs
DROP POLICY IF EXISTS consolidation_jobs_deny_all ON consolidation_jobs;

-- dream_cycle_reports
DROP POLICY IF EXISTS dream_cycle_reports_select ON dream_cycle_reports;
DROP POLICY IF EXISTS dream_cycle_reports_insert ON dream_cycle_reports;
DROP POLICY IF EXISTS dream_cycle_reports_update ON dream_cycle_reports;
DROP POLICY IF EXISTS dream_cycle_reports_delete ON dream_cycle_reports;

-- dream_cycle_runs
DROP POLICY IF EXISTS dream_cycle_runs_deny_all ON dream_cycle_runs;

-- drift_snapshots
DROP POLICY IF EXISTS drift_snapshots_deny_all ON drift_snapshots;

-- ensemble tables
DROP POLICY IF EXISTS ensemble_reembed_jobs_deny_all ON ensemble_reembed_jobs;
DROP POLICY IF EXISTS ensemble_reembed_checkpoints_deny_all ON ensemble_reembed_checkpoints;
DROP POLICY IF EXISTS ensemble_reembed_events_deny_all ON ensemble_reembed_events;
DROP POLICY IF EXISTS ensemble_embedding_versions_deny_all ON ensemble_embedding_versions;
DROP POLICY IF EXISTS ensemble_model_configs_deny_all ON ensemble_model_configs;
DROP POLICY IF EXISTS ensemble_ab_test_results_deny_all ON ensemble_ab_test_results;

-- eval_runs
DROP POLICY IF EXISTS eval_runs_deny_all ON eval_runs;

-- monitoring_snapshots
DROP POLICY IF EXISTS monitoring_snapshots_deny_all ON monitoring_snapshots;

-- _prisma_migrations
DROP POLICY IF EXISTS prisma_migrations_deny_all ON _prisma_migrations;

-- =============================================================================
-- Disable RLS on all tables
-- =============================================================================

ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE ux_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extractions DISABLE ROW LEVEL SECURITY;
ALTER TABLE entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_chain_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_pools DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_pool_memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE pool_grants DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_access_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entities DISABLE ROW LEVEL SECURITY;
ALTER TABLE graph_relationships DISABLE ROW LEVEL SECURITY;
ALTER TABLE graph_entity_mentions DISABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchy_units DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_merge_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE merge_candidates DISABLE ROW LEVEL SECURITY;
ALTER TABLE dedup_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE dedup_batch_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE memory_clusters DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE dream_cycle_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE drift_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_checkpoints DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_reembed_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_embedding_versions DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_model_configs DISABLE ROW LEVEL SECURITY;
ALTER TABLE ensemble_ab_test_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_snapshots DISABLE ROW LEVEL SECURITY;
ALTER TABLE _prisma_migrations DISABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Drop helper functions
-- =============================================================================

DROP FUNCTION IF EXISTS memory_belongs_to_account(TEXT);
DROP FUNCTION IF EXISTS engram_user_belongs_to_account(TEXT);
DROP FUNCTION IF EXISTS agent_belongs_to_user(TEXT);
DROP FUNCTION IF EXISTS get_user_account_id();

-- =============================================================================
-- Remove supabase_user_id column
-- =============================================================================

DROP INDEX IF EXISTS idx_accounts_supabase_user_id;
ALTER TABLE accounts DROP COLUMN IF EXISTS supabase_user_id;

COMMIT;
