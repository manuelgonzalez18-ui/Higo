// Evita ejecutar en paralelo operaciones que comparten una misma clave.
// Los callers reciben exactamente la misma Promise mientras la operación siga activa.
// Al resolver o rechazar, la clave se libera para permitir un intento nuevo.
export const createSingleFlight = () => {
    const inFlight = new Map();

    const run = (key, operation) => {
        if (inFlight.has(key)) return inFlight.get(key);

        const promise = Promise.resolve()
            .then(operation)
            .finally(() => {
                if (inFlight.get(key) === promise) inFlight.delete(key);
            });

        inFlight.set(key, promise);
        return promise;
    };

    return {
        run,
        has: (key) => inFlight.has(key),
        size: () => inFlight.size,
    };
};

export default createSingleFlight;
