-- Preserve the Coach's reviewed goal ranking independently of UUIDs and lock order.
-- Older cards have no recorded rank; their existing created_at/id order remains the fallback.
ALTER TABLE hq.coach_goal_suggestions
  ADD COLUMN selection_order smallint NOT NULL DEFAULT 0 CHECK (selection_order >= 0);
