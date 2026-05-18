// vitest.config.js — Setup mínimo para tests (Fase 12 C1).
//
// Para correr:
//   npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
//   npm test
//
// La config extiende vite.config.js así Vitest entiende los alias e
// imports del mismo modo que el build. `test.environment='jsdom'`
// permite tests de componentes; los tests puros (utils) corren más
// rápido con 'node' pero jsdom funciona para todos.

import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            globals: true,
            environment: 'jsdom',
            include: ['tests/**/*.test.{js,jsx}'],
            exclude: ['node_modules', 'dist'],
        },
    })
);
