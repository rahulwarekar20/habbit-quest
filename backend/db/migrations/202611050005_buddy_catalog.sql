-- Additive buddy identity: existing choices retain legacy mode at revision zero.
-- Reference seed projected from canonical buddies.json, SHA256: 8dc11b07787057de85b5676e4146d5edf60fc74282dfc72ad543ed268b6fdc17
CREATE TABLE hq.buddy_catalog (
  id text NOT NULL,
  catalog_version text NOT NULL,
  supported_age_min int NOT NULL CHECK (supported_age_min BETWEEN 3 AND 13),
  supported_age_max int NOT NULL CHECK (supported_age_max BETWEEN supported_age_min AND 13),
  available boolean NOT NULL,
  PRIMARY KEY (id,catalog_version)
);
ALTER TABLE hq.buddy_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_reference ON hq.buddy_catalog FOR SELECT TO hq_api,hq_kid USING (true);
GRANT SELECT ON hq.buddy_catalog TO hq_api,hq_kid;
INSERT INTO hq.buddy_catalog(id,catalog_version,supported_age_min,supported_age_max,available) VALUES
  ('cove-seal','0.1.0',3,13,true),
  ('dot-bot','0.1.0',3,13,true),
  ('echo-raven','0.1.0',3,13,true),
  ('ember-fox','0.1.0',3,13,true),
  ('fern-moth','0.1.0',3,13,true),
  ('flux-rover','0.1.0',3,13,true),
  ('juniper-panda','0.1.0',3,13,true),
  ('kiki-dragon','0.1.0',3,13,true),
  ('koa-capybara','0.1.0',3,13,true),
  ('lumi-firefly','0.1.0',3,13,true),
  ('momo-cloud','0.1.0',3,13,true),
  ('moss-grove','0.1.0',3,13,true),
  ('nori-bunny','0.1.0',3,13,true),
  ('nova-fox','0.1.0',3,13,true),
  ('orbit-axolotl','0.1.0',3,13,true),
  ('otto-otter','0.1.0',3,13,true),
  ('pebble-bot','0.1.0',3,13,true),
  ('pip-owl','0.1.0',3,13,true),
  ('pippin-bear','0.1.0',3,13,true),
  ('pixel-bot','0.1.0',3,13,true),
  ('ripple-ray','0.1.0',3,13,true),
  ('scout-lynx','0.1.0',3,13,true),
  ('sprig-leaf','0.1.0',3,13,true),
  ('tilly-turtle','0.1.0',3,13,true);

ALTER TABLE hq.children
  ADD COLUMN buddy_selection_mode text NOT NULL DEFAULT 'legacy',
  ADD COLUMN catalog_buddy_id text,
  ADD COLUMN buddy_catalog_version text,
  ADD COLUMN buddy_selection_revision int NOT NULL DEFAULT 0 CHECK (buddy_selection_revision >= 0),
  ADD CONSTRAINT children_buddy_selection_check CHECK (
    (buddy_selection_mode='legacy' AND catalog_buddy_id IS NULL AND buddy_catalog_version IS NULL)
    OR (buddy_selection_mode='catalog' AND catalog_buddy_id IS NOT NULL AND buddy_catalog_version IS NOT NULL
        AND buddy_selection_revision > 0)
  ),
  ADD CONSTRAINT children_catalog_buddy_fkey FOREIGN KEY (catalog_buddy_id,buddy_catalog_version)
    REFERENCES hq.buddy_catalog(id,catalog_version);

-- Enforce the final merged age/selection even on direct caregiver SQL writes.
CREATE FUNCTION hq.validate_child_buddy() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.buddy_selection_mode='catalog' AND NOT EXISTS (
    SELECT FROM hq.buddy_catalog b WHERE b.id=NEW.catalog_buddy_id
      AND b.catalog_version=NEW.buddy_catalog_version AND b.available
      AND NEW.age BETWEEN b.supported_age_min AND b.supported_age_max
  ) THEN
    RAISE EXCEPTION 'Buddy reference is unavailable for this age/version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_child_buddy BEFORE INSERT OR UPDATE OF age,buddy_selection_mode,catalog_buddy_id,buddy_catalog_version
  ON hq.children FOR EACH ROW EXECUTE FUNCTION hq.validate_child_buddy();

-- Old clients may change only an untouched legacy choice. The row lock serializes
-- this path with the revisioned function and caregiver profile updates.
CREATE OR REPLACE FUNCTION hq.kid_set_buddy(p_buddy text) RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE child hq.children%ROWTYPE;
BEGIN
  SELECT * INTO child FROM hq.children WHERE id=hq.my_kid() FOR UPDATE;
  IF child.buddy_selection_revision=0 AND child.buddy_selection_mode='legacy' THEN
    UPDATE hq.children SET buddy=p_buddy WHERE id=child.id;
  END IF;
END $$;

-- A kid may change only its session-derived identity, never another child's profile.
CREATE FUNCTION hq.kid_set_buddy_selection(
  p_mode text,p_buddy text,p_catalog_id text,p_catalog_version text,p_expected_revision int
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE child hq.children%ROWTYPE;
BEGIN
  SELECT * INTO child FROM hq.children WHERE id=hq.my_kid() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF p_expected_revision IS NULL OR child.buddy_selection_revision<>p_expected_revision THEN
    RETURN 'conflict';
  END IF;
  IF p_mode='legacy' THEN
    IF p_buddy IS NULL OR p_buddy NOT IN ('fox','owl','bear','bunny')
      OR p_catalog_id IS NOT NULL OR p_catalog_version IS NOT NULL THEN RETURN 'invalid'; END IF;
  ELSIF p_mode='catalog' THEN
    IF p_buddy IS NOT NULL OR NOT EXISTS (
      SELECT FROM hq.buddy_catalog b WHERE b.id=p_catalog_id AND b.catalog_version=p_catalog_version
        AND b.available AND child.age BETWEEN b.supported_age_min AND b.supported_age_max
    ) THEN RETURN 'invalid'; END IF;
  ELSE RETURN 'invalid';
  END IF;
  UPDATE hq.children SET buddy=coalesce(p_buddy,buddy),buddy_selection_mode=p_mode,
    catalog_buddy_id=p_catalog_id,buddy_catalog_version=p_catalog_version,
    buddy_selection_revision=buddy_selection_revision+1 WHERE id=child.id;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION hq.kid_set_buddy_selection(text,text,text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.kid_set_buddy_selection(text,text,text,text,int) TO hq_kid;

-- Extend the existing code-scoped public avatar projection; no private preferences.
DROP FUNCTION hq.login_family(text);
CREATE FUNCTION hq.login_family(p_code text)
  RETURNS TABLE (family_id uuid,family_name text,child_id uuid,child_name text,buddy text,has_pin boolean,
    buddy_selection_mode text,catalog_buddy_id text,buddy_catalog_version text,buddy_selection_revision int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT f.id,f.name,c.id,c.name,c.buddy,c.kid_pin_hash IS NOT NULL,
    c.buddy_selection_mode,c.catalog_buddy_id,c.buddy_catalog_version,c.buddy_selection_revision
  FROM hq.families f LEFT JOIN hq.children c ON c.family_id=f.id
  WHERE f.login_code=p_code ORDER BY c.created_at,c.id
$$;
REVOKE ALL ON FUNCTION hq.login_family(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.login_family(text) TO hq_api;
