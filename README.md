# Higo App

Plataforma de movilidad + envíos de Venezuela. Stack React/Vite/Capacitor (cliente) + PHP/Hostinger (endpoints) + Supabase (DB/Auth/Realtime/Storage) + Firebase (FCM push).

## Runbooks operacionales

- Procedimientos comunes — rollback, rotación de claves, investigación de crashes y suspensión de choferes: **[docs/OPERATIONS.md](./docs/OPERATIONS.md)**.
- Rollout del hardening de membresías, viajes, despacho y analítica: **[docs/PLATFORM_HARDENING_ROLLOUT.md](./docs/PLATFORM_HARDENING_ROLLOUT.md)**.
- Reconciliación de cambios ejecutados manualmente con el historial de Supabase CLI: **[docs/SUPABASE_MIGRATION_HISTORY.md](./docs/SUPABASE_MIGRATION_HISTORY.md)**.

---

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) or [oxc](https://vite.dev/guide/rolldown) for Fast Refresh.
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses SWC for Fast Refresh.

## React Compiler

The React Compiler is not enabled because of its impact on development and build performance.

## Type safety

The current client remains JavaScript. New service contracts should migrate gradually to TypeScript with type-aware linting, beginning with payments, rides and administrative RPC clients.
