import { forwardRef } from 'react';
import './Button.css';

/**
 * Higo Shop — Button
 *
 * @param {'primary'|'secondary'|'ghost'|'danger'} variant
 * @param {'sm'|'md'|'lg'} size
 * @param {boolean} loading   – shows a spinner and disables interaction
 * @param {boolean} fullWidth – stretches to 100 %
 * @param {React.ReactNode} icon – optional leading icon element
 */
export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    children,
    disabled = false,
    loading = false,
    fullWidth = false,
    icon,
    className = '',
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = [
    'higo-btn',
    `higo-btn--${variant}`,
    `higo-btn--${size}`,
    fullWidth && 'higo-btn--full-width',
    loading && 'higo-btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="higo-btn__spinner" />}
      {icon && <span className="higo-btn__icon">{icon}</span>}
      {children}
    </button>
  );
});
