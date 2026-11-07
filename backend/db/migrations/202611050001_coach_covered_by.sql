-- The titles of quests already in the child's plan that suit a reply's problem, when the reply offered no new
-- quest because of them, so the app can say "already has the quests for this" instead of "no approved habit".
ALTER TABLE hq.coach_messages ADD COLUMN covered_by text[] NOT NULL DEFAULT '{}';
