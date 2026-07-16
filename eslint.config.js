import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const lanternI18n = require('./packages/eslint-plugin-lantern-i18n/src/index.js');
const lanternAsync = require('./packages/eslint-plugin-lantern-async/src/index.js');
const lanternEgress = require('./packages/eslint-plugin-lantern-egress/src/index.js');
const lanternTestHygiene = require('./packages/eslint-plugin-lantern-test-hygiene/src/index.js');

// Env-gated severity: warn locally so devs see the signal without blocking
// every save, but error in CI so a hardcoded string can't sneak into main.
const i18nSeverity = process.env['CI'] === 'true' ? 'error' : 'warn';
const asyncSeverity = process.env['CI'] === 'true' ? 'error' : 'warn';

export default tseslint.config(
  { ignores: ['dist', 'dist-node', 'src-tauri', 'node_modules', 'packages/*/dist'] },
  // Source files - strict TypeScript checking
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'lantern-i18n': lanternI18n,
      'lantern-egress': lanternEgress,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'lantern-i18n/no-hardcoded-string': i18nSeverity,
      'lantern-egress/no-direct-provider-send': 'error',
    },
  },
  // Tauri grants broad filesystem capability at runtime. Keep raw plugin-fs
  // access behind one wrapper so normal app code goes through WorkspaceService.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/platform/fs/tauriFsPlugin.ts', 'src/platform/flags/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tauri-apps/plugin-fs',
              message: 'Use @/platform/fs/tauriFsPlugin or WorkspaceService instead of direct plugin-fs access.',
            },
          ],
          patterns: [
            {
              group: ['**/platform/flags/registry'],
              message: 'Use isEnabled() or useFlag() from @/platform/flags instead of reading the flag registry directly.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value="@tauri-apps/plugin-fs"]',
          message: 'Use @/platform/fs/tauriFsPlugin or WorkspaceService instead of direct plugin-fs access.',
        },
      ],
    },
  },
  // no-silent-failure is scoped to user-facing surfaces only (features +
  // platform), not lib/ui/app — that's where a swallowed failure turns into
  // a wrong or stuck state a real user hits. Separate block so it layers
  // onto the main src/**/*.{ts,tsx} block above rather than widening it.
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/platform/**/*.{ts,tsx}'],
    plugins: {
      'lantern-async': lanternAsync,
    },
    rules: {
      'lantern-async/no-silent-failure': asyncSeverity,
    },
  },
  // Config files - allow Node globals
  {
    files: ['*.config.ts', '*.config.js', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
  },
  // Test files — type-aware project so mocks built to the wrong shape
  // are caught statically (not just if a given vitest run happens to
  // exercise that path). Using `recommended` (not `strictTypeChecked`)
  // so the jump from zero-project to type-project isn't immediately
  // noisy; the full strict preset can be enabled once the baseline
  // errors in tsconfig.test.json are resolved.
  {
    files: ['tests/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Test mocks must preserve unknown future public exports. This applies to
  // both source-adjacent tests and top-level test files.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    plugins: {
      'lantern-test-hygiene': lanternTestHygiene,
    },
    rules: {
      'lantern-test-hygiene/require-open-world-platform-flags-mock': 'error',
    },
  }
);
