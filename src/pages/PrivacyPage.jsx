import React from 'react';
import { Link } from 'react-router-dom';

// Versión vigente de la Política de Privacidad. Bumpear cuando se
// modifique el texto sustantivo (alineada con TERMS_VERSION del T&C).
export const PRIVACY_VERSION = '2026-05-19';

const PrivacyPage = () => (
    <div className="min-h-screen bg-[#0a101f] text-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
            <Link to="/" className="text-emerald-400 text-sm mb-6 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Volver
            </Link>

            <h1 className="text-3xl font-extrabold mb-1">Política de Privacidad de la Plataforma Higo</h1>
            <p className="text-gray-400 text-sm mb-2"><strong>Última actualización:</strong> Mayo 2026 · Versión {PRIVACY_VERSION}</p>
            <hr className="border-white/10 mb-8" />

            <section className="space-y-5 leading-relaxed text-gray-200 text-[15px]">
                <p>
                    En HIGO valoramos y protegemos tu privacidad. Esta Política de Privacidad describe
                    cómo recopilamos, usamos, almacenamos, protegemos y compartimos la información
                    personal de los usuarios (pasajeros, remitentes y destinatarios) y contratistas
                    independientes (conductores) que utilizan nuestra aplicación móvil y el sitio web
                    higodriver.com.
                </p>
                <p>
                    Esta Plataforma es propiedad de <strong>Higo Inc.</strong> (Delaware, EE. UU.) y
                    es operada localmente en la República Bolivariana de Venezuela por su filial
                    <strong> Higo C.A.</strong> (en adelante, conjuntamente denominadas "HIGO"). Al
                    registrarse o utilizar cualquiera de nuestros servicios, usted acepta las
                    prácticas descritas en este documento.
                </p>

                {/* 1 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    1 · Información que recopilamos
                </h2>

                <h3 className="text-base font-bold text-white mt-4">1.1 Información que nos proporcionas directamente</h3>
                <ul className="list-disc list-outside space-y-2 ml-5">
                    <li><strong>Datos de cuenta y perfil:</strong> nombre completo, correo electrónico, número de teléfono, fotografía de perfil y credenciales de acceso cifradas.</li>
                    <li><strong>Datos de validación del Conductor (Onboarding):</strong> foto del documento de identidad o cédula, licencia de conducir, certificado médico, certificado de circulación, póliza de Responsabilidad Civil Vehicular (RCV), fotografías del vehículo (modelo, color, placa) y código QR o datos asociados a su Pago Móvil.</li>
                    <li><strong>Datos específicos de Higo Envíos v2:</strong> para procesar un envío recopilamos obligatoriamente la descripción detallada del paquete, rango de peso, la Declaración de Valor en USD, así como el nombre completo y número telefónico del <strong>Destinatario Final</strong> (un tercero ajeno a la plataforma cuyos datos son provistos por el remitente bajo su responsabilidad).</li>
                </ul>

                <h3 className="text-base font-bold text-white mt-4">1.2 Información que recopilamos automáticamente</h3>
                <ul className="list-disc list-outside space-y-2 ml-5">
                    <li><strong>Ubicación precisa en tiempo real (GPS):</strong> recopilamos las coordenadas geográficas precisas de los usuarios durante la solicitud y ejecución de servicios. Para los Conductores, recopilamos la <strong>ubicación en segundo plano</strong> de forma continua mientras su estado sea "En Línea", incluso si la aplicación está cerrada o minimizada, para permitir la asignación eficiente de rutas y el tracking en tiempo real.</li>
                    <li><strong>Pruebas de Entrega Fotográficas (POD — Proof of Delivery):</strong> recopilamos imágenes capturadas por la cámara del Conductor en dos hitos obligatorios del envío: al momento de recibir la mercancía (<em>Photo POD Pickup</em>) y al momento de entregarla al destinatario (<em>Photo POD Delivery</em>). Estas imágenes se almacenan en un bucket privado de storage asociado al ID del servicio.</li>
                    <li><strong>Datos de Auditoría de Aceptación:</strong> registramos electrónicamente cada hito crítico (registro, solicitudes, confirmación de pagos o renovación de membresías) en la tabla <code className="bg-white/10 px-1.5 py-0.5 rounded text-emerald-300 text-xs">terms_acceptances</code>, guardando el ID de usuario, la versión de los términos aceptados, la dirección IP y el timestamp del servidor.</li>
                </ul>

                {/* 2 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    2 · Cómo usamos tu información
                </h2>
                <p>Utilizamos la información recopilada para las siguientes finalidades:</p>
                <ul className="list-disc list-outside space-y-2 ml-5">
                    <li>Operar la plataforma de intermediación, enlazar solicitudes, calcular estimaciones de ruta con la API de Google Maps e implementar sugerencias geográficas mediante procesamiento inteligente (Google Gemini AI).</li>
                    <li>Validar de manera automatizada en tiempo real la vigencia y pago de las membresías de los conductores vía conciliación bancaria en el módulo <strong>Higo Pay</strong>.</li>
                    <li>Proveer <em>tracking links</em> públicos y temporales para que terceros (destinatarios de e-commerce) puedan auditar el estatus del envío en tiempo real sin necesidad de estar registrados en la app.</li>
                    <li>Monitorear y auditar el cumplimiento del servicio de mensajería mediante las marcas de tiempo granulares (<code className="bg-white/10 px-1 py-0.5 rounded text-emerald-300 text-xs">picked_up_at</code>, <code className="bg-white/10 px-1 py-0.5 rounded text-emerald-300 text-xs">arrived_at_dropoff_at</code>, <code className="bg-white/10 px-1 py-0.5 rounded text-emerald-300 text-xs">delivered_at</code>).</li>
                    <li>Aplicar suspensiones definitivas (baneos) a conductores que violen las políticas de seguridad o retengan mercancías de forma indebida.</li>
                </ul>

                {/* 3 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    3 · Compartición de datos y levantamiento de confidencialidad (Handoff Legal)
                </h2>
                <p>No vendemos tus datos personales bajo ninguna circunstancia. La información se comparte exclusivamente bajo las siguientes condiciones:</p>
                <p><strong>3.1 Entre partes del servicio:</strong> el Pasajero/Remitente ve el nombre, foto, calificación, placas del vehículo y ubicación en tiempo real del Conductor. El Conductor ve los nombres y teléfonos de contacto del remitente y del destinatario final para coordinar la entrega.</p>
                <p><strong>3.2 Cláusula de Handoff Legal ante Disputas:</strong> de conformidad con nuestros Términos y Condiciones, en caso de que un Usuario Remitente abra un reclamo formal por daño, pérdida grave o presunta apropiación indebida de un paquete y el equipo de operaciones de HIGO dictamine el caso a favor del remitente, <strong>HIGO levantará la confidencialidad de los datos y transmitirá de forma expresa y detallada al remitente los datos identificatorios del Conductor involucrado</strong> (cédula de identidad, nombre completo, teléfono, dirección y placas del vehículo) a través del endpoint <code className="bg-white/10 px-1.5 py-0.5 rounded text-emerald-300 text-xs">send-claim-resolution-email.php</code>. Esto se realiza con el único fin de que el afectado pueda ejercer las acciones legales directas ante las autoridades policiales, civiles o penales competentes.</p>
                <p><strong>3.3 Proveedores de infraestructura tecnológica:</strong> compartimos datos bajo estrictos contratos de tratamiento con Supabase (base de datos y autenticación), Firebase (notificaciones push) y Google Cloud Platform (servicios de mapas e IA).</p>

                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 my-4 text-sm text-red-200 leading-relaxed">
                    <strong className="text-white">Importante:</strong> el levantamiento de confidencialidad descrito en 3.2 se ejecuta una sola vez, vía email firmado por el equipo de Legal de HIGO, y queda auditado con timestamp en la tabla <code className="bg-white/10 px-1.5 py-0.5 rounded text-emerald-300 text-xs">delivery_claims</code>. HIGO no es parte del proceso legal subsiguiente entre el remitente y el conductor.
                </div>

                {/* 4 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    4 · Permisos requeridos en el dispositivo
                </h2>
                <p>Para el funcionamiento correcto de Higo App bajo Capacitor, solicitamos acceso a:</p>
                <ul className="list-disc list-outside space-y-2 ml-5">
                    <li><strong>Ubicación exacta (Siempre / En segundo plano):</strong> esencial para la navegación y la asignación de viajes.</li>
                    <li><strong>Cámara (<code className="bg-white/10 px-1 py-0.5 rounded text-emerald-300 text-xs">capture="environment"</code>):</strong> obligatorio para que los conductores capturen las fotos de Prueba de Entrega (POD) en el sitio de recogida y destino.</li>
                    <li><strong>Almacenamiento / Galería:</strong> para cargar documentos de identidad del conductor durante el registro.</li>
                    <li><strong>Notificaciones Push:</strong> para alertas críticas de asignación y cambios de estado del viaje.</li>
                </ul>

                {/* 5 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    5 · Retención y seguridad de los datos
                </h2>
                <p>
                    Los datos personales y los registros de las transacciones se conservan en
                    servidores cifrados bajo protocolos TLS durante el tiempo que la cuenta
                    permanezca activa y por un lapso de hasta <strong>dos (2) años</strong>
                    posteriores al cierre de la misma para cumplir con obligaciones legales,
                    auditorías fiscales y registros probatorios ante disputas. Las fotos POD
                    almacenadas en el bucket privado cuentan con políticas RLS que limitan su
                    lectura estrictamente al emisor, receptor y administradores autorizados.
                </p>

                {/* 6 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    6 · Contacto y ejercicio de derechos
                </h2>
                <p>
                    Usted puede ejercer sus derechos de acceso, rectificación, supresión o
                    revocación de consentimiento escribiendo directamente a nuestros canales
                    oficiales de atención:
                </p>
                <ul className="list-disc list-outside space-y-2 ml-5">
                    <li><strong>Correo Electrónico:</strong> <a href="mailto:legal@higodriver.com" className="text-emerald-400">legal@higodriver.com</a> / <a href="mailto:soporte@higodriver.com" className="text-emerald-400">soporte@higodriver.com</a></li>
                    <li><strong>Canal de Soporte WhatsApp:</strong> <a href="https://wa.me/584120330315" className="text-emerald-400" target="_blank" rel="noopener noreferrer">+58 412 033 0315</a></li>
                    <li><strong>Domicilio Web:</strong> <a href="https://higodriver.com/" className="text-emerald-400" target="_blank" rel="noopener noreferrer">higodriver.com</a></li>
                </ul>
            </section>

            <p className="text-xs text-gray-500 mt-12 leading-relaxed border-t border-white/10 pt-5">
                Higo Inc. (Delaware, EE. UU.) · Higo C.A. (Venezuela) · Plataforma tecnológica de
                intermediación. HIGO se reserva el derecho de actualizar esta Política de
                Privacidad en cualquier momento; los cambios se notificarán al Usuario en su
                próximo acceso o transacción, requiriendo nueva aceptación. Las versiones
                anteriores permanecen archivadas para referencia legal.
            </p>
            <p className="text-xs text-gray-500 mt-3">
                Documento relacionado: <Link to="/terms/envios" className="text-emerald-400">Términos y Condiciones</Link>.
            </p>
        </div>
    </div>
);

export default PrivacyPage;
