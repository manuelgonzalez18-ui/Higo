// logger.js — gate de DEBUG (Fase 12 C6).
//
// El repo tiene ~70 console.log/info/debug/warn/error dispersos que
// pueden ser útiles en dev pero generan ruido en la consola prod
// del browser del usuario y exponen detalles internos (errors con
// stack trace, IDs, paths de archivos) que ayudan a un atacante a
// mapear la app.
//
// Este wrapper:
//   - .debug() / .info() / .log() / .warn() son no-op en producción.
//   - .error() siempre se ejecuta (errores críticos hay que verlos).
//   - En dev (import.meta.env.DEV) hace passthrough a console.*.
//   - logger.force.X() es un escape hatch para forzar log en prod
//     (ej. milestones críticos de auditoría).
//
// Patrón de uso (migración incremental — los console.* siguen
// funcionando hasta que se los reemplace):
//   import { logger } from '../utils/logger';
//   logger.debug('GPS update:', lat, lng);
//   logger.error('Auth failed:', err);
//
// Para migración masiva con sed (cuidadosa):
//   sed -i 's/console\.log\b/logger.debug/g' src/**/*.{js,jsx}
//   sed -i 's/console\.info\b/logger.info/g'   src/**/*.{js,jsx}
//   sed -i 's/console\.debug\b/logger.debug/g' src/**/*.{js,jsx}
// Dejar console.warn/error como están (ya son útiles en prod).

const isDev = typeof import.meta !== 'undefined'
    ? import.meta.env?.DEV === true
    : false;

const noop = () => {};

export const logger = {
    debug: isDev ? console.debug.bind(console) : noop,
    info:  isDev ? console.info.bind(console)  : noop,
    log:   isDev ? console.log.bind(console)   : noop,
    warn:  console.warn.bind(console),   // warn sigue en prod
    error: console.error.bind(console),  // error sigue en prod
    // Force: forzar log/info/debug también en prod. Para milestones
    // de auditoría que tenemos que ver siempre, sin importar el build.
    force: {
        debug: console.debug.bind(console),
        info:  console.info.bind(console),
        log:   console.log.bind(console),
    },
};

export default logger;
