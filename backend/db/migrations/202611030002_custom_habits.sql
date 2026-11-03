-- Custom habits: a family's own habits, kept beside the catalog so the daily loop, approvals, points and quest
-- stars work for them unchanged. family_id NULL marks the pre-approved catalog (db/seed.sql). Custom ids start
-- with "my-", so they never clash with a catalog id and code can tell them apart without a lookup.
-- Their text is the family's own: it is never sent to the AI provider (see onboarding.candidates).

ALTER TABLE hq.habits
  ADD COLUMN family_id uuid REFERENCES hq.families ON DELETE CASCADE,
  ADD COLUMN created_by uuid REFERENCES hq.users ON DELETE SET NULL,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT habits_custom_id CHECK ((family_id IS NULL) = (id NOT LIKE 'my-%'));
CREATE INDEX habits_family ON hq.habits(family_id) WHERE family_id IS NOT NULL;

-- The catalog stays readable by everyone; a family's own habits only by its caregivers and its kids.
ALTER TABLE hq.habits ENABLE ROW LEVEL SECURITY;
CREATE POLICY catalog_or_mine ON hq.habits FOR SELECT TO hq_api
  USING (family_id IS NULL OR family_id IN (SELECT hq.my_families()));
CREATE POLICY my_habits_add ON hq.habits FOR INSERT TO hq_api
  WITH CHECK (family_id IN (SELECT hq.my_families()));
CREATE POLICY my_habits_change ON hq.habits FOR UPDATE TO hq_api
  USING (family_id IN (SELECT hq.my_families())) WITH CHECK (family_id IN (SELECT hq.my_families()));
CREATE POLICY kid_catalog_or_family ON hq.habits FOR SELECT TO hq_kid
  USING (family_id IS NULL OR family_id IN (SELECT family_id FROM hq.children));
-- Caregivers write only the text of their own habits: never points, tier, ages or the owning family.
GRANT INSERT ON hq.habits TO hq_api;
GRANT UPDATE (goal_id, title, description, kid_title, kid_hint, icon, anchor, is_active) ON hq.habits TO hq_api;
