import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // ── Structural complexity guards ──────────────────────────
      // Keep functions focused and readable.
      "max-lines-per-function": [
        "warn",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
      // Cap file size — a file over 300 lines is doing too much.
      "max-lines": [
        "warn",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      // Limit nesting depth — deep nesting is hard to read and change.
      "max-depth": ["warn", 4],
      // Limit parameters — too many params means a missing abstraction.
      "max-params": ["warn", 4],
      // Cyclomatic complexity — keeps branching logic simple.
      complexity: ["warn", 15],
    },
  },
  // ── Test files get relaxed size limits ───────────────────────
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
    },
  },
  // ── Prevent deeply nested cross-module imports ───────────────
  {
    files: ["apps/web/lib/**/*.ts", "apps/web/lib/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["../../../*"],
              message:
                "Import depth > 3 levels suggests a wrong module boundary. Import from a package or a closer module.",
            },
          ],
        },
      ],
    },
  },
);
