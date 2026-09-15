-- Projects open to the whole organization: every member may log time on one
-- without an assignment. False keeps what every existing project means.
ALTER TABLE "project" ADD COLUMN "open_to_org" boolean DEFAULT false NOT NULL;
