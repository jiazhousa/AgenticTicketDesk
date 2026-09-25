CREATE TABLE `humanthink_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`serve_seq` integer,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `humanthink_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ht_event_serve_seq` ON `humanthink_events` (`session_id`,`serve_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ht_event_seq` ON `humanthink_events` (`session_id`,`seq`);--> statement-breakpoint
CREATE TABLE `humanthink_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`directory` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	`deleted_at` integer
);
