import { AdvancedMarker } from '@vis.gl/react-google-maps';

const PRESETS = {
  user: { emoji: '📍', bg: '#3B82F6', border: '#1D4ED8', size: 38 },
  store: { emoji: '🏪', bg: '#171E30', border: '#3B82F6', size: 38 },
  driver: { emoji: '🛵', bg: '#10B981', border: '#059669', size: 44 },
  restaurant: { emoji: '🫓', bg: '#171E30', border: '#3B82F6', size: 38 },
  pharmacy: { emoji: '💊', bg: '#171E30', border: '#3B82F6', size: 38 },
  bakery: { emoji: '🥐', bg: '#171E30', border: '#3B82F6', size: 38 },
  grocery: { emoji: '🛒', bg: '#171E30', border: '#3B82F6', size: 38 },
  cafe: { emoji: '☕', bg: '#171E30', border: '#3B82F6', size: 38 },
};

export function EmojiMarker({
  position,
  preset = 'store',
  onClick,
  bounce = false,
  zIndex,
  bearing,
}) {
  const cfg = PRESETS[preset] || PRESETS.store;
  const hasBearing = typeof bearing === 'number' && !isNaN(bearing);
  const haloSize = cfg.size + 18;

  return (
    <AdvancedMarker position={position} onClick={onClick} zIndex={zIndex}>
      <div
        style={{
          position: 'relative',
          width: haloSize,
          height: haloSize,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasBearing && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `rotate(${bearing}deg)`,
              transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                borderBottom: `10px solid ${cfg.border}`,
                filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55))',
              }}
            />
          </div>
        )}
        <div
          style={{
            width: cfg.size,
            height: cfg.size,
            borderRadius: '50%',
            background: cfg.bg,
            border: `2px solid ${cfg.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.round(cfg.size * 0.55),
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.55)',
            cursor: onClick ? 'pointer' : 'default',
            animation: bounce ? 'higo-marker-bounce 1.4s ease-in-out infinite' : undefined,
            transition: 'transform 0.2s ease',
          }}
        >
          {cfg.emoji}
        </div>
      </div>
    </AdvancedMarker>
  );
}
