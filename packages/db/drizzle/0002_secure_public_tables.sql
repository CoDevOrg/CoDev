-- CoDev uses an Auth.js session and a server-only PostgreSQL connection. The
-- browser never queries these product tables through Supabase's Data API.
-- RLS plus explicit privilege revocation keeps the public schema closed even
-- if project-wide Data API defaults change.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "github_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worktrees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_turns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "path_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coordination_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "yjs_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "published_branches" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
