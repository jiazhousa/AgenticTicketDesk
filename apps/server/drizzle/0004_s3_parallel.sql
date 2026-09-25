CREATE TABLE `ticket_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`round` integer NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ticket_file` ON `ticket_files` (`ticket_id`,`round`,`path`);--> statement-breakpoint
ALTER TABLE `tickets` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `retry_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `planned_files` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `queued_reason` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `queued_at` integer;