-- A content-free operator projection: result counts are useful for comparable workload cohorts.
CREATE VIEW hq.ai_operation_metrics AS
SELECT id,family_id,child_id,activity,parent_operation_id,status,credits,pending_credits,
 estimated_cost_usd,exposure_usd,cost_status,timings,created_at,finished_at,
 CASE WHEN jsonb_typeof(result_ref->'result_count')='number' THEN (result_ref->>'result_count')::integer
      WHEN jsonb_typeof(result_ref->'goal_ids')='array' THEN jsonb_array_length(result_ref->'goal_ids')
      ELSE NULL END AS result_count
FROM hq.ai_operations;
REVOKE ALL ON hq.ai_operation_metrics FROM PUBLIC;
GRANT SELECT ON hq.ai_operation_metrics TO hq_admin;
