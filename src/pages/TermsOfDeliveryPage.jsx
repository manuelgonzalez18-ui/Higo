import React from 'react';
import { Link } from 'react-router-dom';

export const TERMS_VERSION = '2026-05-19';

const TermsOfDeliveryPage = () => (
    <div className="min-h-screen bg-[#0a101f] text-white">
        <div className="max-w-3xl mx-auto px-6 py-12">
            <Link to="/" className="text-emerald-400 text-sm mb-6 inline-flex items-center gap-1">
                <span className="material-symbols-outlined text-base">arrow_back</span>
                Volver
            </Link>

            <h1 className="text-3xl font-extrabold mb-2">Términos y Condiciones de Higo Envíos</h1>
            <p className="text-gray-400 text-sm mb-8">Versión {TERMS_VERSION}</p>

            <section className="space-y-6 leading-relaxed text-gray-200">
                <div>
                    <h2 className="text-xl font-bold text-white mb-2">1. Naturaleza del servicio</h2>
                    <p>
                        Higo es una <strong>plataforma tecnológica de intermediación</strong> que conecta
                        remitentes con choferes independientes que ofrecen servicios de transporte de
                        encomiendas. Higo <strong>no es transportista, no es operador logístico y no es
                        aseguradora</strong>. Higo no opera flota propia ni almacena, manipula o asegura
                        mercadería en ningún momento.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">2. Rol del chofer</h2>
                    <p>
                        El chofer es un <strong>contratista independiente</strong>. Al aceptar un envío,
                        asume bajo su exclusiva responsabilidad el cuidado, integridad y entrega de la
                        mercadería desde el momento del pickup hasta el momento de la entrega al destinatario.
                        Higo verifica documentación inicial del chofer (cédula, licencia, RCV, vehículo,
                        certificado de salud, certificado de circulación) pero no audita continuamente.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">3. Declaración de valor</h2>
                    <p>
                        El remitente declara obligatoriamente el valor en USD de la mercadería al
                        confirmar el envío. Esta declaración:
                    </p>
                    <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                        <li>Sirve para auditoría interna y resolución de reclamos.</li>
                        <li>Queda registrada con timestamp y versión de los presentes T&C aceptados.</li>
                        <li><strong>No constituye póliza de seguro</strong> ni obliga a Higo a indemnizar
                            por dicho monto.</li>
                        <li>Puede usarse como prueba documental en procesos legales civiles o penales
                            entre el remitente y el chofer.</li>
                    </ul>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">4. Mercadería prohibida</h2>
                    <p>El remitente declara <strong>bajo juramento</strong> que el paquete no contiene:</p>
                    <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                        <li>Armas, municiones o explosivos.</li>
                        <li>Drogas o sustancias controladas.</li>
                        <li>Líquidos inflamables, combustibles, ácidos.</li>
                        <li>Animales vivos.</li>
                        <li>Perecederos sin refrigeración.</li>
                        <li>Cualquier bien cuyo transporte esté prohibido por la legislación vigente.</li>
                    </ul>
                    <p className="mt-2">
                        Higo no inspecciona el contenido de los paquetes. La responsabilidad por el
                        contenido es exclusivamente del remitente.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">5. Reclamos por daño, pérdida o no-entrega</h2>
                    <p>
                        El remitente puede abrir un reclamo dentro de las <strong>48 horas siguientes</strong>
                        a la entrega registrada en plataforma (o a la hora estimada de entrega si no fue
                        entregado). El reclamo debe incluir descripción detallada y evidencia fotográfica
                        cuando aplique.
                    </p>
                    <p className="mt-2">
                        Higo investiga el reclamo revisando las fotos de prueba de entrega (POD) registradas
                        por el chofer en pickup y delivery, los timestamps de la app, comunicaciones
                        archivadas y la evidencia aportada por el remitente.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">6. Resoluciones posibles</h2>
                    <p><strong>6.1 Probado a favor del remitente:</strong></p>
                    <ul className="list-disc list-inside ml-2 mt-2 space-y-1">
                        <li>El chofer queda suspendido de la plataforma. No podrá ponerse online ni
                            renovar membresía hasta que se resuelva su situación.</li>
                        <li>Higo entrega al remitente los <strong>datos identificatorios del chofer</strong>
                            (cédula, nombre completo, teléfono registrado, placa del vehículo) para que el
                            remitente pueda proceder por la vía civil o penal que estime conveniente.</li>
                        <li>Higo se reserva el derecho de cooperar con autoridades competentes ante
                            requerimientos judiciales formales.</li>
                    </ul>
                    <p className="mt-2"><strong>6.2 Rechazado:</strong> el reclamo no procede (evidencia POD
                        muestra entrega conforme, claim fuera de plazo, evidencia insuficiente, etc.).</p>
                    <p className="mt-2"><strong>6.3 Inconcluso:</strong> si en 30 días no hay evidencia
                        concluyente, el claim se cierra como rechazado.</p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">7. Limitación de responsabilidad de Higo</h2>
                    <p>
                        Higo <strong>NO indemniza con dinero propio</strong> al remitente por daño,
                        pérdida, robo, o no-entrega de la mercadería. La compensación económica al
                        remitente, si corresponde, surge del proceso legal directo entre remitente y chofer
                        responsable. Higo cumple su rol facilitando los datos identificatorios y la evidencia
                        documental disponible en plataforma.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">8. Cobro Contra Entrega (COD)</h2>
                    <p>
                        Cuando el remitente activa COD, el chofer cobra en efectivo al destinatario el
                        monto declarado, adicional al precio del envío. Ese efectivo queda con el chofer
                        y la relación de cobro es entre remitente y chofer. Higo solo audita el monto y el
                        estado (cobrado / no cobrado) como dato de la operación; no actúa como custodio,
                        depositario ni cobrador del COD.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">9. Aceptación y vigencia</h2>
                    <p>
                        Al marcar la casilla "Acepto los Términos y Condiciones de Envíos" en la
                        confirmación del envío, el remitente declara haber leído, comprendido y aceptado
                        íntegramente este documento en su versión vigente al momento del envío. La
                        aceptación queda registrada con timestamp e IP a efectos probatorios.
                    </p>
                </div>

                <div>
                    <h2 className="text-xl font-bold text-white mb-2">10. Contacto</h2>
                    <p>
                        Soporte: <a href="mailto:soporte@higoapp.com" className="text-emerald-400">soporte@higoapp.com</a> ·
                        Legal: <a href="mailto:legal@higoapp.com" className="text-emerald-400">legal@higoapp.com</a>
                    </p>
                </div>
            </section>

            <p className="text-xs text-gray-500 mt-12 leading-relaxed">
                Higo se reserva el derecho de actualizar estos T&C en cualquier momento. Los cambios
                se notificarán al usuario en el momento de su próximo envío, requiriendo nueva
                aceptación. Las versiones anteriores permanecen archivadas para referencia legal.
            </p>
        </div>
    </div>
);

export default TermsOfDeliveryPage;
