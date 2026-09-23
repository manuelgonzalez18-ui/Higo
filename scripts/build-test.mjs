import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { TEST_ENVIRONMENT } from '../src/config/testEnvironment.js';

const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'test'], {
    stdio: 'inherit',
    env: { ...process.env, ...TEST_ENVIRONMENT },
});
process.exit(result.status ?? 1);
