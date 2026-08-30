import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { config } from "dotenv";

config({ path: ".env.test" });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 30000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.claude/worktrees/**",
    ],
  },
});
