import { useState, type ComponentType, type ReactNode } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'

export function CodevCopyableCommand({ command }: { command: string }): ReactNode {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px]">
      <span>
        <span className="text-emerald-400">$</span> {command}
      </span>
      <button
        aria-label="Copy command"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        type="button"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </div>
  )
}

export function CodevSurfaceToggle({
  label,
  note,
  checked,
  disabled,
  onChange
}: {
  label: string
  note?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}): ReactNode {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-emerald-500' : 'bg-muted-foreground/30',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={cn(
            'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'left-4' : 'left-0.5'
          )}
        />
      </button>
    </div>
  )
}

export function CodevStatusDot({ connected }: { connected: boolean }): ReactNode {
  return (
    <span
      className={cn(
        'size-1.5 rounded-full',
        connected ? 'bg-emerald-400' : 'bg-muted-foreground/50'
      )}
    />
  )
}

export function CodevFallbackRow({
  icon: Icon,
  title,
  description,
  connected,
  defaultOpen,
  children
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  description: string
  connected?: boolean
  defaultOpen?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <details className="group border-t border-border/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2.5 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
        {connected ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <CodevStatusDot connected />
            Connected
          </span>
        ) : null}
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 pb-3">{children}</div>
    </details>
  )
}
