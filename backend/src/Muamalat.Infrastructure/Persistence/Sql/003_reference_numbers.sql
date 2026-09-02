-- Reference numbers shown to citizens, e.g. MW-2026-000123.
--
-- Generated from a database sequence rather than from MAX(reference_number) + 1 or a
-- application-side counter. Two citizens submitting at the same instant is the normal case
-- during a renewal deadline, and both alternatives race: MAX is read-then-write, and an
-- in-process counter cannot survive more than one API instance.
--
-- The sequence restarts each year, which is why the year is part of the number rather than
-- the sequence itself carrying it. fn_next_reference_number handles the rollover under a
-- lock so two callers crossing midnight on 31 December cannot both reset it.

CREATE TABLE IF NOT EXISTS reference_number_counters (
    year         integer PRIMARY KEY,
    last_value   bigint  NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION fn_next_reference_number(p_now timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_year   integer := EXTRACT(YEAR FROM p_now)::integer;
    v_next   bigint;
BEGIN
    -- INSERT ... ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise on
    -- the counter row for this year and each receives a distinct value.
    INSERT INTO reference_number_counters (year, last_value)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE
        SET last_value = reference_number_counters.last_value + 1
    RETURNING last_value INTO v_next;

    RETURN 'MW-' || v_year::text || '-' || lpad(v_next::text, 6, '0');
END;
$$;

COMMENT ON FUNCTION fn_next_reference_number(timestamptz) IS
    'Allocates the next citizen-facing reference number for the given year. Concurrency safe.';
