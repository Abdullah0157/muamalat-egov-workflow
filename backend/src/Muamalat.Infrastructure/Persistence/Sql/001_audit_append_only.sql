-- Makes the audit trail append-only at the database level.
--
-- The application already refuses to modify audit entries (see MuamalatDbContext), but that
-- is a convention a future service could bypass with raw SQL or a direct connection. This
-- trigger turns the guarantee into something the database enforces for every client.
--
-- Deliberate limitation: a superuser can still disable the trigger. That is inherent to
-- putting the control in the same database as the data. Genuine tamper resistance requires
-- an external anchor for the chain head, which is documented in ARCHITECTURE.md and is out
-- of scope for a demonstration deployment.

CREATE OR REPLACE FUNCTION fn_audit_entries_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'audit_entries is append-only: % is not permitted (entry %)',
        TG_OP,
        COALESCE(OLD.id::text, '?')
        USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_entries_append_only ON audit_entries;

CREATE TRIGGER trg_audit_entries_append_only
    BEFORE UPDATE OR DELETE ON audit_entries
    FOR EACH ROW
EXECUTE FUNCTION fn_audit_entries_append_only();

-- TRUNCATE does not fire row level triggers, so the trigger above would not stop
-- `TRUNCATE audit_entries` from erasing every chain in one statement. It needs its own
-- statement level trigger, and OLD is not available in that context, hence the separate
-- function below.
CREATE OR REPLACE FUNCTION fn_audit_entries_no_truncate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_entries is append-only: TRUNCATE is not permitted'
        USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_entries_no_truncate ON audit_entries;

CREATE TRIGGER trg_audit_entries_no_truncate
    BEFORE TRUNCATE ON audit_entries
    FOR EACH STATEMENT
EXECUTE FUNCTION fn_audit_entries_no_truncate();
