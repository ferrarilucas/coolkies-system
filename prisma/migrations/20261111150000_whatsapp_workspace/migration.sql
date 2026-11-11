CREATE TABLE "whatsapp_workspace_context" (
    "userId" TEXT PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "workspaceId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "menuId" TEXT,
    "menuWorkspaceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "menuExpiresAt" TIMESTAMP(3)
);
