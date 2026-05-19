<?php
// ═══════════════════════════════════════════════════════════════════════
// Plantilla de config SMTP. Copiala a _smtp_config.php y llenala con
// las credenciales reales de tu mailbox Hostinger. _smtp_config.php
// está gitignored — nunca llega al repo.
//
// Subila al VPS a mano via Hostinger File Manager → public_html/api/
// (o por FTP). Una sola vez, no se borra en cada deploy porque el
// mirror la respeta (no está en la fuente, así que lftp no la toca).
// ═══════════════════════════════════════════════════════════════════════

return [
    // smtp.hostinger.com (mail server compartido para todos los dominios
    // hosteados ahí). Confirmable en hPanel → Emails → Configure desktop.
    'host'       => 'smtp.hostinger.com',

    // 465 = SSL implícito (recomendado), 587 = STARTTLS.
    'port'       => 465,

    // Usuario = el mailbox completo (con @dominio.com).
    'username'   => 'admin@higodriver.com',

    // Password del mailbox. Generala/reseteala en hPanel → Emails →
    // Manage → Change password si no la recordás.
    'password'   => 'REEMPLAZAR_CON_PASSWORD_REAL',

    // Address desde la que se ve enviado el correo. Tiene que matchear
    // el username (Hostinger no deja firmar como otro mailbox).
    'from_email' => 'admin@higodriver.com',

    // Display name opcional.
    'from_name'  => 'Higo Driver',

    // Hostname para el saludo EHLO. Opcional, default 'higodriver.com'.
    // 'ehlo'    => 'higodriver.com',
];
