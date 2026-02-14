--
-- PostgreSQL database dump
--

\restrict RlonvSSP2vtNNtqSNKa0uxSkRqe7XG2N0H3S86CIeOOkVAfPKc2iMOxsTOnxOUk

-- Dumped from database version 18.1 (Postgres.app)
-- Dumped by pg_dump version 18.1 (Postgres.app)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: clawdbot
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO clawdbot;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: clawdbot
--

COMMENT ON SCHEMA public IS '';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: ChainLinkType; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."ChainLinkType" AS ENUM (
    'LED_TO',
    'SUPPORTS',
    'CONTRADICTS',
    'UPDATES',
    'RELATED'
);


ALTER TYPE public."ChainLinkType" OWNER TO clawdbot;

--
-- Name: ConsolidationStatus; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."ConsolidationStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED'
);


ALTER TYPE public."ConsolidationStatus" OWNER TO clawdbot;

--
-- Name: ConsolidationType; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."ConsolidationType" AS ENUM (
    'POST_SESSION',
    'NIGHTLY',
    'PERIODIC',
    'MANUAL'
);


ALTER TYPE public."ConsolidationType" OWNER TO clawdbot;

--
-- Name: ImportanceHint; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."ImportanceHint" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);


ALTER TYPE public."ImportanceHint" OWNER TO clawdbot;

--
-- Name: MemoryLayer; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."MemoryLayer" AS ENUM (
    'IDENTITY',
    'PROJECT',
    'SESSION',
    'TASK'
);


ALTER TYPE public."MemoryLayer" OWNER TO clawdbot;

--
-- Name: MemorySource; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."MemorySource" AS ENUM (
    'EXPLICIT_STATEMENT',
    'AGENT_OBSERVATION',
    'CORRECTION',
    'PATTERN_DETECTED',
    'SYSTEM',
    'AGENT_REFLECTION'
);


ALTER TYPE public."MemorySource" OWNER TO clawdbot;

--
-- Name: MemoryType; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."MemoryType" AS ENUM (
    'CONSTRAINT',
    'PREFERENCE',
    'FACT',
    'TASK',
    'EVENT',
    'LESSON'
);


ALTER TYPE public."MemoryType" OWNER TO clawdbot;

--
-- Name: SubjectType; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."SubjectType" AS ENUM (
    'USER',
    'AGENT',
    'ENTITY'
);


ALTER TYPE public."SubjectType" OWNER TO clawdbot;

--
-- Name: WebhookEvent; Type: TYPE; Schema: public; Owner: clawdbot
--

CREATE TYPE public."WebhookEvent" AS ENUM (
    'PROACTIVE_SURFACE',
    'CONTRADICTION_DETECTED',
    'PATTERN_DETECTED',
    'CONSOLIDATION_COMPLETE'
);


ALTER TYPE public."WebhookEvent" OWNER TO clawdbot;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO clawdbot;

--
-- Name: agents; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.agents (
    id text NOT NULL,
    name text NOT NULL,
    api_key_hash text NOT NULL,
    api_key_hint text NOT NULL,
    memories_limit integer,
    requests_per_day integer,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone
);


ALTER TABLE public.agents OWNER TO clawdbot;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    agent_id text NOT NULL,
    user_id text,
    action text NOT NULL,
    resource text NOT NULL,
    resource_id text,
    details jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO clawdbot;

--
-- Name: consolidation_jobs; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.consolidation_jobs (
    id text NOT NULL,
    user_id text NOT NULL,
    type public."ConsolidationType" NOT NULL,
    status public."ConsolidationStatus" DEFAULT 'PENDING'::public."ConsolidationStatus" NOT NULL,
    session_id text,
    start_date timestamp(3) without time zone,
    end_date timestamp(3) without time zone,
    memories_processed integer,
    patterns_detected integer,
    links_created integer,
    memories_merged integer,
    started_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.consolidation_jobs OWNER TO clawdbot;

--
-- Name: entities; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.entities (
    id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    normalized_name text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.entities OWNER TO clawdbot;

--
-- Name: feedback; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.feedback (
    id text NOT NULL,
    memory_id text NOT NULL,
    user_id text NOT NULL,
    was_used boolean DEFAULT false NOT NULL,
    was_helpful boolean,
    correction text,
    query_context text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.feedback OWNER TO clawdbot;

--
-- Name: memories; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.memories (
    id text NOT NULL,
    user_id text NOT NULL,
    project_id text,
    session_id text,
    raw text NOT NULL,
    layer public."MemoryLayer" NOT NULL,
    source public."MemorySource" DEFAULT 'EXPLICIT_STATEMENT'::public."MemorySource" NOT NULL,
    importance_hint public."ImportanceHint",
    importance_score double precision DEFAULT 0.5 NOT NULL,
    confidence double precision DEFAULT 1.0 NOT NULL,
    session_position integer,
    embedding_id text,
    embedding_model text,
    retrieval_count integer DEFAULT 0 NOT NULL,
    last_retrieved_at timestamp(3) without time zone,
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp(3) without time zone,
    consolidated boolean DEFAULT false NOT NULL,
    consolidated_at timestamp(3) without time zone,
    superseded_by_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone,
    subject_type public."SubjectType" DEFAULT 'USER'::public."SubjectType" NOT NULL,
    subject_id text,
    agent_id text,
    consolidated_into text,
    effective_score double precision DEFAULT 0.5 NOT NULL,
    embedding public.vector,
    memory_type public."MemoryType",
    priority integer DEFAULT 3 NOT NULL,
    promoted_from text,
    safety_critical boolean DEFAULT false NOT NULL,
    score_computed_at timestamp(3) without time zone,
    superseded_at timestamp(3) without time zone,
    type_confidence double precision,
    user_hidden boolean DEFAULT false NOT NULL,
    user_pinned boolean DEFAULT false NOT NULL
);


ALTER TABLE public.memories OWNER TO clawdbot;

--
-- Name: memory_chain_links; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.memory_chain_links (
    id text NOT NULL,
    source_id text NOT NULL,
    target_id text NOT NULL,
    link_type public."ChainLinkType" NOT NULL,
    confidence double precision DEFAULT 1.0 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.memory_chain_links OWNER TO clawdbot;

--
-- Name: memory_entities; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.memory_entities (
    id text NOT NULL,
    memory_id text NOT NULL,
    entity_id text NOT NULL
);


ALTER TABLE public.memory_entities OWNER TO clawdbot;

--
-- Name: memory_extractions; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.memory_extractions (
    id text NOT NULL,
    memory_id text NOT NULL,
    who text,
    what text,
    "when" timestamp(3) without time zone,
    where_ctx text,
    why text,
    how text,
    topics text[],
    raw_json jsonb,
    extracted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    model text,
    how_confidence double precision,
    memory_type public."MemoryType",
    type_confidence double precision,
    what_confidence double precision,
    when_confidence double precision,
    where_confidence double precision,
    who_confidence double precision,
    why_confidence double precision
);


ALTER TABLE public.memory_extractions OWNER TO clawdbot;

--
-- Name: projects; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.projects (
    id text NOT NULL,
    user_id text NOT NULL,
    external_id text,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone
);


ALTER TABLE public.projects OWNER TO clawdbot;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id text NOT NULL,
    project_id text,
    external_id text,
    started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp(3) without time zone,
    consolidated boolean DEFAULT false NOT NULL,
    consolidated_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO clawdbot;

--
-- Name: users; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.users (
    id text NOT NULL,
    external_id text NOT NULL,
    agent_id text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    deleted_at timestamp(3) without time zone
);


ALTER TABLE public.users OWNER TO clawdbot;

--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.webhook_deliveries (
    id text NOT NULL,
    webhook_id text NOT NULL,
    event public."WebhookEvent" NOT NULL,
    payload jsonb NOT NULL,
    status_code integer,
    response_ms integer,
    error text,
    attempt integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.webhook_deliveries OWNER TO clawdbot;

--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: clawdbot
--

CREATE TABLE public.webhooks (
    id text NOT NULL,
    agent_id text NOT NULL,
    url text NOT NULL,
    events public."WebhookEvent"[],
    secret text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_success timestamp(3) without time zone,
    last_failure timestamp(3) without time zone,
    failure_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.webhooks OWNER TO clawdbot;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
62a34669-29c3-4ab7-a7f5-78a863505785	83d2398cb6e1ecfa3416a1d157941d298e17b13c25effae5d5d30733fd5f7173	2026-02-05 10:25:16.451453-08	20260201150044_init	\N	\N	2026-02-05 10:25:16.416712-08	1
7bcb40f2-fbe9-4970-9490-e1b3772cec55	081466f0228dcdb2ba856b1fc2ef9a9e66b2013465030d068d63fdda10d68ba8	2026-02-05 10:25:16.452662-08	20260203_add_agent_reflection_source	\N	\N	2026-02-05 10:25:16.451753-08	1
d9c09300-cc32-4f69-b666-aeefd77a37be	f3271eaf1326acfb0d0b3dacd8a9c41095fa4e3e106ff6430708391d0803aede	2026-02-05 10:25:16.454262-08	20260203_add_agent_self_memories	\N	\N	2026-02-05 10:25:16.452891-08	1
e9cb53a4-105d-4809-a067-0f13a8278ead	ba1ef6dfd41370efe2f0bbd322859fbce43ee07b3120603a95acb2b9206c960e	2026-02-05 10:25:16.458133-08	20260205182423_add_lesson_memory_type	\N	\N	2026-02-05 10:25:16.454476-08	1
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.agents (id, name, api_key_hash, api_key_hint, memories_limit, requests_per_day, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.audit_logs (id, agent_id, user_id, action, resource, resource_id, details, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: consolidation_jobs; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.consolidation_jobs (id, user_id, type, status, session_id, start_date, end_date, memories_processed, patterns_detected, links_created, memories_merged, started_at, completed_at, error, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: entities; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.entities (id, user_id, name, type, normalized_name, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: feedback; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.feedback (id, memory_id, user_id, was_used, was_helpful, correction, query_context, created_at) FROM stdin;
\.


--
-- Data for Name: memories; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.memories (id, user_id, project_id, session_id, raw, layer, source, importance_hint, importance_score, confidence, session_position, embedding_id, embedding_model, retrieval_count, last_retrieved_at, used_count, last_used_at, consolidated, consolidated_at, superseded_by_id, created_at, updated_at, deleted_at, subject_type, subject_id, agent_id, consolidated_into, effective_score, embedding, memory_type, priority, promoted_from, safety_critical, score_computed_at, superseded_at, type_confidence, user_hidden, user_pinned) FROM stdin;
\.


--
-- Data for Name: memory_chain_links; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.memory_chain_links (id, source_id, target_id, link_type, confidence, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: memory_entities; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.memory_entities (id, memory_id, entity_id) FROM stdin;
\.


--
-- Data for Name: memory_extractions; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.memory_extractions (id, memory_id, who, what, "when", where_ctx, why, how, topics, raw_json, extracted_at, model, how_confidence, memory_type, type_confidence, what_confidence, when_confidence, where_confidence, who_confidence, why_confidence) FROM stdin;
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.projects (id, user_id, external_id, name, description, is_active, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.sessions (id, user_id, project_id, external_id, started_at, ended_at, consolidated, consolidated_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.users (id, external_id, agent_id, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: webhook_deliveries; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.webhook_deliveries (id, webhook_id, event, payload, status_code, response_ms, error, attempt, created_at) FROM stdin;
\.


--
-- Data for Name: webhooks; Type: TABLE DATA; Schema: public; Owner: clawdbot
--

COPY public.webhooks (id, agent_id, url, events, secret, is_active, last_success, last_failure, failure_count, created_at, updated_at) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: consolidation_jobs consolidation_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.consolidation_jobs
    ADD CONSTRAINT consolidation_jobs_pkey PRIMARY KEY (id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: memories memories_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_pkey PRIMARY KEY (id);


--
-- Name: memory_chain_links memory_chain_links_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_chain_links
    ADD CONSTRAINT memory_chain_links_pkey PRIMARY KEY (id);


--
-- Name: memory_entities memory_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_entities
    ADD CONSTRAINT memory_entities_pkey PRIMARY KEY (id);


--
-- Name: memory_extractions memory_extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_extractions
    ADD CONSTRAINT memory_extractions_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: agents_api_key_hash_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX agents_api_key_hash_key ON public.agents USING btree (api_key_hash);


--
-- Name: audit_logs_agent_id_created_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX audit_logs_agent_id_created_at_idx ON public.audit_logs USING btree (agent_id, created_at);


--
-- Name: audit_logs_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX audit_logs_user_id_created_at_idx ON public.audit_logs USING btree (user_id, created_at);


--
-- Name: consolidation_jobs_user_id_type_status_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX consolidation_jobs_user_id_type_status_idx ON public.consolidation_jobs USING btree (user_id, type, status);


--
-- Name: entities_user_id_normalized_name_type_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX entities_user_id_normalized_name_type_key ON public.entities USING btree (user_id, normalized_name, type);


--
-- Name: memories_deleted_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_deleted_at_idx ON public.memories USING btree (deleted_at);


--
-- Name: memories_embedding_id_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX memories_embedding_id_key ON public.memories USING btree (embedding_id);


--
-- Name: memories_embedding_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_embedding_idx ON public.memories USING btree (embedding);


--
-- Name: memories_project_id_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_project_id_idx ON public.memories USING btree (project_id);


--
-- Name: memories_session_id_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_session_id_idx ON public.memories USING btree (session_id);


--
-- Name: memories_subject_type_agent_id_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_subject_type_agent_id_idx ON public.memories USING btree (subject_type, agent_id);


--
-- Name: memories_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_user_id_created_at_idx ON public.memories USING btree (user_id, created_at);


--
-- Name: memories_user_id_effective_score_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_user_id_effective_score_idx ON public.memories USING btree (user_id, effective_score DESC);


--
-- Name: memories_user_id_layer_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_user_id_layer_idx ON public.memories USING btree (user_id, layer);


--
-- Name: memories_user_id_layer_priority_created_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_user_id_layer_priority_created_at_idx ON public.memories USING btree (user_id, layer, priority, created_at DESC);


--
-- Name: memories_user_id_memory_type_user_hidden_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX memories_user_id_memory_type_user_hidden_idx ON public.memories USING btree (user_id, memory_type, user_hidden);


--
-- Name: memory_chain_links_source_id_target_id_link_type_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX memory_chain_links_source_id_target_id_link_type_key ON public.memory_chain_links USING btree (source_id, target_id, link_type);


--
-- Name: memory_entities_memory_id_entity_id_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX memory_entities_memory_id_entity_id_key ON public.memory_entities USING btree (memory_id, entity_id);


--
-- Name: memory_extractions_memory_id_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX memory_extractions_memory_id_key ON public.memory_extractions USING btree (memory_id);


--
-- Name: projects_user_id_external_id_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX projects_user_id_external_id_key ON public.projects USING btree (user_id, external_id);


--
-- Name: users_agent_id_external_id_key; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE UNIQUE INDEX users_agent_id_external_id_key ON public.users USING btree (agent_id, external_id);


--
-- Name: webhook_deliveries_webhook_id_created_at_idx; Type: INDEX; Schema: public; Owner: clawdbot
--

CREATE INDEX webhook_deliveries_webhook_id_created_at_idx ON public.webhook_deliveries USING btree (webhook_id, created_at);


--
-- Name: feedback feedback_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memories memories_consolidated_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_consolidated_into_fkey FOREIGN KEY (consolidated_into) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: memories memories_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: memories memories_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: memories memories_superseded_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: memories memories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memories
    ADD CONSTRAINT memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_chain_links memory_chain_links_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_chain_links
    ADD CONSTRAINT memory_chain_links_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_chain_links memory_chain_links_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_chain_links
    ADD CONSTRAINT memory_chain_links_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_entities memory_entities_entity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_entities
    ADD CONSTRAINT memory_entities_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_entities memory_entities_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_entities
    ADD CONSTRAINT memory_entities_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_extractions memory_extractions_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.memory_extractions
    ADD CONSTRAINT memory_extractions_memory_id_fkey FOREIGN KEY (memory_id) REFERENCES public.memories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: projects projects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: webhooks webhooks_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: clawdbot
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: clawdbot
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict RlonvSSP2vtNNtqSNKa0uxSkRqe7XG2N0H3S86CIeOOkVAfPKc2iMOxsTOnxOUk

