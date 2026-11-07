-- Parent-requested drafts are private, child-bound, expiring and separate from the plan.
CREATE TABLE hq.habit_draft_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 child_id uuid NOT NULL REFERENCES hq.children ON DELETE CASCADE,
 goal_id text NOT NULL REFERENCES hq.goals,
 request_id uuid NOT NULL,
 input_digest text NOT NULL,
 reset_id bigint NOT NULL DEFAULT 0,
 child_age integer NOT NULL CHECK(child_age BETWEEN 3 AND 13),
 setting text NOT NULL CHECK(setting IN ('home','school','community','outdoors','online')),
 source jsonb NOT NULL,
 status text NOT NULL DEFAULT 'generating' CHECK(status IN ('generating','ready','unavailable','risk_redirect','cancelled')),
 outcome text NOT NULL DEFAULT 'processing',
 message text NOT NULL DEFAULT 'Generating and checking these habits.',
 items jsonb NOT NULL DEFAULT '[]',
 metrics jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(child_id,request_id)
);
ALTER TABLE hq.habit_draft_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_children ON hq.habit_draft_batches TO hq_api
 USING(child_id IN (SELECT id FROM hq.children));
GRANT SELECT,INSERT,UPDATE,DELETE ON hq.habit_draft_batches TO hq_api;

CREATE TABLE hq.generated_habit_details (
 habit_id text PRIMARY KEY REFERENCES hq.habits ON DELETE CASCADE,
 child_id uuid NOT NULL REFERENCES hq.children ON DELETE CASCADE,
 goal_id text NOT NULL REFERENCES hq.goals,
 batch_id uuid NOT NULL REFERENCES hq.habit_draft_batches ON DELETE CASCADE,
 draft_id uuid NOT NULL,
 source jsonb NOT NULL,
 draft jsonb NOT NULL,
 content_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,draft_id)
);
ALTER TABLE hq.generated_habit_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_children ON hq.generated_habit_details TO hq_api
 USING(child_id IN (SELECT id FROM hq.children));
GRANT SELECT,INSERT,DELETE ON hq.generated_habit_details TO hq_api;
-- Kids receive only the reviewed projection from an explicit function, never parent guidance.
CREATE FUNCTION hq.kid_generated_detail(wanted text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('habit_id',d.habit_id,'goal_id',d.goal_id,'title',d.draft->'kid_title',
 'instruction',d.draft->'instruction','steps',d.draft->'steps','materials',d.draft->'materials',
 'help_text',d.draft->'help_text','cue',d.draft->'cue','completion',d.draft->'completion')
 FROM hq.generated_habit_details d WHERE d.habit_id=wanted AND d.child_id=hq.my_kid()
 AND EXISTS(SELECT 1 FROM hq.child_habits ch WHERE ch.child_id=d.child_id
 AND ch.habit_id=d.habit_id AND ch.status<>'removed') $$;
REVOKE ALL ON FUNCTION hq.kid_generated_detail(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.kid_generated_detail(text) TO hq_kid;

-- Existing custom-habit/plan routes cannot rewrite reviewed content or assign it to a sibling.
CREATE FUNCTION hq.protect_generated_habit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='habits' THEN
   IF EXISTS(SELECT 1 FROM hq.generated_habit_details WHERE habit_id=OLD.id)
      AND (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
     RAISE EXCEPTION 'Generated habits require a new reviewed draft' USING ERRCODE='23514';
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM hq.generated_habit_details WHERE habit_id=NEW.habit_id AND child_id<>NEW.child_id) THEN
     RAISE EXCEPTION 'Generated habit belongs to another child' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
 END $$;
REVOKE ALL ON FUNCTION hq.protect_generated_habit() FROM PUBLIC;
CREATE TRIGGER generated_habit_immutable BEFORE UPDATE ON hq.habits
 FOR EACH ROW EXECUTE FUNCTION hq.protect_generated_habit();
CREATE TRIGGER generated_habit_child BEFORE INSERT OR UPDATE ON hq.child_habits
 FOR EACH ROW EXECUTE FUNCTION hq.protect_generated_habit();

-- A global prototype cap carries usage forward. Initialization is an explicit owner operation;
-- migration creates no fresh allowance. Reservations remain charged after uncertain failures.
CREATE TABLE hq.planning_budget (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 initialized boolean NOT NULL DEFAULT false,
 accounted_usd numeric NOT NULL DEFAULT 0 CHECK(accounted_usd>=0)
);
INSERT INTO hq.planning_budget(singleton) VALUES(true);
CREATE TABLE hq.planning_reservations (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES hq.users ON DELETE CASCADE,
 amount_usd numeric NOT NULL CHECK(amount_usd>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hq.planning_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE hq.planning_reservations ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION hq.reserve_planning_budget(wanted uuid, amount numeric, cap numeric) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DECLARE state hq.planning_budget; prior hq.planning_reservations;
 BEGIN
 IF hq.my_user() IS NULL OR amount<=0 OR cap<=0 OR cap>100 THEN RETURN false; END IF;
 SELECT * INTO state FROM hq.planning_budget WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM hq.planning_reservations WHERE request_id=wanted;
 IF FOUND THEN RETURN prior.user_id=hq.my_user() AND prior.amount_usd=amount; END IF;
 IF NOT state.initialized OR state.accounted_usd+amount>cap THEN RETURN false; END IF;
 INSERT INTO hq.planning_reservations(request_id,user_id,amount_usd) VALUES(wanted,hq.my_user(),amount);
 UPDATE hq.planning_budget SET accounted_usd=accounted_usd+amount WHERE singleton;
 RETURN true;
 END $$;
REVOKE ALL ON FUNCTION hq.reserve_planning_budget(uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.reserve_planning_budget(uuid,numeric,numeric) TO hq_api;
