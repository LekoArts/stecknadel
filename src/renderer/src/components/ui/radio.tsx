import { cn } from '@renderer/lib/utils'
import type { ReactNode } from 'react'

/** A styled native radio with its label; group several with one `name` inside a `role="radiogroup"`. */
export function Radio({
  name,
  checked,
  onChange,
  disabled,
  className,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50',
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        className="grid size-4 shrink-0 cursor-pointer appearance-none place-content-center rounded-full border border-input shadow-xs outline-none transition-[border-width,border-color] checked:border-[5px] checked:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed dark:bg-input/30"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      {children}
    </label>
  )
}
