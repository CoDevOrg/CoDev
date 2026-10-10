import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: [
      "components/gen2/superset-*.tsx",
      "components/gen2/workspace-share-dialog.tsx",
      "components/gen2/chat-panel.tsx",
      "components/gen2/turn-activity.tsx",
      "components/gen2/terminal-pane.tsx",
      "components/gen2/chat-*.tsx",
      "components/gen2/workspace-action-*.tsx",
      "components/gen2/workspace-browser-*.tsx",
      "components/gen2/workspace-terminal-*.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/components/ui/button",
              message:
                "Workspace actions must use ./workspace-button, including portaled dialogs. See docs/design/workspace-controls.md.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".cloudflare/**",
    ".vinext/**",
    ".swc/**",
    "app/.well-known/workflow/**",
    "next-env.d.ts",
    "worker-configuration.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
