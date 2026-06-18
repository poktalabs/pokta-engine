import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ErrorEnvelope } from '@pokta-engine/contract'
import { ErrorState } from './ErrorState'

/**
 * The sign-out escape hatch (admin/error-UX). A persistent tenant-load failure that
 * "Try again" can't fix must not strand the user (the bug hit pre-#22: stuck on the
 * error screen, no recovery without clearing cookies). ErrorState now renders a Sign
 * out action whenever `onSignOut` is wired — including for non-retryable 403s where
 * "Try again" is intentionally hidden.
 */
describe('ErrorState — sign-out escape hatch', () => {
  it('renders Sign out when onSignOut is provided and invokes it on click', async () => {
    const onSignOut = vi.fn()
    render(<ErrorState title="Could not load your workspace" onRetry={() => {}} onSignOut={onSignOut} />)
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('shows BOTH Try again and Sign out for a retryable error', () => {
    render(<ErrorState onRetry={() => {}} onSignOut={() => {}} />)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('still offers Sign out when retry is hidden (forbidden 403 is non-retryable)', () => {
    const forbidden: ErrorEnvelope = { code: 'APPROVAL_DENIED', message: 'nope', retryable: false }
    render(<ErrorState error={forbidden} onRetry={() => {}} onSignOut={() => {}} />)
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('renders no action buttons when neither handler is given (unchanged baseline)', () => {
    const err: ErrorEnvelope = { code: 'SKILL_EXEC_ERROR', message: 'x', retryable: false }
    render(<ErrorState error={err} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
