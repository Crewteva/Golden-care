import Icon from './Icon'

export default function Button({
  variant = 'primary',
  size,
  block,
  loading,
  icon,
  iconEnd,
  className = '',
  children,
  type = 'button',
  disabled,
  ...rest
}) {
  const classes = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={18} />}
      {children}
      {iconEnd && !loading && <Icon name={iconEnd} size={18} />}
    </button>
  )
}
