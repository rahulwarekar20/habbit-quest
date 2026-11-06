-- Preserve all prior reservations. Only a provisioned app owner can change the shared cap.
ALTER TABLE hq.planning_budget ADD COLUMN cap_usd numeric CHECK(cap_usd>0 AND cap_usd<=100);
ALTER TABLE hq.planning_budget ADD COLUMN owner_user_id uuid REFERENCES hq.users ON DELETE SET NULL;

CREATE FUNCTION hq.planning_budget_view(fallback_cap numeric) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('cap_usd',coalesce(cap_usd,fallback_cap),'accounted_usd',accounted_usd,
 'initialized',initialized,'can_edit',coalesce(owner_user_id=hq.my_user(),false))
 FROM hq.planning_budget WHERE singleton AND hq.my_user() IS NOT NULL $$;
REVOKE ALL ON FUNCTION hq.planning_budget_view(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.planning_budget_view(numeric) TO hq_api;

CREATE FUNCTION hq.set_planning_budget_cap(wanted numeric) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DECLARE state hq.planning_budget;
 BEGIN
 SELECT * INTO state FROM hq.planning_budget WHERE singleton FOR UPDATE;
 IF hq.my_user() IS NULL OR state.owner_user_id IS DISTINCT FROM hq.my_user()
 OR wanted IS NULL OR wanted<=0 OR wanted>100 OR wanted<state.accounted_usd THEN RETURN false; END IF;
 UPDATE hq.planning_budget SET cap_usd=wanted WHERE singleton;
 RETURN true;
 END $$;
REVOKE ALL ON FUNCTION hq.set_planning_budget_cap(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hq.set_planning_budget_cap(numeric) TO hq_api;

CREATE OR REPLACE FUNCTION hq.reserve_planning_budget(wanted uuid, amount numeric, cap numeric) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DECLARE state hq.planning_budget; prior hq.planning_reservations;
 BEGIN
 IF hq.my_user() IS NULL OR amount<=0 OR cap<=0 OR cap>100 THEN RETURN false; END IF;
 SELECT * INTO state FROM hq.planning_budget WHERE singleton FOR UPDATE;
 SELECT * INTO prior FROM hq.planning_reservations WHERE request_id=wanted;
 IF FOUND THEN RETURN prior.user_id=hq.my_user() AND prior.amount_usd=amount; END IF;
 IF NOT state.initialized OR state.accounted_usd+amount>coalesce(state.cap_usd,cap) THEN RETURN false; END IF;
 INSERT INTO hq.planning_reservations(request_id,user_id,amount_usd) VALUES(wanted,hq.my_user(),amount);
 UPDATE hq.planning_budget SET accounted_usd=accounted_usd+amount WHERE singleton;
 RETURN true;
 END $$;
