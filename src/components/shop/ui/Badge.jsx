import './Badge.css';

/**
 * Higo Shop — Badge
 *
 * @param {'default'|'success'|'warning'|'error'|'info'|'blue'} variant
 * @param {'sm'|'md'} size
 */
export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}) {
  const classes = [
    'higo-badge',
    `higo-badge--${variant}`,
    `higo-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
