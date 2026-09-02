-- SLA breach sweep.
--
-- Why this is a stored procedure rather than application code:
-- the sweep is a set based problem. It must compare every open request against the SLA policy
-- of the state it currently sits in, decide which ones crossed a threshold since the last run,
-- and record the result. Doing that in C# means loading every open request into memory,
-- evaluating it row by row, and writing back one by one. In SQL it is a single pass that the
-- planner can index, and it stays correct as the request volume grows.
--
-- It is also idempotent. Running it twice in the same minute must not raise the same breach
-- twice, because the scheduler may overlap or be retried. The sla_events table carries a
-- unique constraint on (service_request_id, state_code, entered_state_at, level) and the
-- insert uses ON CONFLICT DO NOTHING, so a second run in the same window is a no-op.

CREATE TABLE IF NOT EXISTS sla_events (
    id                  uuid PRIMARY KEY,
    service_request_id  uuid        NOT NULL,
    state_code          varchar(64) NOT NULL,
    entered_state_at    timestamptz NOT NULL,
    due_at              timestamptz NOT NULL,
    level               smallint    NOT NULL,   -- 1 = at risk, 2 = breached
    escalate_to_role    varchar(64),
    detected_at         timestamptz NOT NULL,
    CONSTRAINT ux_sla_events_unique_per_threshold
        UNIQUE (service_request_id, state_code, entered_state_at, level)
);

CREATE INDEX IF NOT EXISTS ix_sla_events_request ON sla_events (service_request_id);
CREATE INDEX IF NOT EXISTS ix_sla_events_detected_at ON sla_events (detected_at DESC);

-- Supports the sweep's driving scan: only open requests, ordered by how long they have been
-- sitting in their current state.
CREATE INDEX IF NOT EXISTS ix_service_requests_open_by_state_entry
    ON service_requests (current_state_entered_at)
    WHERE closed_at IS NULL;

CREATE OR REPLACE FUNCTION fn_sweep_sla(p_now timestamptz DEFAULT now())
RETURNS TABLE (
    at_risk_raised  integer,
    breaches_raised integer
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_at_risk  integer := 0;
    v_breached integer := 0;
BEGIN
    -- One CTE resolves each open request to the SLA policy of its current state, using the
    -- workflow definition version the request was pinned to at submission. Requests whose
    -- current state has no SLA (typically states where we are waiting on the applicant, not
    -- on the government) drop out here and are never considered breached.
    WITH open_requests AS (
        SELECT
            r.id                        AS service_request_id,
            r.current_state_code        AS state_code,
            r.current_state_entered_at  AS entered_state_at,
            s.sla_target                AS sla_target,
            s.sla_warn_after            AS sla_warn_after,
            s.sla_escalate_to_role      AS escalate_to_role
        FROM service_requests r
        JOIN workflow_states s
          ON s.workflow_definition_id = r.workflow_definition_id
         AND s.code = r.current_state_code
        WHERE r.closed_at IS NULL
          AND s.sla_target IS NOT NULL
    ),
    evaluated AS (
        SELECT
            o.*,
            o.entered_state_at + o.sla_target     AS due_at,
            (p_now - o.entered_state_at)          AS elapsed
        FROM open_requests o
    ),
    breached AS (
        INSERT INTO sla_events (
            id, service_request_id, state_code, entered_state_at,
            due_at, level, escalate_to_role, detected_at
        )
        SELECT
            gen_random_uuid(), e.service_request_id, e.state_code, e.entered_state_at,
            e.due_at, 2, e.escalate_to_role, p_now
        FROM evaluated e
        WHERE e.elapsed >= e.sla_target
        ON CONFLICT ON CONSTRAINT ux_sla_events_unique_per_threshold DO NOTHING
        RETURNING 1
    ),
    at_risk AS (
        INSERT INTO sla_events (
            id, service_request_id, state_code, entered_state_at,
            due_at, level, escalate_to_role, detected_at
        )
        SELECT
            gen_random_uuid(), e.service_request_id, e.state_code, e.entered_state_at,
            e.due_at, 1, e.escalate_to_role, p_now
        FROM evaluated e
        WHERE e.elapsed >= e.sla_warn_after
          AND e.elapsed <  e.sla_target
        ON CONFLICT ON CONSTRAINT ux_sla_events_unique_per_threshold DO NOTHING
        RETURNING 1
    )
    SELECT
        (SELECT count(*) FROM at_risk),
        (SELECT count(*) FROM breached)
    INTO v_at_risk, v_breached;

    RETURN QUERY SELECT v_at_risk, v_breached;
END;
$$;

COMMENT ON FUNCTION fn_sweep_sla(timestamptz) IS
    'Idempotent SLA sweep. Raises at-risk and breach events for open requests whose current '
    'state defines an SLA. Safe to run repeatedly; duplicate thresholds are ignored.';
