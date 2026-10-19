# Higo Pay · Membresías y facturación fiscal (octubre 2026)

## Implementado

- Precios mensuales canónicos: moto USD 15, carro/standard USD 25, camioneta/van USD 25.
- Precios semanales de 7 días: moto USD 4, carro/standard USD 7, camioneta/van USD 7. Migración independiente: `20261018223200_membership_weekly_prices.sql`. Cuatro semanas de moto: USD 16 frente a USD 15 por 30 días; cuatro semanas de carro/camioneta: USD 28 frente a USD 25 por 30 días.
- La UI obtiene los precios del catálogo de Supabase y convierte a bolívares con tasa oficial BCV al momento del pago.
- En la tabla legacy `membership_plans`, `amount_bs` y `bs_updated_at` se ponen a NULL: no usar el antiguo equivalente fijo en bolívares cuando BCV esté caído.
- Migración `20261018223000_membership_pricing_fiscal_invoice_queue.sql`: almacena datos fiscales del conductor, crea una fila de factura por pago validado y protege el acceso.
- La factura se pone en estado `awaiting_billing_data` mientras el conductor no haya suministrado información fiscal; una vez la guarda, pasa a `pending`.
- Cada factura queda vinculada 1:1 tanto con `payment_reports.id` como con `driver_memberships.id`. No facturar un reporte rechazado o pendiente.
- Se impide desde clientes autenticados registrar en `payment_reports` la condición `validated`: únicamente servidor de confianza y administradores autorizados podrán hacerlo.
- La lista de facturas y la ficha fiscal aparecen en Higo Pay solamente cuando `VITE_FISCAL_INVOICES_ENABLED=true`.
- Los PDFs deberán guardarse en el bucket privado `membership-invoices`, bajo el prefijo `<driver_id>/`, con acceso autenticado mediante URL firmada temporal. El cliente no recibe permisos de inserción o modificación sobre las facturas.

## Pendiente: emisión real y correo automático

**Esta migración prepara la cola; NO emite facturas fiscales ni envía correos automáticamente.**
No activar el indicador de UI antes de instalar la migración en producción. La integración de la imprenta digital requiere credenciales, especificación acordada y confirmaciones tributarias.

Antes de habilitarla:
1. Confirmar cuál sociedad **presta/cobra** el servicio: HIGO TECHNOLOGIES, C.A. (Venezuela) o una entidad distinta; verificar RIF, razón social, domicilio fiscal, permisos y la cuenta receptora de Higo Pay.
2. Elegir imprenta digital/autorización aplicable y obtener credenciales **sandbox y producción**. Candidato técnico: [DigitalInvoice de Unidigital](https://docs.unidigital.global/) (sus requisitos actuales pueden cambiar). Nunca almacenar secretos en variables `VITE_*` ni en GitHub.
3. Validar con contador: tarifas anunciadas de USD 4/7 semanales y USD 15/25 mensuales ¿son precios finales con impuestos incluidos?, tasa IVA según condición fiscal, IGTF si aplica, regla de conversión y fecha/tasa BCV. **No deducir** ni sumar un IVA fijo en código sin esta validación.
4. Construir un worker confiable en servidor (PHP backend o Supabase Edge Function) que consuma facturas `pending`, lea datos fiscales del conductor y evidencia del pago validado, genere el documento en la imprenta y guarde identificadores/numero de control/número fiscal. Registrar copia del PDF en almacenamiento privado.
5. Para reintentos, usar `payment_report_id` como clave de idempotencia. Reconsultar al proveedor ante timeout para evitar doble emisión; un resultado incierto debe pasar a `manual_review`, nunca emitirse a ciegas.
6. Enviar el PDF o un enlace privado de un solo uso al correo del titular con el servicio SMTP/transaccional autenticado; guardar `emailed_at`. Si falla el email se reintenta el **envío**, no la emisión.
7. Conciliar documentos con el libro contable y los reportes bancarios; establecer proceso de nota de crédito y facturas anuladas sin borrar historiales.

### Flujo recomendado

`Banesco valida abono -> register_membership_payment_v2 -> payment_reports(validated) -> membership_fiscal_invoices(pending/awaiting_billing_data) -> worker de imprenta (PENDIENTE) -> emisión confirmada -> PDF privado -> correo transaccional (PENDIENTE)`.

Las transferencias creadas como `pending` no generan una factura. El flujo fiscal se inicia únicamente cuando un proceso legítimo las convierte a `validated` y asocia una membresía válida.

### Reglas de seguridad

- La app **solo lee** facturas suyas; nunca emite, edita numeración ni descarga documentos fiscales de otros conductores.
- La función de cola es `SECURITY DEFINER` exclusivamente para el disparador SQL, sin permiso `EXECUTE` público o de cliente. Comprueba la pertenencia de la membresía al conductor.
- El trabajador privado debe usar credenciales de servidor, protección de acceso y límites de reintento.
- Nunca construir en la app una "factura" con número inventado: el comprobante bancario y un PDF de cortesía no equivalen a una factura fiscal.
- No crear automáticamente facturas por pagos históricos; se deben conciliar primero.
- La providencia SNAT/2026/00084 derogó la homologación obligatoria de software, **no** el resto de exigencias de facturación; revisar el régimen aplicable con asesor fiscal.

## Implantación

1. Aplicar migración en staging; comprobar RLS, índices, triggers y política de INSERT de `payment_reports`.
2. Aplicar y auditar migración en producción mediante proceso de despliegue autorizado.
3. Integrar proveedor y mailer, ejecutar pruebas de respuesta exitosa, falla de la imprenta, reintento, duplicado y fallo de envío.
4. Activar `VITE_FISCAL_INVOICES_ENABLED=true` una vez comprobada la persistencia de facturas; no implica por sí solo que la emisión externa esté funcionando.
5. Monitorizar `awaiting_billing_data`, `pending`, `failed` y `manual_review`, y avisar operaciones si queda una factura sin emitir.

**Estado a 18-10-2026:** Precios mensuales y semanales actualizados y verificados en Higo Project; migraciones fiscales y de precios semanales aplicadas en Higo Staging (sin registros de planes en staging en la comprobación inicial); emisión externa y correo fiscal aún no integrados.
