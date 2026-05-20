import React from 'react';
import { Link } from 'react-router-dom';

// Versión vigente de los T&C. Cuando cambie el texto, bumpear acá y
// también en src/components/DeliveryFormSteps.jsx (TERMS_VERSION_DELIVERY)
// para forzar nueva aceptación en el próximo envío.
export const TERMS_VERSION = '2026-05-19';

const TermsOfDeliveryPage = () => (
    <div className="min-h-screen bg-[#0a101f] text-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
            <Link to="/" className="text-emerald-400 text-sm mb-6 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Volver
            </Link>

            <h1 className="text-3xl font-extrabold mb-1">Términos y Condiciones de Uso de la Plataforma Higo</h1>
            <p className="text-gray-400 text-sm mb-2"><strong>Última actualización:</strong> Mayo 2026 · Versión {TERMS_VERSION}</p>
            <hr className="border-white/10 mb-8" />

            <section className="space-y-5 leading-relaxed text-gray-200 text-[15px]">
                <p>
                    Los presentes Términos y Condiciones (en adelante, "T&amp;C") regulan el acceso y uso
                    de la plataforma tecnológica, aplicaciones móviles y sitios web (en adelante,
                    "la Plataforma") propiedad de <strong>Higo Inc.</strong> (Delaware, EE. UU.) y
                    operada localmente en la República Bolivariana de Venezuela por su filial
                    <strong> Higo C.A.</strong> (en adelante, conjuntamente denominadas "HIGO").
                </p>
                <p>
                    Al registrarse, acceder o utilizar la Plataforma en cualquiera de sus verticales
                    (<em>Higo Moto, Higo Carro, Higo Camioneta, Higo Envíos o Higo Mandado</em>), tanto
                    en el rol de pasajero/remitente (en adelante, "Usuario") como en el de
                    conductor/proveedor (en adelante, "Conductor"), usted acepta de manera expresa,
                    incondicional e irrevocable la totalidad de las cláusulas aquí descritas.
                </p>

                {/* SECCIÓN 1 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 1 · Naturaleza de la Plataforma y exclusión de responsabilidad
                </h2>
                <p><strong>1.1 Modelo de Intermediación:</strong> HIGO es única y exclusivamente una empresa de base tecnológica. La Plataforma funciona como un mercado e intermediario digital que conecta a Usuarios que requieren servicios de movilidad o logística con Conductores privados que actúan como contratistas independientes.</p>
                <p><strong>1.2 Ausencia de Relación Laboral:</strong> Los Conductores NO son empleados, agentes ni trabajadores de HIGO. Cada Conductor opera de forma autónoma, con sus propios medios y bajo su propio riesgo.</p>
                <p><strong>1.3 Exclusión de Responsabilidad:</strong> HIGO no asume ninguna responsabilidad por daños materiales, lesiones personales, fallecimientos, accidentes de tránsito, pérdidas, robos o cualquier otra eventualidad civil o penal que ocurra durante la prestación del servicio.</p>

                {/* SECCIÓN 2 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 2 · Modelo comercial, membresías y pagos (Higo Pay)
                </h2>
                <p><strong>2.1 Ausencia de Comisión por Viaje:</strong> HIGO NO percibe comisiones ni retiene porcentajes sobre el valor de las carreras o servicios de entrega realizados. El Conductor retiene el 100% de la tarifa cobrada.</p>
                <p><strong>2.2 Membresía SaaS Flat:</strong> El Conductor accede al uso de la Plataforma mediante el pago de una suscripción fija mensual gestionada a través del módulo Higo Pay.</p>
                <p><strong>2.3 Automatización de Membresías:</strong> El procesamiento y validación se ejecutan de manera automática en tiempo real a través de canales de conciliación bancaria (API). Si el Conductor no efectúa el pago, el sistema modificará de forma automática su estado a "Desconectado/Inactivo" de manera inmediata.</p>
                <p><strong>2.4 Mecanismo de Pago Directo:</strong> El Usuario efectúa el Pago Móvil o transferencia directamente a los datos bancarios del Conductor al finalizar el viaje. HIGO no custodia ni procesa el flujo de dinero de las carreras.</p>

                {/* SECCIÓN 3 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 3 · Condiciones particulares de "Higo Envíos"
                </h2>
                <p><strong>3.1 Naturaleza de la vertical:</strong> HIGO no opera como un servicio de courier, encomiendas ni transportista de carga. HIGO provee únicamente la intermediación tecnológica.</p>
                <p><strong>3.2 Declaración de Valor Obligatoria:</strong> El Usuario Remitente está obligado a declarar el valor comercial real de la mercancía (en USD) antes de confirmar la solicitud. Esta declaración tiene fines estrictamente de auditoría técnica y registro probatorio interno. <strong>No constituye una póliza de seguro</strong>, ni obliga a HIGO a indemnizar o reembolsar dicho valor bajo ningún concepto.</p>
                <p><strong>3.3 Prueba de Entrega Fotográfica (POD):</strong> El Conductor debe obligatoriamente capturar una fotografía del paquete al momento de la recogida (Photo POD Pickup) y otra al momento de la entrega (Photo POD Delivery) utilizando la cámara integrada. El flujo técnico no avanzará ni se completará sin la carga exitosa de estas evidencias.</p>
                <p><strong>3.4 Cobro Contra Entrega (COD):</strong> En envíos bajo la modalidad de Cobro Contra Entrega (COD), el Conductor recibe en efectivo el valor de la mercadería pagado por el destinatario. HIGO audita el hito pero no recibe ni se responsabiliza por dicho efectivo. El Remitente y el Conductor asumen de forma exclusiva el riesgo y la logística de entrega de dicho dinero fuera de la app.</p>

                {/* SECCIÓN 4 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 4 · Mercancía prohibida en envíos
                </h2>
                <p>Queda terminantemente prohibido utilizar la vertical de Higo Envíos o Higo Mandado para transportar:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Dinero en efectivo, títulos valores, divisas, metales preciosos o joyería.</li>
                    <li>Armas de fuego, municiones, explosivos, químicos reactivos o material inflamable.</li>
                    <li>Sustancias estupefacientes, psicotrópicas o elementos penados por la Ley Orgánica de Drogas.</li>
                    <li>Animales vivos.</li>
                    <li>Medicamentos o alimentos perecederos que requieran refrigeración estricta (salvo vehículos validados por la app con el <em>tag</em> correspondiente).</li>
                    <li>Paquetes que excedan los límites técnicos por vehículo (<strong>Moto:</strong> ≤5 kg · <strong>Estándar:</strong> ≤25 kg · <strong>Van/Camioneta:</strong> ≤50 kg).</li>
                </ol>

                {/* SECCIÓN 5 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 5 · Resolución de disputas, reclamos y handoff legal
                </h2>
                <p><strong>5.1 Plazo para Reclamos:</strong> El Usuario dispone de un plazo máximo de 48 horas continuas posteriores a la finalización de un viaje o envío para reportar cualquier anomalía desde el historial de la app.</p>
                <p><strong>5.2 Política Estricta de Reembolso (Caja Cero):</strong> HIGO no realiza reembolsos, no emite dinero en efectivo ni otorga compensaciones financieras con fondos propios ante pérdidas o daños de mercancía o equipaje.</p>
                <p><strong>5.3 Sanción de Baneo Definitivo:</strong> Si se comprueba negligencia grave, dolo o apropiación indebida por parte del Conductor, HIGO aplicará una penalización de suspensión inmediata, permanente e irreversible de la cuenta del Conductor.</p>
                <p><strong>5.4 Handoff Legal de Datos:</strong> Una vez emitido el dictamen técnico, HIGO enviará al correo electrónico del Usuario afectado un informe de resolución con los datos identificatorios del Conductor sancionado (nombre completo, cédula, teléfono y placas/datos del vehículo). El Usuario acepta que su único derecho y vía de resarcimiento económico es ejercer las acciones civiles o denuncias penales correspondientes <strong>directamente contra el Conductor</strong>.</p>

                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 my-4 text-sm text-red-200 leading-relaxed">
                    <strong className="text-white">Importante:</strong> HIGO actúa exclusivamente como facilitador tecnológico de información identificatoria del Conductor sancionado. HIGO no es parte, garante, codemandado ni responsable solidario en ningún proceso civil o penal derivado del servicio prestado.
                </div>

                {/* SECCIÓN 6 */}
                <h2 className="text-xl font-bold text-white mt-8 mb-1 pt-4 border-t border-white/10">
                    Sección 6 · Propiedad intelectual y auditoría de aceptación
                </h2>
                <p><strong>6.1 Propiedad del Software:</strong> Todo el código fuente, algoritmos, marcas, logotipos e interfaces asociadas a Higo App, Higo Pay, Higo Envíos y el dominio <em>higodriver.com</em> son de la exclusiva propiedad de Higo Inc.</p>
                <p><strong>6.2 Registro de Consentimiento:</strong> Cada acción crítica en la app guarda un registro electrónico indexado (<code className="bg-white/10 px-1.5 py-0.5 rounded text-emerald-300 text-xs">terms_acceptances</code>) con el ID del usuario, versión de los T&amp;C, IP y timestamp del servidor, sirviendo como prueba plena de aceptación.</p>
            </section>

            <p className="text-xs text-gray-500 mt-12 leading-relaxed border-t border-white/10 pt-5">
                Higo Inc. (Delaware, EE. UU.) · Higo C.A. (Venezuela) · Plataforma tecnológica de intermediación.
                Para consultas legales: <a href="mailto:legal@higoapp.com" className="text-emerald-400">legal@higoapp.com</a>
                · Soporte: <a href="mailto:soporte@higoapp.com" className="text-emerald-400">soporte@higoapp.com</a>.
                HIGO se reserva el derecho de actualizar estos T&amp;C en cualquier momento; los cambios se
                notificarán al Usuario en su próximo acceso o transacción, requiriendo nueva aceptación.
                Las versiones anteriores permanecen archivadas para referencia legal.
            </p>
        </div>
    </div>
);

export default TermsOfDeliveryPage;
