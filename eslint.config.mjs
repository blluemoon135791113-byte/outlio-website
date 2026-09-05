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
  ]),
]);

export default eslintConfig;
