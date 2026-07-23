import { describe, expect, it, vi } from 'vitest';
import { createSingleFlight } from './singleFlight';

describe('createSingleFlight', () => {
    it('comparte una sola operación entre callers concurrentes', async () => {
        const gate = createSingleFlight();
        let resolveOperation;
        const operation = vi.fn(() => new Promise((resolve) => {
            resolveOperation = resolve;
        }));

        const first = gate.run('login:user@example.com', operation);
        const second = gate.run('login:user@example.com', operation);

        expect(first).toBe(second);
        expect(operation).toHaveBeenCalledTimes(1);
        expect(gate.size()).toBe(1);

        resolveOperation({ ok: true });
        await expect(first).resolves.toEqual({ ok: true });
        expect(gate.size()).toBe(0);
    });

    it('libera la clave después de un rechazo', async () => {
        const gate = createSingleFlight();
        const failure = new Error('network failure');

        await expect(gate.run('login:user@example.com', () => Promise.reject(failure)))
            .rejects.toBe(failure);

        const operation = vi.fn(async () => 'recovered');
        await expect(gate.run('login:user@example.com', operation)).resolves.toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('permite operaciones simultáneas con claves diferentes', async () => {
        const gate = createSingleFlight();
        const first = gate.run('login:a@example.com', async () => 'a');
        const second = gate.run('login:b@example.com', async () => 'b');

        await expect(Promise.all([first, second])).resolves.toEqual(['a', 'b']);
    });
});
