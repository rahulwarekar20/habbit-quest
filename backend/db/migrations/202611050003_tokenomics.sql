-- Additive accounting cutover: preserve the old conservative ledger, and never reset its balance.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='hq_admin') THEN CREATE ROLE hq_admin NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='hq_meter') THEN CREATE ROLE hq_meter NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA hq TO hq_admin,hq_meter;
DO $$ BEGIN
 IF NOT pg_has_role(current_user,'hq_admin','MEMBER') THEN GRANT hq_admin TO CURRENT_USER; END IF;
 IF NOT pg_has_role(current_user,'hq_meter','MEMBER') THEN GRANT hq_meter TO CURRENT_USER; END IF;
END $$;

CREATE TABLE hq.tokenomics_policy(
 revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 daily_credits integer NOT NULL CHECK(daily_credits BETWEEN 1 AND 1000000),
 enforce_budgets boolean NOT NULL DEFAULT false,
 show_costs boolean NOT NULL DEFAULT false,
 reference_usd_per_credit numeric(24,12) NOT NULL CHECK(reference_usd_per_credit>0),
 operator_cap_usd numeric(24,12) NOT NULL CHECK(operator_cap_usd>0),
 weights jsonb NOT NULL CHECK(jsonb_typeof(weights)='object'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO hq.tokenomics_policy(daily_credits,reference_usd_per_credit,operator_cap_usd,weights)
SELECT 100,.0015,coalesce((SELECT cap_usd FROM hq.planning_budget WHERE singleton),5),
 '{"coach":2,"habit_batch":1,"planner":2,"review":2,"onboarding":2,"buddy":0,"child_screen":0}'::jsonb;

CREATE TABLE hq.tokenomics_policy_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL, action text NOT NULL, revision bigint,
 changes jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hq.ai_price_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider text NOT NULL, model text NOT NULL, kind text NOT NULL CHECK(kind IN('chat','embedding','search')),
 api_mode text NOT NULL DEFAULT '', region text NOT NULL DEFAULT '',
 service_tier text NOT NULL DEFAULT 'standard', context_band text NOT NULL DEFAULT 'short',
 input_rate numeric(24,12), cached_input_rate numeric(24,12), cache_write_rate numeric(24,12),
 output_rate numeric(24,12), read_unit_rate numeric(24,12), egress_rate numeric(24,12),
 read_units_bound numeric(24,12), egress_bytes_bound bigint,
 source_url text NOT NULL, verified_at date, effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL CHECK(status IN('verified','manual','planning')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO hq.ai_price_versions(provider,model,kind,input_rate,cached_input_rate,output_rate,source_url,verified_at,status)
VALUES('OpenAI','gpt-6-luna','chat',.1,.01,.5,'https://developers.openai.com/api/docs/models/gpt-6-luna','2026-11-05','verified'),
('Nebius','deepseek-ai/DeepSeek-V4.1-Flash-1017','chat',.3,.006,1.2,'https://tokenfactory.nebius.com/api/public/models_info','2026-11-05','verified');
INSERT INTO hq.ai_price_versions(provider,model,kind,input_rate,source_url,verified_at,status)
VALUES('OpenAI','text-embedding-3-small','embedding',.02,'https://developers.openai.com/api/docs/models/text-embedding-3-small','2026-11-05','verified');
INSERT INTO hq.ai_price_versions(provider,model,kind,read_unit_rate,egress_rate,source_url,verified_at,status)
VALUES('Pinecone','documents-search','search',18,.10,'https://www.pinecone.io/pricing/','2026-11-05','planning');

CREATE TABLE hq.tokenomics_exposure(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 legacy_carryover_usd numeric(24,12) NOT NULL CHECK(legacy_carryover_usd>=0),
 legacy_initialized boolean NOT NULL, cutover_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO hq.tokenomics_exposure(singleton,legacy_carryover_usd,legacy_initialized)
SELECT true,coalesce(accounted_usd,0),coalesce(initialized,false) FROM hq.planning_budget WHERE singleton;
INSERT INTO hq.tokenomics_exposure(singleton,legacy_carryover_usd,legacy_initialized)
VALUES(true,0,false) ON CONFLICT DO NOTHING;

CREATE TABLE hq.family_ai_windows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES hq.families ON DELETE CASCADE,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL,
 CHECK(ends_at>starts_at), UNIQUE(family_id,starts_at)
);
CREATE INDEX family_ai_window_current ON hq.family_ai_windows(family_id,ends_at DESC);
CREATE TABLE hq.ai_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid REFERENCES hq.families ON DELETE SET NULL,
 child_id uuid REFERENCES hq.children ON DELETE SET NULL, actor_id uuid REFERENCES hq.users ON DELETE SET NULL,
 activity text NOT NULL, request_key text NOT NULL, fingerprint text NOT NULL,
 parent_operation_id uuid REFERENCES hq.ai_operations ON DELETE CASCADE, goal_id text,
 budget_window_id uuid REFERENCES hq.family_ai_windows ON DELETE SET NULL,
 policy_snapshot jsonb NOT NULL, price_snapshot jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('slot','reserved','running','completed','failed','cancelled')),
 quoted_credits integer NOT NULL CHECK(quoted_credits>=0), credits integer NOT NULL DEFAULT 0 CHECK(credits>=0),
 pending_credits integer NOT NULL DEFAULT 0 CHECK(pending_credits>=0),
 reserve_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK(reserve_usd>=0),
 estimated_cost_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK(estimated_cost_usd>=0),
 exposure_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK(exposure_usd>=0),
 cost_status text NOT NULL DEFAULT 'pending', result_ref jsonb NOT NULL DEFAULT '{}',
 timings jsonb NOT NULL DEFAULT '{}', browser_observation jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 UNIQUE(family_id,activity,request_key)
);
CREATE INDEX ai_operations_window ON hq.ai_operations(budget_window_id);
CREATE UNIQUE INDEX ai_bound_goal_slot ON hq.ai_operations(parent_operation_id,goal_id) WHERE parent_operation_id IS NOT NULL;
CREATE TABLE hq.ai_provider_attempts(
 id uuid PRIMARY KEY, operation_id uuid NOT NULL REFERENCES hq.ai_operations ON DELETE CASCADE,
 invocation_id uuid NOT NULL, role text NOT NULL, provider text NOT NULL, model text NOT NULL,
 returned_model text, api_mode text NOT NULL DEFAULT '', region text NOT NULL DEFAULT '',
 service_tier text NOT NULL DEFAULT 'standard', context_band text NOT NULL DEFAULT 'short',
 status text NOT NULL CHECK(status IN('dispatched','completed','failed')),
 usage jsonb NOT NULL DEFAULT '{}', price_snapshot jsonb,
 duration_ms numeric, error_code text, request_id text,
 reserved_usd numeric(24,12) NOT NULL DEFAULT 0 CHECK(reserved_usd>=0),
 estimated_cost_usd numeric(24,12), exposure_usd numeric(24,12) NOT NULL DEFAULT 0,
 cost_status text NOT NULL DEFAULT 'unknown',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz
);
CREATE INDEX ai_provider_attempts_operation ON hq.ai_provider_attempts(operation_id);

-- Only internal metering can mutate operation records; admin has no family content grants.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tokenomics_policy','tokenomics_policy_audit','ai_price_versions','tokenomics_exposure',
 'family_ai_windows','ai_operations','ai_provider_attempts'] LOOP
  EXECUTE format('ALTER TABLE hq.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY meter_internal ON hq.%I TO hq_meter USING(true) WITH CHECK(true)',t);
  EXECUTE format('CREATE POLICY admin_tokenomics ON hq.%I TO hq_admin USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON hq.family_ai_windows,hq.ai_operations,hq.ai_provider_attempts TO hq_meter;
GRANT SELECT,UPDATE ON hq.tokenomics_exposure TO hq_meter;
GRANT SELECT ON hq.tokenomics_policy,hq.ai_price_versions TO hq_meter;
GRANT SELECT,INSERT ON hq.tokenomics_policy,hq.tokenomics_policy_audit,hq.ai_price_versions TO hq_admin;
GRANT SELECT,UPDATE ON hq.tokenomics_exposure TO hq_admin;
GRANT SELECT ON hq.family_ai_windows,hq.ai_provider_attempts TO hq_admin;
GRANT SELECT(id,family_id,child_id,activity,parent_operation_id,goal_id,budget_window_id,policy_snapshot,
 status,quoted_credits,credits,pending_credits,reserve_usd,estimated_cost_usd,exposure_usd,cost_status,
 timings,created_at,finished_at) ON hq.ai_operations TO hq_admin;
GRANT USAGE ON SEQUENCE hq.tokenomics_policy_revision_seq,hq.tokenomics_policy_audit_id_seq TO hq_admin;

-- Narrow security-definer scope lookup; cannot reveal family/child names or content.
CREATE FUNCTION hq.tokenomics_scope(wanted_family uuid,wanted_child uuid,actor uuid,kid uuid)
RETURNS TABLE(timezone text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT f.timezone FROM hq.families f WHERE f.id=wanted_family
 AND (wanted_child IS NULL OR EXISTS(SELECT FROM hq.children c WHERE c.id=wanted_child AND c.family_id=f.id))
 AND ((actor IS NOT NULL AND kid IS NULL AND EXISTS(SELECT FROM hq.caregivers cg WHERE cg.family_id=f.id AND cg.user_id=actor))
 OR (actor IS NULL AND kid IS NOT NULL AND kid=wanted_child AND EXISTS(SELECT FROM hq.children c WHERE c.id=kid AND c.family_id=f.id)))
$$;
REVOKE ALL ON FUNCTION hq.tokenomics_scope(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.tokenomics_scope(uuid,uuid,uuid,uuid) TO hq_meter;
REVOKE EXECUTE ON FUNCTION hq.set_planning_budget_cap(numeric),hq.planning_budget_view(numeric) FROM hq_api;
