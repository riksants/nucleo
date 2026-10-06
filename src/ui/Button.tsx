import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-[0.96] disabled:bg-accent/40 disabled:text-on-accent/60',
  secondary: 'bg-raised text-ink border border-line hover:bg-elevated',
  ghost: 'text-soft hover:text-ink hover:bg-tint/[0.04]',
  danger: 'bg-expense/12 text-expense hover:bg-expense/20',
}

const SIZES: Record<Size, string> = {
  md: 'h-11 px-5 text-[15px] rounded-full',
  lg: 'h-14 px-6 text-base rounded-full',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  block?: boolean
}

export function Button({ variant = 'primary', size = 'md', icon, block, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`press inline-flex items-center justify-center gap-2 font-semibold select-none disabled:pointer-events-none ${VARIANTS[variant]} ${SIZES[size]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'plain' | 'raised' | 'accent'
  size?: 'sm' | 'md'
}

const ICON_TONES = {
  plain: 'text-soft hover:text-ink hover:bg-tint/[0.05]',
  raised: 'bg-raised border border-line text-ink hover:bg-elevated',
  accent: 'bg-accent text-on-accent hover:brightness-[0.96]',
}

export function IconButton({ label, tone = 'plain', size = 'md', className = '', children, ...rest }: IconButtonProps) {
  const dims = size === 'sm' ? 'size-9 rounded-full' : 'size-11 rounded-full'
  return (
    <button type="button" aria-label={label} title={label} className={`press hit relative grid place-items-center shrink-0 ${dims} ${ICON_TONES[tone]} ${className}`} {...rest}>
      {children}
    </button>
  )
}
