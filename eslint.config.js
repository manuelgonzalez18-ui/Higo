import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // React Compiler is not enabled in this project. Keep its adoption
      // diagnostics visible while core hook-order checks remain blocking.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react/jsx-uses-vars': 'error',
    },
    plugins: { react },
  },
  { files: ['*.js', '*.mjs', 'scripts/**/*.{js,mjs}', 'tests/**/*.mjs', 'e2e/**/*.js'], languageOptions: { globals: globals.node } },
  { files: ['**/*.test.{js,jsx}'], languageOptions: { globals: globals.vitest } },
  { files: ['public/firebase-messaging-sw.js'], languageOptions: { globals: { ...globals.serviceworker, firebase: 'readonly' } } },
  { files: ['src/services/firebase.js'], languageOptions: { globals: { __app_id: 'readonly' } } },
  { files: ['src/adminRidesEntry.jsx'], rules: { 'react-refresh/only-export-components': 'off' } },
])
