from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}\n"
            f"--- needle ---\n{old}"
        )
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Higo Pay: maxLength=6 truncates pasted content in the browser before React's
# onChange sees it, so the normalizer receives the first six digits. Omit that
# native limit for Pago Móvil and normalize the raw clipboard value explicitly.
replace_once(
    "src/pages/HigoPayPage.jsx",
    "    const referenceMaxLength = isPagoMovil ? 6 : 12;\n",
    "    const referenceMaxLength = isPagoMovil ? undefined : 12;\n",
)

replace_once(
    "src/pages/HigoPayPage.jsx",
    """                      onChange={(event) => setReference(isPagoMovil
                          ? normalizeBanescoReference(event.target.value)
                          : normalizeTransferReference(event.target.value))}
                      inputMode="numeric"
                      maxLength={referenceMaxLength}
""",
    """                      onChange={(event) => setReference(isPagoMovil
                          ? normalizeBanescoReference(event.target.value)
                          : normalizeTransferReference(event.target.value))}
                      onPaste={(event) => {
                          const pasted = event.clipboardData?.getData('text') || '';
                          if (!pasted) return;
                          event.preventDefault();
                          setReference(isPagoMovil
                              ? normalizeBanescoReference(pasted)
                              : normalizeTransferReference(pasted));
                      }}
                      inputMode="numeric"
                      maxLength={referenceMaxLength}
""",
)


# Higo Viajes: prefer the best persisted/snapshotted value and recover the
# narrow historical case where only the multiplied total survived.
replace_once(
    "src/pages/AdminRidesPage.jsx",
    "import { supabase } from '../services/supabase';\n",
    "import { supabase } from '../services/supabase';\n"
    "import { resolveEffectiveRideMultiplier } from '../utils/pricingPresentation';\n",
)

replace_once(
    "src/pages/AdminRidesPage.jsx",
    """                            const pricing = detail.pricing || {};
                            const snapshot = pricing.snapshot || {};
                            const route = detail.route || {};
""",
    """                            const pricing = detail.pricing || {};
                            const snapshot = pricing.snapshot || {};
                            const multiplier = resolveEffectiveRideMultiplier({ pricing, snapshot });
                            const route = detail.route || {};
""",
)

replace_once(
    "src/pages/AdminRidesPage.jsx",
    """<Row label="Multiplicador" value={`${Number(pricing.multiplier ?? snapshot.surgeMultiplier ?? 1).toFixed(3)} · ${pricing.multiplierReason ?? snapshot.multiplierReason ?? 'tarifa_normal'}`} />""",
    """<Row label="Multiplicador" value={`${multiplier.value.toFixed(3)} · ${multiplier.reason}`} />""",
)
