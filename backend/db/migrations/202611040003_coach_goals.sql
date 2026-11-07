-- Source cards are goals; these reviewed suggestions never create placeholder habits.
-- The conversation owns their lifetime, including reset and the retention sweep.
ALTER TABLE hq.coach_messages ADD CONSTRAINT coach_messages_id_child UNIQUE (id,child_id);
CREATE TABLE hq.coach_goal_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES hq.children ON DELETE CASCADE,
  coach_message_id bigint NOT NULL,
  goal_id text NOT NULL REFERENCES hq.catalog_goal_sources(goal_id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 6000),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 400),
  source_ref jsonb NOT NULL CHECK (jsonb_typeof(source_ref)='object'),
  setting text NOT NULL CHECK (setting IN ('home','school','community','outdoors','online')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  FOREIGN KEY (coach_message_id,child_id) REFERENCES hq.coach_messages(id,child_id) ON DELETE CASCADE,
  CHECK ((status='pending')=(decided_at IS NULL))
);
CREATE INDEX coach_goal_suggestions_child ON hq.coach_goal_suggestions(child_id,created_at);
CREATE UNIQUE INDEX coach_goal_suggestions_pending ON hq.coach_goal_suggestions(child_id,goal_id) WHERE status='pending';
ALTER TABLE hq.coach_goal_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY my_children ON hq.coach_goal_suggestions TO hq_api
  USING (child_id IN (SELECT id FROM hq.children));
GRANT SELECT,INSERT,UPDATE,DELETE ON hq.coach_goal_suggestions TO hq_api;
