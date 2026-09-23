# Cotización autoritativa y evidencia pública

Estos endpoints PHP mantienen las claves privilegiadas en el servidor. La web y Android usan el mismo backend explícito, configurado mediante `VITE_API_BASE_URL`. Los ejemplos siguientes describen la implementación del repositorio; no certifican que las migraciones ni las claves estén instaladas en un entorno remoto.

## Configuración privada y requisitos

PHP 8.1 o posterior, extensión cURL con un almacén de certificados CA válido, funciones de imagen estándar (`getimagesizefromstring`) y directorio temporal escribible con `flock`. La suite se verifica con PHP 8.3. La configuración se carga mediante `public/banesco-core.php`: `HIGO_BANESCO_CONFIG` señala un archivo PHP privado que devuelve un array. Si la variable no existe, el resolvedor busca `private/higo-banesco.php` junto al directorio `public`; debe permanecer fuera de la raíz publicada. Integrar estas claves en la configuración existente, conservando sus otras entradas:

```php
<?php
return [
    'SUPABASE_PROJECT_URL' => 'https://PROJECT.supabase.co',
    'SUPABASE_ANON_KEY' => 'CLAVE_PUBLICA_DEL_MISMO_ENTORNO',
    'SUPABASE_SERVICE_ROLE_KEY' => 'CLAVE_PRIVILEGIADA_DEL_MISMO_ENTORNO',
    'GOOGLE_ROUTES_SERVER_KEY' => 'CLAVE_SERVIDOR_ROUTES',
    'HIGO_PUBLIC_API_BASE_URL' => 'https://api-staging.example.com',
    'HIGOPAY_ALLOWED_ORIGINS' => ['https://staging.example.com'],
];
```

- Las dos URL de servidor deben ser orígenes HTTPS, sin ruta, credenciales, query ni fragmento. La URL pública apunta al host que sirve `/api/tracking-evidence.php`; no se deduce de la cabecera `Host`.
- Habilitar **Routes API** en Google Cloud para la clave de servidor y restringirla a esa API y, cuando el hosting lo permita, a las IP de salida del servidor. No utilizar una clave restringida por referrer de navegador. El código usa `DRIVE` y `TRAFFIC_AWARE` para todos los vehículos, incluyendo moto; no habilita automáticamente rutas de motocicleta por región.
- `SUPABASE_SERVICE_ROLE_KEY` y la clave Google nunca deben estar en variables `VITE_*`, artefactos de frontend ni respuestas HTTP. Las peticiones Supabase/Google verifican TLS; no hay interruptor de simulación en producción.
- Configurar la variable de proceso `HIGO_TRUSTED_PROXY_IPS` únicamente con las IP exactas de los proxies inmediatos de confianza, separadas por comas. Sin ella, solo se utiliza `REMOTE_ADDR`. Las cabeceras IP recibidas de otros orígenes se ignoran.
- El limitador usa archivos en `sys_get_temp_dir()/higo_ratelimit` con lectura, incremento y escritura bajo un único bloqueo. Es válido por host/almacenamiento compartido con bloqueos fiables; varias réplicas con temporales independientes requieren un limitador común. Si no se puede persistir el contador, responde 503.
- El helper CORS compartido conserva sus orígenes históricos de Higo, localhost/Capacitor y previews del proyecto; `HIGOPAY_ALLOWED_ORIGINS` agrega dominios. CORS no sustituye la separación de proyectos y claves. Verificar esa lista en la política de cada entorno.

Antes de staging: aplicar y verificar las migraciones de integridad/cotizaciones, la RPC `higo_store_route_quote`, la RPC `create_ride_from_quote` y la versión de `get_public_tracking` que aplica revocación y vencimientos. La RPC de almacenamiento de cotizaciones debe ser ejecutable únicamente por `service_role`; el bucket `delivery-pods` debe ser privado. El cierre de accesos antiguos mediante `higo_finalize_launch()` es un paso explícito posterior a la verificación de clientes y permisos; estos endpoints no lo ejecutan.

## POST `/api/ride-quote.php`

Requiere `Authorization: Bearer <access_token>` de Supabase. Verifica la sesión mediante `/auth/v1/user`; toma el propietario de esa respuesta, nunca del cuerpo. Límite: 30 peticiones por minuto/IP y 10 por minuto/usuario, incluso cambiando de IP. Acepta como máximo 16 KiB de JSON:

```json
{
  "pickupCoords": { "lat": 10.46, "lng": -65.97 },
  "dropoffCoords": { "lat": 10.48, "lng": -65.99 },
  "vehicleType": "standard",
  "serviceType": "delivery",
  "stops": [{ "lat": 10.47, "lng": -65.98, "address": "Parada intermedia" }],
  "promoCode": null
}
```

Vehículos: `moto`, `standard`, `van`. Servicio: `ride` o `delivery` (predeterminado `ride`). Entre cero y cinco paradas, en el orden recibido; sus coordenadas deben ser válidas. Los textos de parada admiten hasta 500 bytes y la promoción hasta 100 bytes. Distancia, duración, precio, piso de tarifa y usuario enviados por el cliente se ignoran.

El servidor llama al endpoint fijo Google `directions/v2:computeRoutes`, solicita `routes.distanceMeters,routes.duration` y guarda las métricas de la primera ruta mediante la RPC privilegiada. No utiliza distancia en línea recta si falla el proveedor. Se aceptan métricas positivas de hasta 2.000 km y 2.880 minutos. La cotización conserva las reglas comerciales V4 vigentes y su desglose; la base de datos añade `quoteId` UUID y `expiresAt` a cinco minutos. Respuesta 200 ilustrativa:

```json
{
  "quoteId": "00000000-0000-4000-8000-000000000002",
  "expiresAt": "2026-09-17T12:05:00Z",
  "distanceKm": 4.5,
  "durationMin": 13,
  "subtotal": 7.5,
  "discount": 0,
  "finalPrice": 7.5,
  "promoValid": false
}
```

La respuesta real incluye los demás campos de V4. `promoValid: false` sin código no es un fallo; cuando se solicita una promoción, la interfaz comprueba `promoValid`/`promoError`. No se garantiza la reserva de una promoción hasta crear el viaje. Los tiempos máximos de transporte son 5 s para sesión, 12 s para Google y 8 s para guardar. Respuestas no cacheables:

| HTTP | Código/condición |
| --- | --- |
| 401 | `authentication_required` o `invalid_session` |
| 403 | `origin_not_allowed` |
| 405 | Método distinto de POST/OPTIONS |
| 422 | `invalid_json`, `request_too_large`, `invalid_coordinates`, `invalid_stops`, `invalid_stop_address`, `invalid_service`, `invalid_promo_code` |
| 429 | `rate_limited`, con `Retry-After` y `retry_after` |
| 503 | `quote_unavailable` o `temporarily_unavailable`; no hay creación de viaje ni tarifa alternativa |

## Crear el viaje y reintentar

El cliente llama a Supabase `create_ride_from_quote` con `p_quote_id`, `p_client_request_id` UUID estable, `p_pickup`, `p_dropoff` y los campos opcionales `p_passenger_phone`, `p_delivery_info`, `p_payer`, `p_cod_amount`, `p_terms_version`. No hay parámetros de distancia, duración, subtotal, vehículo ni coordenadas: proceden de la cotización guardada.

La RPC valida propietario, perfil permitido, viaje activo, consumo previo y expiración. Serializa la creación por pasajero y bloquea la promoción mientras revalida disponibilidad y registra el uso. Los datos de entrega se conservan; `payer` y `cod_amount` del JSON se normalizan a los parámetros validados. La respuesta incluye `rideId`, `price`, `status`, `quote`, `idempotentReplay`.

Tras timeout, reutilizar **el mismo** `client_request_id`: si el viaje ya existe, se devuelve antes de comprobar vencimiento de cotización. No generar otra solicitud mientras el resultado sea incierto. `quote_expired` o `quote_changed` requieren mostrar una nueva cotización antes de confirmar. `quote_not_owned`, `quote_already_consumed`, `active_ride_exists`, `passenger_role_required` y errores de promoción son rechazos del servidor; no deben activar caminos de escritura directa. Un cambio de importe durante la transacción hace rollback.

## GET `/api/tracking-evidence.php`

No requiere sesión: la autorización es el token UUID de seguimiento. `?token=<uuid>` consulta `get_public_tracking` y devuelve `{ "url": "https://API/api/tracking-evidence.php?token=...&content=1" }` únicamente para una entrega completada con evidencia disponible.

La URL de imagen vuelve a consultar la RPC **en cada GET**. Tokens revocados, vencidos o posteriores al límite de 24 horas de entrega no llegan a Storage. No se emite una URL firmada reutilizable de Storage. El endpoint descarga y transmite la imagen con el servicio privilegiado; el visitante no puede seleccionar bucket, ruta, ride ID ni host upstream. Solo se usa `delivery_pod_url` retornado por la base y validado contra los formatos históricos/nuevos de evidencia de entrega. Se admiten JPEG, PNG y WebP verificados por contenido, hasta 10 MiB; SVG/HTML se rechazan.

La imagen y el JSON usan `Cache-Control: private, no-store, max-age=0`, `nosniff` y política de referrer `no-referrer`. La revocación impide nuevas lecturas; no puede borrar una imagen ya recibida por un destinatario. El límite es de 30 GET por minuto/IP, incluyendo metadatos e imagen.

| HTTP | Condición |
| --- | --- |
| 200 | JSON URL o bytes de imagen cuando `content=1` |
| 403/405/429 | CORS, método o límite de peticiones |
| 404 | Token inválido/inaccesible, entrega pendiente o evidencia ausente |
| 503 | Error de configuración, base/Storage, ruta inválida, contenido inválido o almacenamiento del limitador |

## Pruebas y verificación del entorno

Ejecutar `npm run test:php` con `php` en PATH o `PHP_BIN` apuntando al binario. El runner valida sintaxis de PHP en `public` y `higodriver`, prueba helpers y dispara 64 intentos en ocho procesos: exactamente diez deben entrar al mismo cupo. Las pruebas HTTP arrancan un servidor limitado a `127.0.0.1`, copian los endpoints a un directorio temporal y sustituyen el transporte únicamente en esa copia. Ninguna petición alcanza Supabase, Google ni pagos reales.

Los casos cubren sesión ausente/vencida, CORS, entrada malformada, orden de paradas, manipulación de métricas/usuario, proveedor caído, persistencia fallida, cupo de usuario entre IPs, revocación/vencimiento, rutas arbitrarias, imágenes inválidas y contador concurrente. Los mocks HTTP comprueban la reacción ante filas vacías de tracking; las pruebas SQL independientes deben demostrar que la RPC real filtra correctamente tokens y fechas.

Antes del piloto verificar en staging: extensión cURL/CA, tiempo máximo PHP superior a 30 s, DNS/egreso HTTPS de ambos proveedores, claves del mismo entorno, restricción de Google, Storage privado, URL pública correcta, proxy confiable y escritura del temporal. Esta suite no sustituye esas comprobaciones, la validación del esquema desplegado ni pruebas físicas Android.
