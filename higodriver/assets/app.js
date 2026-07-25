(function () {
    'use strict';

    var API_ROOT = '/api';
    var started = false;

    function safeJson(response) {
        return response.text().then(function (text) {
            if (!text) return {};
            try { return JSON.parse(text); } catch (error) { return { ok: false, error: 'invalid_response' }; }
        });
    }

    function track(eventName, context) {
        var payload = JSON.stringify({ event: eventName, context: context || {}, page: document.body.dataset.page || 'unknown' });
        if (navigator.sendBeacon) {
            navigator.sendBeacon(API_ROOT + '/track.php', new Blob([payload], { type: 'application/json' }));
            return;
        }
        fetch(API_ROOT + '/track.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
        }).catch(function () {});
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'\"]/g, function (char) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '\"': '&quot;' }[char];
        });
    }

    function randomKey() {
        if (window.crypto && crypto.getRandomValues) {
            var bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return Array.prototype.map.call(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
        }
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function renderPlans(config) {
        var grid = document.getElementById('plansGrid');
        var note = document.getElementById('membershipNote');
        if (!grid) return;
        var plans = Array.isArray(config.plans) ? config.plans : [];
        if (note && config.membership_note) note.textContent = config.membership_note;
        if (!plans.length) {
            grid.innerHTML = '<div class="loading-card">Las modalidades vigentes se muestran dentro de Higo Pay.</div>';
            return;
        }
        grid.innerHTML = plans.map(function (plan) {
            var features = Array.isArray(plan.features) ? plan.features : [];
            return '<article class="plan-card' + (plan.featured ? ' is-featured' : '') + '">' +
                '<span class="plan-tag">' + escapeHtml(plan.tag || 'Modalidad') + '</span>' +
                '<h3>' + escapeHtml(plan.name) + '</h3>' +
                '<p>' + escapeHtml(plan.description || '') + '</p>' +
                '<div class="plan-price">' + escapeHtml(plan.price_label || 'Ver oferta vigente en Higo Pay') + '</div>' +
                '<ul>' + features.map(function (feature) { return '<li>' + escapeHtml(feature) + '</li>'; }).join('') + '</ul>' +
                '</article>';
        }).join('');
    }

    function loadPublicConfig() {
        return fetch(API_ROOT + '/public-config.php', { headers: { 'Accept': 'application/json' } })
            .then(function (response) { return safeJson(response); })
            .then(function (config) {
                renderPlans(config);
                var terms = document.getElementById('termsVersion');
                var privacy = document.getElementById('privacyVersion');
                if (terms && config.legal && config.legal.terms_version) terms.value = config.legal.terms_version;
                if (privacy && config.legal && config.legal.privacy_version) privacy.value = config.legal.privacy_version;
                return config;
            })
            .catch(function () { renderPlans({ plans: [] }); return {}; });
    }

    function currentStep(form) {
        var active = form.querySelector('.form-step.is-active');
        return active ? Number(active.dataset.step || 1) : 1;
    }

    function showStep(form, step) {
        var steps = form.querySelectorAll('.form-step');
        steps.forEach(function (item) {
            var active = Number(item.dataset.step) === step;
            item.hidden = !active;
            item.classList.toggle('is-active', active);
        });
        var progress = document.getElementById('progressFill');
        var text = document.getElementById('progressText');
        if (progress) progress.style.width = (step / steps.length * 100) + '%';
        if (text) text.textContent = 'Paso ' + step + ' de ' + steps.length;
        if (step === 3) renderReview(form);
        track('form_step', { step: String(step) });
    }

    function validateStep(form, step) {
        var container = form.querySelector('.form-step[data-step="' + step + '"]');
        if (!container) return true;
        var controls = container.querySelectorAll('input, select');
        var firstInvalid = null;
        controls.forEach(function (control) {
            control.removeAttribute('aria-invalid');
            if (!control.checkValidity() && !firstInvalid) firstInvalid = control;
        });
        if (firstInvalid) {
            firstInvalid.setAttribute('aria-invalid', 'true');
            firstInvalid.reportValidity();
            track('form_error', { error: 'client_validation', field: firstInvalid.name || 'unknown', step: String(step) });
            return false;
        }
        return true;
    }

    function renderReview(form) {
        var box = document.getElementById('reviewBox');
        if (!box) return;
        var fields = [
            ['Nombre', 'full_name'], ['Cédula', 'cedula'], ['Teléfono', 'phone'], ['Correo', 'email'],
            ['Ciudad', 'city'], ['Modalidad', 'vehicle_type'], ['Vehículo', 'vehicle_brand'],
            ['Modelo', 'vehicle_model'], ['Año', 'vehicle_year'], ['Color', 'vehicle_color'], ['Placa', 'license_plate']
        ];
        box.innerHTML = fields.map(function (entry) {
            var control = form.elements[entry[1]];
            var value = control ? control.value : '';
            if (entry[1] === 'vehicle_type' && control && control.selectedIndex >= 0) value = control.options[control.selectedIndex].text;
            if (!value) value = '—';
            return '<div class="review-item"><span>' + escapeHtml(entry[0]) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
        }).join('');
    }

    function setFormStatus(kind, html) {
        var status = document.getElementById('formStatus');
        if (!status) return;
        status.className = 'form-status is-visible ' + kind;
        status.innerHTML = html;
        status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function initRegistrationForm() {
        var form = document.getElementById('driverRegisterForm');
        if (!form) return;
        var submit = document.getElementById('submitBtn');
        var idempotency = document.getElementById('idempotencyKey');
        if (idempotency && !idempotency.value) idempotency.value = randomKey();

        form.addEventListener('input', function (event) {
            event.target.removeAttribute('aria-invalid');
            if (!started) { started = true; track('form_start', {}); }
        });

        form.querySelectorAll('.next-step').forEach(function (button) {
            button.addEventListener('click', function () {
                var step = currentStep(form);
                if (validateStep(form, step)) showStep(form, Math.min(step + 1, 3));
            });
        });
        form.querySelectorAll('.prev-step').forEach(function (button) {
            button.addEventListener('click', function () { showStep(form, Math.max(currentStep(form) - 1, 1)); });
        });

        var plate = form.elements.license_plate;
        if (plate) plate.addEventListener('input', function () { plate.value = plate.value.toUpperCase().replace(/\s+/g, ''); });
        var cedula = form.elements.cedula;
        if (cedula) cedula.addEventListener('input', function () { cedula.value = cedula.value.toUpperCase().replace(/\s+/g, ''); });

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (!validateStep(form, 3)) return;
            submit.disabled = true;
            var original = submit.textContent;
            submit.textContent = 'Enviando…';
            var data = new FormData(form);

            fetch(API_ROOT + '/register-driver.php', { method: 'POST', body: data })
                .then(function (response) { return safeJson(response).then(function (body) { return { response: response, body: body }; }); })
                .then(function (result) {
                    if (!result.response.ok || !result.body.ok) {
                        var code = result.body.error || 'request_failed';
                        var messages = {
                            missing_field: 'Falta completar un dato requerido.',
                            invalid_email: 'El correo electrónico no es válido.',
                            invalid_phone: 'El teléfono no tiene un formato válido.',
                            invalid_cedula: 'La cédula no tiene un formato válido.',
                            invalid_vehicle_type: 'Selecciona una modalidad válida.',
                            invalid_plate: 'La placa no tiene un formato válido.',
                            legal_acceptance_required: 'Debes aceptar los términos y la política de privacidad.',
                            legal_version_mismatch: 'La versión legal cambió. Recarga la página e intenta nuevamente.',
                            rate_limited: 'Has realizado varios intentos. Espera un minuto y vuelve a intentar.',
                            mail_failed: 'No pudimos entregar la solicitud al equipo. Intenta nuevamente en unos minutos.',
                            storage_failed: 'No pudimos guardar la solicitud. Intenta nuevamente.',
                            mail_config_missing: 'El servicio de correo no está disponible temporalmente.',
                            mail_config_invalid: 'El servicio de correo no está configurado correctamente.',
                            admin_integration_not_configured: 'La integración administrativa está en configuración. Intenta nuevamente en unos minutos.',
                            admin_sync_failed: 'No pudimos registrar la solicitud en el panel administrativo. Intenta nuevamente en unos minutos.'
                        };
                        track('form_error', { error: code, field: result.body.detail || '' });
                        throw new Error(messages[code] || 'No pudimos enviar la solicitud. Intenta nuevamente o contáctanos por WhatsApp.');
                    }
                    var applicationId = result.body.application_id;
                    var statusUrl = result.body.status_url || ('/status/?id=' + encodeURIComponent(applicationId));
                    localStorage.setItem('higo_driver_application', JSON.stringify({ id: applicationId, created_at: new Date().toISOString() }));
                    track('application_submitted', { vehicle_type: form.elements.vehicle_type.value, city: form.elements.city.value.slice(0, 40) });
                    setFormStatus('ok', '<strong>¡Pre-registro recibido!</strong><br>Guarda este código:<br><span class="application-code">' + escapeHtml(applicationId) + '</span><br><a href="' + escapeHtml(statusUrl) + '">Consultar estado de la solicitud →</a>');
                    form.reset();
                    if (idempotency) idempotency.value = randomKey();
                    showStep(form, 1);
                })
                .catch(function (error) { setFormStatus('err', escapeHtml(error.message || 'Error de red. Intenta nuevamente.')); })
                .finally(function () { submit.disabled = false; submit.textContent = original; });
        });
    }

    function initStatusForm() {
        var form = document.getElementById('applicationStatusForm');
        if (!form) return;
        var result = document.getElementById('statusResult');
        var params = new URLSearchParams(location.search);
        var id = params.get('id');
        if (id) form.elements.application_id.value = id.toUpperCase();
        try {
            var saved = JSON.parse(localStorage.getItem('higo_driver_application') || 'null');
            if (saved && !form.elements.application_id.value) form.elements.application_id.value = saved.id || '';
        } catch (error) {}

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            var original = button.textContent;
            button.textContent = 'Consultando…';
            result.className = 'status-result';
            var payload = new FormData(form);
            fetch(API_ROOT + '/application-status.php', { method: 'POST', body: payload })
                .then(function (response) { return safeJson(response).then(function (body) { return { response: response, body: body }; }); })
                .then(function (data) {
                    if (!data.response.ok || !data.body.ok) throw new Error(data.body.error === 'not_found' ? 'No encontramos una solicitud con esos datos.' : 'No pudimos consultar la solicitud.');
                    var status = data.body.status;
                    var stageMap = {
                        pending_delivery: 0,
                        delivery_failed: 0,
                        received: 0,
                        under_review: 1,
                        waitlist: 1,
                        rejected: 1,
                        documents_requested: 2,
                        documents_submitted: 2,
                        correction_requested: 2,
                        approved: 3,
                        converted: 4
                    };
                    var current = Object.prototype.hasOwnProperty.call(stageMap, status) ? stageMap[status] : 0;
                    var labels = ['Solicitud recibida', 'Revisión inicial', 'Verificación de documentos', 'Aprobación', 'Cuenta creada'];
                    var timeline = labels.map(function (label, index) { return '<li class="' + (index <= current ? 'is-done' : '') + '">' + escapeHtml(label) + '</li>'; }).join('');
                    result.innerHTML = '<div class="status-summary"><p class="eyebrow">' + escapeHtml(data.body.application_id) + '</p><h2>' + escapeHtml(data.body.status_label) + '</h2><p>' + escapeHtml(data.body.next_step) + '</p></div><ol class="timeline">' + timeline + '</ol>';
                    result.className = 'status-result is-visible';
                    track('status_lookup', { result: 'found', status: status });
                })
                .catch(function (error) {
                    result.innerHTML = '<div class="form-status is-visible err">' + escapeHtml(error.message) + '</div>';
                    result.className = 'status-result is-visible';
                    track('status_lookup', { result: 'not_found' });
                })
                .finally(function () { button.disabled = false; button.textContent = original; });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        track('page_view', { path: location.pathname });
        document.querySelectorAll('[data-track]').forEach(function (element) {
            element.addEventListener('click', function () { track(element.dataset.track, { placement: element.dataset.placement || '' }); });
        });
        loadPublicConfig();
        initRegistrationForm();
        initStatusForm();
    });
})();
