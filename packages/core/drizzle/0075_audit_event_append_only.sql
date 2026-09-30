-- The audit log is append-only: nothing in the app updates a row, and this
-- trigger makes sure a later bug cannot either. DELETE stays allowed, because
-- the retention sweep and the organization's own cascade are the two ways a
-- row leaves. See `packages/core/src/db/schema/audit.ts`.
CREATE FUNCTION "audit_event_refuse_update"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_event is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only"
	BEFORE UPDATE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION "audit_event_refuse_update"();
