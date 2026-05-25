import { forwardRef } from 'react';
import './Card.css';

/**
 * Higo Shop — Card
 *
 * @param {'sm'|'md'|'lg'} padding
 * @param {boolean}        hoverable – lift on hover
 */
export const Card = forwardRef(function Card(
  {
    children,
    className = '',
    onClick,
    hoverable = false,
    padding = 'md',
    ...rest
  },
  ref,
) {
  const classes = [
    'higo-card',
    `higo-card--pad-${padding}`,
    hoverable && 'higo-card--hoverable',
    onClick && !hoverable && 'higo-card--clickable',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </div>
  );
});
