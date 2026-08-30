import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/tenant/**", "src/server/actions/allowlist.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              message:
                "Use getScopedDb() ou getWorkspaceDb() de @/server/tenant/context. O client cru nao aplica escopo de workspace.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
