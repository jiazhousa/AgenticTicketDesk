DELETE FROM ticket_dependencies WHERE blocked_by_ticket_id IN (SELECT id FROM tickets WHERE type = 'BLOCKER');
--> statement-breakpoint
DELETE FROM comments WHERE ticket_id IN (SELECT id FROM tickets WHERE type = 'BLOCKER');
--> statement-breakpoint
DELETE FROM ticket_transitions WHERE ticket_id IN (SELECT id FROM tickets WHERE type = 'BLOCKER');
--> statement-breakpoint
DELETE FROM ticket_reports WHERE ticket_id IN (SELECT id FROM tickets WHERE type = 'BLOCKER');
--> statement-breakpoint
DELETE FROM ticket_commits WHERE ticket_id IN (SELECT id FROM tickets WHERE type = 'BLOCKER');
--> statement-breakpoint
DELETE FROM tickets WHERE type = 'BLOCKER';
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN block_reason TEXT;
