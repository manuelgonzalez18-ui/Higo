# Corrección de dependencias — 30 de septiembre de 2026

Quality Gate #537 detuvo la entrega en `npm audit --omit=dev --audit-level=high`.
Las pruebas Node, Vitest, PHP, release y ambos jobs SQL habían aprobado, pero npm
reportó cuatro paquetes altos por la dependencia transitiva `@grpc/grpc-js` de
Firestore. No se omitió la auditoría ni se ejecutó el downgrade forzado a Firebase 9.

Se fija `@grpc/grpc-js` en **1.14.5** mediante `overrides`, manteniendo Firebase 12.6.
Incluso el Firestore más reciente consultado conserva `~1.9.0`, por lo que actualizar
solo Firebase no elimina la dependencia afectada. El override debe revisarse cuando
Firestore admita una versión corregida de forma nativa.

Los avisos del mantenedor identifican correcciones en 1.13.6 y 1.14.5:
[validación de certificados](https://github.com/advisories/GHSA-m9gg-hp2v-232j) y
[exposición de mensajes de error](https://github.com/advisories/GHSA-f596-whhp-79r4).
Describen comportamiento del servidor gRPC; no se confirmó una vía de explotación
en la aplicación web Higo. Se corrige la dependencia de todas formas para mantener
la cadena de instalación actualizada. Validar instalación, auditoría, pruebas y build
del mismo lockfile antes de promover.

La instalación reproducible completó correctamente y `npm audit --omit=dev`
volvió a informar cero vulnerabilidades. `npm ls` confirmó 1.14.5 en Firebase y
firebase-admin. La auditoría que incluye desarrollo aún informa dos avisos moderados;
no confundir ese alcance con la auditoría de producción.
Con ese lockfile aprobaron 61 pruebas Vitest, la compilación y cuatro pruebas
Playwright con Chrome instalado; los 90 tests Node y los contratos PHP también
aprobaron. El primer intento de navegador no encontró el Chromium descargable;
se usó la ruta de Chrome admitida por la configuración existente y no se omitieron tests.
