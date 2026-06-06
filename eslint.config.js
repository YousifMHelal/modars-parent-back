import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*/db/prisma*", "../db/prisma*", "../../db/prisma*"],
              message:
                "Prisma client may only be imported from *.service.ts files or db/** modules.",
            },
          ],
        },
      ],
    },
  },
  {
    // Services are the only data-access layer; db/** and the lifecycle bootstraps
    // (server.ts web process, worker.ts job process) are also permitted to import the
    // Prisma client directly (connect/disconnect). lib/consent.ts is the single
    // service-layer consent data-access path (the only consent-write point, FR-006).
    files: [
      "**/*.service.ts",
      "src/db/**/*.ts",
      "src/lib/consent.ts",
      "src/server.ts",
      "src/worker.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // Test files deal with supertest responses typed as `any` — relax unsafe-any rules.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "src/generated/**", "*.min.js"],
  }
);
