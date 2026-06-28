-- Activation milestones on users: when a user first records a successful tool
-- invocation, and when they were last sent an activation-help email.
ALTER TABLE "users" ADD COLUMN "first_successful_invocation_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "activation_reminder_at" TIMESTAMP(3);
