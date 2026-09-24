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
    "extensions/dist/**",
    "services/web-research-mcp/dist/**",
    "next-env.d.ts",

    // ⚠️ A WORKTREE IS A SEPARATE CHECKOUT, NOT THIS ONE'S SOURCE.
    //
    // `.claude/worktrees/**` holds other sessions' in-flight branches. Linting
    // them reports THEIR errors against THIS tree's gate — a real one turned up
    // in `security-hardening/app/admin/page.tsx` and failed a run that had
    // nothing to do with it. Each worktree runs its own lint against its own
    // branch; borrowing its failures here only teaches people to ignore the
    // number.
    ".claude/worktrees/**",

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

    // ⚠️ GENERATED DESIGN SCRATCH, AND IT BROKE `npm run lint` — WHICH GATES CI.
    //
    // `.codex-previews/` holds one-off preview harnesses written while
    // iterating on UI (`refine-alpha.cjs` and friends). One of them uses
    // `require()`, which `@typescript-eslint/no-require-imports` reports as an
    // ERROR rather than a warning, so `npm run lint` exited non-zero — and the
    // CI `verify` job runs lint. A scratch file nobody ships would have blocked
    // every merge.
    //
    // Gitignored alongside this, so it cannot reach CI in the first place.
    // Ignored rather than fixed because it is not this project's source: a
    // `.cjs` preview script using `require` is correct for what it is.
    ".codex-previews/**",
    ".codex/**",
  ]),
]);

export default eslintConfig;
