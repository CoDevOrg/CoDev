CREATE TABLE `codev_agent_runs` (
	`codev_run_id` text PRIMARY KEY NOT NULL,
	`codev_workspace_id` text NOT NULL,
	`terminal_id` text NOT NULL REFERENCES `terminal_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	`host_workspace_id` text NOT NULL REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict,
	`worktree_id` text NOT NULL,
	`provider` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codev_agent_runs_terminal_id_idx` ON `codev_agent_runs` (`terminal_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `codev_agent_runs_idempotency_key_idx` ON `codev_agent_runs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `codev_agent_runs_host_workspace_id_idx` ON `codev_agent_runs` (`host_workspace_id`);
