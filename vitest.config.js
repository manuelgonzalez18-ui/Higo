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
import process from 'node:process';
import { TEST_ENVIRONMENT } from './src/config/testEnvironment.js';

Object.assign(process.env, TEST_ENVIRONMENT);

// vite.config.js exporta una FUNCIÓN (recibe { command, mode } para leer las
// env vars con loadEnv). mergeConfig no sabe fusionar un callback y aborta con
// "Cannot merge config in form of callback", dejando la suite sin correr. Lo
// resolvemos acá invocándolo con el entorno de test para obtener el objeto de
// configuración real antes de fusionar.
const resolvedViteConfig = typeof viteConfig === 'function'
    ? viteConfig({ command: 'serve', mode: 'test' })
    : viteConfig;

export default mergeConfig(
    resolvedViteConfig,
    defineConfig({
        test: {
            globals: true,
            environment: 'jsdom',
            include: ['tests/**/*.test.{js,jsx}', 'src/**/*.test.{js,jsx}'],
            exclude: ['node_modules', 'dist'],
        },
    })
);
