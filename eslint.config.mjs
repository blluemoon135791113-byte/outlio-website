import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Marketing copy is used verbatim from the copy deck; raw apostrophes render fine.
      "react/no-unescaped-entities": "off",

      // Honour the leading-underscore convention for intentionally unused
      // bindings. Interface implementations (e.g. PaymentProvider) must accept
      // parameters they do not use; renaming them would break the contract.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "services/web-research-mcp/dist/**",
    "next-env.d.ts",

    // ⚠️ AGENT TOOLING, NOT THIS PROJECT'S SOURCE.
    //
    // `npx impeccable install` vendors its own bundled JS (live-browser.js,
    // modern-screenshot.umd.js) into one directory per detected harness.
    // Linting them produced 279 warnings against 99 real ones — a signal that
    // has to be searched is not a signal, and the next genuine warning would
    // have been read as more of the same.
    //
    // Gitignored too; this keeps them out of the local `npm run lint` a
    // developer actually reads.
    ".claude/skills/**",
    ".agents/skills/**",
    ".github/skills/**",
  ]),
]);

export default eslintConfig;
