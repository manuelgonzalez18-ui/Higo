import { forwardRef, useState, useId } from 'react';
import './Input.css';

/**
 * Higo Shop — Input
 *
 * @param {string}          label       – floating label text
 * @param {string}          error       – error message (shown below)
 * @param {React.Component} icon        – lucide icon component (rendered as <Icon />)
 * @param {boolean}         disabled
 */
export const Input = forwardRef(function Input(
  {
    label,
    value,
    onChange,
    type = 'text',
    placeholder = ' ',
    error,
    icon: Icon,
    disabled = false,
    className = '',
    id: externalId,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const inputId = externalId || autoId;
  const [focused, setFocused] = useState(false);

  const wrapperClasses = [
    'higo-input__wrapper',
    focused && 'higo-input__wrapper--focused',
    error && 'higo-input__wrapper--error',
    disabled && 'higo-input__wrapper--disabled',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`higo-input ${className}`}>
      <div className={wrapperClasses}>
        {Icon && (
          <span className="higo-input__icon" aria-hidden="true">
            <Icon />
          </span>
        )}

        <div className="higo-input__field-container">
          <input
            ref={ref}
            id={inputId}
            type={type}
            className="higo-input__field"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            {...rest}
          />
          {label && (
            <label htmlFor={inputId} className="higo-input__label">
              {label}
            </label>
          )}
        </div>
      </div>

      {error && (
        <p id={`${inputId}-error`} className="higo-input__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
