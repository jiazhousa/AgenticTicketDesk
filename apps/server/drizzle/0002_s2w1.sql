ALTER TABLE `tickets` ADD `workspace_id` text DEFAULT 'atd' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `repo_ref` text;