-- A missing ledger must fail closed, never imply a fresh allowance.
CREATE OR REPLACE FUNCTION hq.reserve_planning_budget(wanted uuid, amount numeric, cap numeric) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DECLARE state hq.planning_budget; prior hq.planning_reservations;
 BEGIN
 IF hq.my_user() IS NULL OR amount<=0 OR cap<=0 OR cap>100 THEN RETURN false; END IF;
 SELECT * INTO state FROM hq.planning_budget WHERE singleton FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO prior FROM hq.planning_reservations WHERE request_id=wanted;
 IF FOUND THEN RETURN prior.user_id=hq.my_user() AND prior.amount_usd=amount; END IF;
 IF NOT state.initialized OR state.accounted_usd+amount>coalesce(state.cap_usd,cap) THEN RETURN false; END IF;
 INSERT INTO hq.planning_reservations(request_id,user_id,amount_usd) VALUES(wanted,hq.my_user(),amount);
 UPDATE hq.planning_budget SET accounted_usd=accounted_usd+amount WHERE singleton;
 RETURN true;
 END $$;
