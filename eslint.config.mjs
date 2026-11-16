import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // zod must be configured jitless before use (CSP); see src/lib/zod.ts.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/zod.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "zod", message: 'Import { z } from "@/lib/zod" instead.' }],
          patterns: [{ group: ["zod/*"], message: 'Import { z } from "@/lib/zod" instead.' }],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
