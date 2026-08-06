import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    ".swc/**",
    "app/.well-known/workflow/**",
    "next-env.d.ts",
    "playwright-report/**",
    "public/theia/**",
    "test-results/**",
  ]),
]);
