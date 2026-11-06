-- A generated habit remains child-bound even when draft/detail cascades run.
-- Deleting the owner deletes the generated habit; it cannot become an ordinary
-- family custom habit after losing its review/provenance row.
ALTER TABLE hq.habits ADD COLUMN generated_child_id uuid REFERENCES hq.children(id) ON DELETE CASCADE;
ALTER TABLE hq.habits DISABLE TRIGGER generated_habit_immutable;
UPDATE hq.habits h SET generated_child_id=d.child_id FROM hq.generated_habit_details d WHERE d.habit_id=h.id;
ALTER TABLE hq.habits ENABLE TRIGGER generated_habit_immutable;
ALTER TABLE hq.habits ADD CONSTRAINT generated_habit_has_owner
 CHECK ((id LIKE 'my-ai-%') = (generated_child_id IS NOT NULL));
CREATE INDEX habits_generated_child ON hq.habits(generated_child_id) WHERE generated_child_id IS NOT NULL;
-- Ownership does not depend on a draft/detail row existing.
CREATE OR REPLACE FUNCTION hq.protect_generated_habit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 IF TG_TABLE_NAME='habits' THEN
   IF OLD.generated_child_id IS NOT NULL
      AND (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
     RAISE EXCEPTION 'Generated habits require a new reviewed draft' USING ERRCODE='23514';
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM hq.habits WHERE id=NEW.habit_id AND generated_child_id IS NOT NULL AND generated_child_id<>NEW.child_id) THEN
     RAISE EXCEPTION 'Generated habit belongs to another child' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
 END $$;
