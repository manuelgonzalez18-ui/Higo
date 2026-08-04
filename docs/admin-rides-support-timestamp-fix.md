# Higo Viajes: compatibilidad de historial de soporte

El detalle administrativo de un viaje debe funcionar tanto en esquemas donde
`support_threads` incluye `updated_at` como en instalaciones históricas donde
solo existen marcas como `last_message_at` o `created_at`.

La migración `20260804191000_admin_ride_detail_support_threads_timestamp.sql`
ordena el historial desde `to_jsonb(st)`, evitando referencias SQL directas a
columnas opcionales. También aplica el mismo criterio preventivo al historial
de señales de fraude.
