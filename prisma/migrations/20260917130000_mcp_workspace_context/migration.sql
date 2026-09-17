BEGIN;

CREATE TABLE "mcp_workspace_context" (
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_workspace_context_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "mcp_workspace_context"
  ADD CONSTRAINT "mcp_workspace_context_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_workspace_context"
  ADD CONSTRAINT "mcp_workspace_context_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "mcp_workspace_context_workspaceId_idx" ON "mcp_workspace_context"("workspaceId");

COMMIT;
