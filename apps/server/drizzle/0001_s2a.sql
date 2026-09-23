CREATE TABLE `ticket_commits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`round` integer NOT NULL,
	`sha` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ticket_commit` ON `ticket_commits` (`ticket_id`,`round`,`sha`);--> statement-breakpoint
CREATE TABLE `ticket_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`round` integer NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`block_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tickets` ADD `pending_label` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `round` integer DEFAULT 0 NOT NULL;