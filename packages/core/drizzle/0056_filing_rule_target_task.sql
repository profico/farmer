-- Filing rules: the task a matching meeting is filed under. Null keeps the
-- meeting's own task, which is what every existing rule means.
ALTER TABLE "filing_rule" ADD COLUMN "target_task_id" uuid;--> statement-breakpoint
ALTER TABLE "filing_rule" ADD CONSTRAINT "filing_rule_target_task_id_task_id_fk" FOREIGN KEY ("target_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;