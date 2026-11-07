-- Shared source provenance, created only by the explicit owner-run catalog importer.
-- Existing legacy goals and their habits remain intact. One canonical age-variant card
-- maps to one short goal ID; generated actions become separate family habits.
CREATE TABLE hq.catalog_goal_sources (
  goal_id text PRIMARY KEY REFERENCES hq.goals(id),
  source_id text NOT NULL UNIQUE,
  concept_id text NOT NULL,
  category_id text NOT NULL,
  catalog_version text NOT NULL,
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_id text NOT NULL CHECK (snapshot_id ~ '^[a-f0-9]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_goal_sources_concept ON hq.catalog_goal_sources(concept_id);
-- This is public catalog metadata, not family data. Neither runtime role can mutate it.
GRANT SELECT ON hq.catalog_goal_sources TO hq_api,hq_kid;
REVOKE INSERT,UPDATE,DELETE ON hq.catalog_goal_sources FROM hq_api,hq_kid;
