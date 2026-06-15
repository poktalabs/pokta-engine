import { useEffect, useMemo, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { AlertTriangle, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react'
import type { InviteView, MemberRole } from '@godin-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  useInviteMember,
  useRevokeInvite,
  useTeam,
  useTenants,
} from '@/pages/settings/use-team'

/**
 * Settings → Team panel (admin-roles Wave B, §5) — ROLE-ADAPTIVE.
 *
 * COSMETIC over the Wave A role endpoints: every action is re-checked server-side
 * (a member who forces this open still gets a 403; a tenant-admin who POSTs
 * role=admin gets a 403). The panel adapts off `useTenantContext().role` +
 * `isSuperadmin` purely so the UI is honest about what the caller can do.
 *
 * Three variants:
 *   - MEMBER       → no management UI; one honest line.
 *   - TENANT-ADMIN → this tenant's team, the 5-seat cap (over-cap = amber warning),
 *                    a scannable roster (role pill + status tag + quiet Revoke with
 *                    a destructive confirm), an add row (member-only, disabled-with-
 *                    reason at cap), a warm empty state.
 *   - SUPERADMIN   → a tenant PICKER above + the same team view for the picked
 *                    tenant + a role TOGGLE on the add row (may grant admin) + a
 *                    "Platform" tag on their own row + last-admin guardrails.
 *
 * Matches the existing Settings panel design language: serif `<section>` heading,
 * hairline rules (`--rule`), the `--surface` card, lucide line icons, Button
 * variants. Badges + the cap warning carry icon+TEXT (never color-only).
 */

const SEAT_CAP = 5

/** Active (seat-consuming) invites — `revoked` rows don't count toward the cap. */
function seatCount(invites: InviteView[]): number {
  return invites.filter((i) => i.status !== 'revoked').length
}

/** Count of admins among the CURRENTLY-bound members (claimed invites with role admin). */
function adminCount(invites: InviteView[]): number {
  return invites.filter((i) => i.status === 'claimed' && i.role === 'admin').length
}

export function TeamPanel() {
  const { tenant, role, isSuperadmin } = useTenantContext()

  // MEMBER variant — no tenant to manage, no management UI. One honest line.
  if (role !== 'admin' && !isSuperadmin) {
    return (
      <section aria-labelledby="settings-team-heading" className="space-y-4">
        <TeamHeading />
        <div className="border border-[var(--rule)] bg-[var(--surface)] px-6 py-8">
          <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">
            You are on the {tenant?.name ?? 'workspace'} team. Contact an admin to
            manage members.
          </p>
        </div>
      </section>
    )
  }

  // ADMIN / SUPERADMIN — the manageable team view (own state machine).
  return <ManagedTeam isSuperadmin={isSuperadmin} />
}

function TeamHeading() {
  return (
    <div className="flex items-center gap-2">
      <Users className="size-5 text-[var(--accent-text)]" aria-hidden="true" />
      <h2
        id="settings-team-heading"
        className="font-serif text-xl leading-tight text-[var(--foreground)]"
      >
        Team
      </h2>
    </div>
  )
}

interface ManagedTeamProps {
  isSuperadmin: boolean
}

function ManagedTeam({ isSuperadmin }: ManagedTeamProps) {
  const { tenant } = useTenantContext()
  const { user } = usePrivy()
  const callerEmail = user?.email?.address ?? null

  // Superadmin picks which tenant to manage; default to the caller's own tenant.
  const tenantsQuery = useTenants(isSuperadmin)
  const [pickedTenantId, setPickedTenantId] = useState<string | null>(null)
  const activeTenantId = pickedTenantId ?? tenant?.id ?? null

  const team = useTeam(activeTenantId)
  const invites = team.data?.invites ?? []

  const seats = seatCount(invites)
  const atCap = seats >= SEAT_CAP
  const overCap = seats > SEAT_CAP
  const admins = adminCount(invites)

  return (
    <section aria-labelledby="settings-team-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TeamHeading />
        {/* DECISION 1 — the seat cap is ALWAYS visible in the header. */}
        {team.isSuccess && (
          <span
            className="font-funnel text-xs uppercase tracking-wide text-[var(--muted-foreground)]"
            data-testid="seat-cap"
          >
            {seats} / {SEAT_CAP} seats
          </span>
        )}
      </div>

      {/* SUPERADMIN — quiet tenant picker above the panel (DECISION 7: labeled select). */}
      {isSuperadmin && (
        <TenantPicker
          tenants={tenantsQuery.data?.tenants ?? []}
          loading={tenantsQuery.isPending}
          isError={tenantsQuery.isError}
          value={activeTenantId}
          onChange={setPickedTenantId}
        />
      )}

      {/* DECISION 1 — over-cap is an AMBER warning, not error-red (a managed state). */}
      {team.isSuccess && overCap && (
        <div
          role="status"
          className={cn(
            'flex items-start gap-3 border border-[var(--status-warn-line)] ',
            'bg-[var(--status-warn-bg)] px-4 py-3',
          )}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-[var(--status-warn)]"
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-[var(--foreground)]">
            Over your {SEAT_CAP}-seat limit. Revoke a pending invite to add someone.
          </p>
        </div>
      )}

      {team.isPending && activeTenantId ? (
        <LoadingState label="Loading your team…" />
      ) : team.isError ? (
        <ErrorState
          error={team.error instanceof ApiError ? team.error.envelope : undefined}
          title="Could not load your team"
          onRetry={() => void team.refetch()}
        />
      ) : (
        <TeamBody
          tenantId={activeTenantId}
          invites={invites}
          atCap={atCap}
          seats={seats}
          adminCount={admins}
          isSuperadmin={isSuperadmin}
          callerEmail={callerEmail}
        />
      )}
    </section>
  )
}

interface TenantPickerProps {
  tenants: { id: string; name: string }[]
  loading: boolean
  isError: boolean
  value: string | null
  onChange: (id: string) => void
}

function TenantPicker({ tenants, loading, isError, value, onChange }: TenantPickerProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label
        htmlFor="team-tenant-picker"
        className="font-funnel text-xs uppercase tracking-wide text-[var(--muted-foreground)]"
      >
        Managing
      </label>
      <select
        id="team-tenant-picker"
        className={cn(
          'min-h-[44px] border border-[var(--rule)] bg-[var(--surface)] px-3 py-2',
          'text-sm text-[var(--foreground)]',
        )}
        value={value ?? ''}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
      >
        {/* The caller's own tenant may not be in the list yet while it loads — keep
            the current value selectable so the control never goes blank. */}
        {value && !tenants.some((t) => t.id === value) && (
          <option value={value}>{value}</option>
        )}
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {/* The cross-tenant list failing (a 403 from the server disagreeing on
          isSuperadmin, or a network blip) must not silently present an empty/self-only
          picker as the authoritative tenant set — surface it so it doesn't read as
          "I'm the only tenant." The active tenant still resolves, so the team below works. */}
      {isError && (
        <span className="text-xs text-[var(--status-fail)]" role="alert">
          Could not load tenants.
        </span>
      )}
    </div>
  )
}

interface TeamBodyProps {
  tenantId: string | null
  invites: InviteView[]
  atCap: boolean
  seats: number
  adminCount: number
  isSuperadmin: boolean
  callerEmail: string | null
}

function TeamBody({
  tenantId,
  invites,
  atCap,
  seats,
  adminCount,
  isSuperadmin,
  callerEmail,
}: TeamBodyProps) {
  const isEmpty = invites.filter((i) => i.status !== 'revoked').length === 0

  return (
    <div className="space-y-4">
      {/* DECISION 6 — empty state is a feature: a warm line + the focused input. */}
      {isEmpty ? (
        <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">
          It is just you so far — invite your team, up to {SEAT_CAP}.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--rule)] border border-[var(--rule)] bg-[var(--surface)]">
          {invites.map((invite) => (
            <TeamRow
              key={invite.email}
              tenantId={tenantId}
              invite={invite}
              isSuperadmin={isSuperadmin}
              isSelf={
                callerEmail != null &&
                typeof invite.email === 'string' &&
                invite.email.toLowerCase() === callerEmail.toLowerCase()
              }
              adminCount={adminCount}
            />
          ))}
        </ul>
      )}

      <AddMemberRow
        tenantId={tenantId}
        atCap={atCap}
        seats={seats}
        isSuperadmin={isSuperadmin}
        autoFocus={isEmpty}
      />
    </div>
  )
}

/** DECISION 2 — role = pill badge (filled Admin / outline Member), TEXT label. */
function RolePill({ role }: { role: MemberRole }) {
  const isAdmin = role === 'admin'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        isAdmin
          ? 'bg-[var(--color-secondary)] text-[var(--surface)]'
          : 'border border-[var(--rule)] text-[var(--foreground-soft)]',
      )}
    >
      {isAdmin && <ShieldCheck className="size-3" aria-hidden="true" />}
      {isAdmin ? 'Admin' : 'Member'}
    </span>
  )
}

/** DECISION 2 — status = quiet tag (Active / Pending / Revoked-faint), icon+text. */
function StatusTag({ status }: { status: InviteView['status'] }) {
  const label =
    status === 'claimed' ? 'Active' : status === 'pending' ? 'Pending' : 'Revoked'
  return (
    <span
      className={cn(
        'text-[11px] uppercase tracking-wide',
        status === 'revoked'
          ? 'text-[var(--muted-foreground)] opacity-60'
          : 'text-[var(--foreground-soft)]',
      )}
    >
      {label}
    </span>
  )
}

interface TeamRowProps {
  tenantId: string | null
  invite: InviteView
  isSuperadmin: boolean
  isSelf: boolean
  adminCount: number
}

function TeamRow({ tenantId, invite, isSuperadmin, isSelf, adminCount }: TeamRowProps) {
  const revoke = useRevokeInvite(tenantId)
  const [confirming, setConfirming] = useState(false)
  // The Revoke trigger — captured so focus returns to it when the confirm closes
  // (a11y: a modal must restore focus to its opener, never drop it to <body>).
  const triggerRef = useRef<HTMLButtonElement>(null)
  const revokeReasonId = `team-revoke-reason-${invite.email}`

  // DECISION 5 — last-admin / self guardrails:
  //   - no Revoke on your OWN row;
  //   - a revoke the server would 409 (demoting/removing the tenant's only admin) is
  //     pre-disabled with a reason, so the user never hits a raw error.
  const isLastAdmin =
    invite.status === 'claimed' && invite.role === 'admin' && adminCount <= 1
  const revokeDisabledReason = isSelf
    ? null // own row hides Revoke entirely (below)
    : isLastAdmin
      ? 'Cannot remove the last admin — a team must keep at least one.'
      : null

  const alreadyRevoked = invite.status === 'revoked'

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          alreadyRevoked
            ? 'text-[var(--muted-foreground)] line-through opacity-60'
            : 'text-[var(--foreground)]',
        )}
      >
        {invite.email}
      </span>

      <RolePill role={invite.role} />
      <StatusTag status={invite.status} />

      {/* SUPERADMIN sees a "Platform" tag on their own row. */}
      {isSuperadmin && isSelf && (
        <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--accent-text)]">
          <ShieldCheck className="size-3" aria-hidden="true" />
          Platform
        </span>
      )}

      {/* DECISION 3 — Revoke is DESTRUCTIVE → a confirm step. Never on your own row,
          never on an already-revoked row. */}
      {!isSelf && !alreadyRevoked && (
        <div className="ml-auto flex flex-col items-end gap-1">
          {revokeDisabledReason ? (
            <>
              {/* DECISION 5/7 — a disabled-with-reason Revoke must read as disabled and
                  be announced (mirrors the disabled-Add reason): a real disabled
                  <button> (focusable, conveys the disabled role) wired to a VISIBLE
                  reason node via aria-describedby — never a title-only static span. */}
              <Button
                ref={triggerRef}
                variant="ghost"
                size="sm"
                className="min-h-[44px] gap-1.5 text-[var(--muted-foreground)]"
                disabled
                aria-describedby={revokeReasonId}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Revoke
              </Button>
              <p
                id={revokeReasonId}
                className="max-w-[16rem] text-right text-xs text-[var(--muted-foreground)]"
              >
                {revokeDisabledReason}
              </p>
            </>
          ) : (
            <Button
              ref={triggerRef}
              variant="ghost"
              size="sm"
              className="min-h-[44px] gap-1.5 text-[var(--status-fail)]"
              onClick={() => setConfirming(true)}
              disabled={revoke.isPending}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Revoke
            </Button>
          )}
        </div>
      )}

      {confirming && (
        <RevokeConfirm
          email={invite.email}
          pending={revoke.isPending}
          // A NON-ApiError (network/timeout after the retry budget is exhausted —
          // api.ts rethrows a raw TypeError/AbortError) must still surface, not vanish
          // silently. Fall back to a generic line so the confirm always shows failure.
          error={
            revoke.isError
              ? revoke.error instanceof ApiError
                ? revoke.error.message
                : 'Could not revoke access — check your connection and try again.'
              : null
          }
          onCancel={() => {
            setConfirming(false)
            triggerRef.current?.focus()
          }}
          onConfirm={() => {
            revoke.mutate(invite.email, {
              onSuccess: () => {
                setConfirming(false)
                triggerRef.current?.focus()
              },
            })
          }}
        />
      )}
    </li>
  )
}

interface RevokeConfirmProps {
  email: string
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** DECISION 3 + 7 — destructive confirm: email echoed, focus-trapped, Esc-dismiss. */
function RevokeConfirm({ email, pending, error, onCancel, onConfirm }: RevokeConfirmProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Focus the confirm button on mount (a11y), then trap focus within the dialog.
    confirmRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled])',
      )
      // While the DELETE is in flight BOTH buttons are disabled, so the list is
      // empty. Returning here would let Tab escape the aria-modal dialog into the
      // page behind it (a real focus-trap leak). Instead, pin focus to the dialog
      // container (tabIndex=-1) so containment holds for the whole pending window.
      if (!focusables || focusables.length === 0) {
        e.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-label={`Revoke access for ${email}`}
      tabIndex={-1}
      className="mt-2 w-full border border-[var(--status-fail-line)] bg-[var(--status-fail-bg)] px-4 py-3"
    >
      <p className="text-sm leading-relaxed text-[var(--foreground)]">
        Revoke access for <span className="font-medium">{email}</span>? They will
        lose the workspace.
      </p>
      {error && (
        <p className="mt-2 text-xs text-[var(--status-fail)]" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <Button
          ref={confirmRef}
          variant="destructive"
          size="sm"
          className="min-h-[44px]"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? 'Revoking…' : 'Revoke access'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px]"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface AddMemberRowProps {
  tenantId: string | null
  atCap: boolean
  seats: number
  isSuperadmin: boolean
  autoFocus: boolean
}

function AddMemberRow({ tenantId, atCap, seats, isSuperadmin, autoFocus }: AddMemberRowProps) {
  const invite = useInviteMember(tenantId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('member')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // DECISION 4 — Add is DISABLED-WITH-REASON at/over cap (reason rendered, a11y via
  // aria-describedby). NOT a silent grey button.
  const capReason = atCap
    ? `Team is full (${seats}/${SEAT_CAP}). Revoke an invite to free a seat.`
    : null
  const reasonId = 'team-add-reason'

  const trimmed = email.trim()
  const canSubmit = !atCap && trimmed.length > 0 && !invite.isPending

  function submit() {
    if (!canSubmit) return
    invite.mutate(
      { email: trimmed, role: isSuperadmin ? role : undefined },
      {
        onSuccess: () => {
          setEmail('')
          setRole('member')
        },
      },
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="email"
          inputMode="email"
          placeholder="teammate@email.com"
          aria-label="Invite teammate by email"
          aria-describedby={capReason ? reasonId : undefined}
          className={cn(
            'min-h-[44px] flex-1 border border-[var(--rule)] bg-[var(--surface)] px-3 py-2',
            'text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
          )}
          value={email}
          disabled={atCap}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />

        {/* DECISION 4 — the role TOGGLE renders ONLY for a superadmin. A tenant-admin
            literally cannot choose Admin (mirrors the server's reject-don't-coerce). */}
        {isSuperadmin && (
          <div
            role="radiogroup"
            aria-label="Role to grant"
            className="inline-flex border border-[var(--rule)]"
          >
            {(['member', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                className={cn(
                  'min-h-[44px] px-3 text-xs uppercase tracking-wide',
                  role === r
                    ? 'bg-[var(--color-secondary)] text-[var(--surface)]'
                    : 'text-[var(--foreground-soft)]',
                )}
                onClick={() => setRole(r)}
              >
                {r === 'admin' ? 'Admin' : 'Member'}
              </button>
            ))}
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          className="min-h-[44px] gap-1.5"
          onClick={submit}
          disabled={!canSubmit}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </div>

      {capReason && (
        <p id={reasonId} className="text-xs text-[var(--muted-foreground)]">
          {capReason}
        </p>
      )}

      {/* A 403 / TEAM_FULL on add degrades to an inline error, never a white-screen.
          A NON-ApiError (network/timeout after the retry budget is exhausted — api.ts
          rethrows a raw TypeError/AbortError) must ALSO surface, not vanish silently:
          fall back to a generic connection line so the user always gets feedback. */}
      {invite.isError && (
        <p className="text-xs text-[var(--status-fail)]" role="alert">
          {invite.error instanceof ApiError
            ? invite.error.code === 'TEAM_FULL'
              ? `Team is full (${SEAT_CAP}/${SEAT_CAP}). Revoke an invite to free a seat.`
              : invite.error.code === 'APPROVAL_DENIED'
                ? 'You do not have permission to add that member.'
                : invite.error.message
            : 'Could not add that member — check your connection and try again.'}
        </p>
      )}
    </div>
  )
}
