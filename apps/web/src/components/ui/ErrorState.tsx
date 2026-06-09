import type { ReactNode } from 'react'
import { AlertOctagon, Lock } from 'lucide-react'
import type { ErrorEnvelope, ErrorCode } from '@godin-engine/contract'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Error state — inline alert with code-aware copy and a Retry affordance.
 *
 * Accepts an `ErrorEnvelope` (the contract's typed error) and renders copy keyed
 * to `error.code`. Note both `APPROVAL_REQUIRED` and `APPROVAL_DENIED` map to
 * HTTP 403 — the client distinguishes them by `error.code`, never by status.
 * The 403 / forbidden variant gets a distinct lock icon + non-retryable copy.
 */
export interface ErrorStateProps {
  /** The typed error envelope from the contract, when available. */
  error?: ErrorEnvelope
  /** Override the title (defaults to a code-aware string). */
  title?: ReactNode
  /** Retry handler — omitted (or hidden) for non-retryable errors like 403. */
  onRetry?: () => void
  className?: string
}

const FORBIDDEN_CODES: ReadonlySet<ErrorCode> = new Set([
  'APPROVAL_REQUIRED',
  'APPROVAL_DENIED',
])

interface Copy {
  title: string
  description: string
}

function copyForCode(code: ErrorCode | undefined): Copy {
  switch (code) {
    case 'APPROVAL_REQUIRED':
      return {
        title: 'Approval required',
        description:
          'This action needs an approval before it can run. Ask an approver to review the pending item.',
      }
    case 'APPROVAL_DENIED':
      return {
        title: 'Not allowed',
        description:
          'You don’t have permission to view or act on this. If you think this is wrong, contact your workspace admin.',
      }
    case 'QUOTA_EXCEEDED':
      return {
        title: 'Usage limit reached',
        description: 'This workspace has hit its current usage limit. Try again later.',
      }
    case 'SKILL_TIMEOUT':
      return {
        title: 'Timed out',
        description: 'The request took too long. Please try again.',
      }
    default:
      return {
        title: 'Something went wrong',
        description: 'We couldn’t load this. Please try again.',
      }
  }
}

export function ErrorState({ error, title, onRetry, className }: ErrorStateProps) {
  const isForbidden = error ? FORBIDDEN_CODES.has(error.code) : false
  const copy = copyForCode(error?.code)
  const Icon = isForbidden ? Lock : AlertOctagon
  // Honor the envelope's retryable flag; 403s are never retryable.
  const canRetry = !!onRetry && !isForbidden && (error?.retryable ?? true)

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-5 border border-[var(--status-fail-line)] ' +
          'bg-[var(--status-fail-bg)] px-6 py-12 text-center',
        className,
      )}
    >
      <span className="grid size-14 place-items-center border border-[var(--rule)] bg-[var(--surface)]">
        <Icon className="size-7 text-[var(--status-fail)]" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h2 className="font-serif text-2xl leading-tight text-[var(--foreground)]">
          {title ?? copy.title}
        </h2>
        <p className="mx-auto max-w-[48ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
          {error?.message ?? copy.description}
        </p>
      </div>
      {canRetry && (
        <Button onClick={onRetry} variant="secondary" size="sm">
          Try again
        </Button>
      )}
    </div>
  )
}
