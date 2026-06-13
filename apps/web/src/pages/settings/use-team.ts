import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type InviteListResponse,
  type MemberRole,
  type TenantListResponse,
  inviteListResponseSchema,
  tenantListResponseSchema,
} from '@godin-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Validate a 200 body against the contract schema BEFORE it reaches React render.
 * `apiFetch` does ZERO success-body validation (a bare `as T` cast), so a backend /
 * proxy that returns a malformed-but-200 payload (a non-array `invites`, a row with a
 * null `email`, an HTML body) would otherwise throw DURING render — e.g.
 * `invites.filter is not a function` or `email.toLowerCase` on null — escaping the
 * local LoadingState/ErrorState (which only fire on isPending/isError) and
 * white-screening the whole Settings route. Surfacing a parse failure as a query
 * ERROR routes it to the panel's ErrorState instead, so a bad shape degrades locally.
 */
function parsed<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }) {
  return (raw: unknown): T => {
    const result = schema.safeParse(raw)
    if (!result.success) {
      throw new ApiError(
        {
          code: 'SKILL_EXEC_ERROR',
          message: 'The server returned an unexpected response.',
          retryable: false,
        },
        200,
      )
    }
    return result.data
  }
}

/**
 * Settings → Team data hooks (admin-roles Wave B). TanStack Query against the
 * role-gated Wave A endpoints (all under `/v1`, Privy-JWT authed, role enforced
 * SERVER-SIDE — these hooks are COSMETIC: a 403 here just degrades to an inline
 * error, never a white-screen). Each endpoint is registered in `LIVE_PATHS` /
 * `LIVE_PATH_PATTERNS` (lib/api.ts) so it hits the network even under the
 * `VITE_USE_MOCKS=true` jsdom pin.
 *
 * The mutations all INVALIDATE the team query for the tenant on success so the
 * roster re-reads server truth (refetch-on-success, not optimistic — the seat cap
 * + last-admin guards are server-authoritative and we want the real post-write
 * state, not a guessed one).
 */

/** React Query key for a tenant's team (invites roster). */
export function teamQueryKey(tenantId: string) {
  return ['team', tenantId] as const
}

/** React Query key for the superadmin tenant picker list. */
export const TENANTS_QUERY_KEY = ['superadmin', 'tenants'] as const

/** GET /v1/tenants/:tenantId/invites — the team (requireTenantAdmin server-side). */
export function useTeam(tenantId: string | null) {
  return useQuery<InviteListResponse, ApiError>({
    queryKey: teamQueryKey(tenantId ?? ''),
    queryFn: () =>
      apiFetch<unknown>(
        `/v1/tenants/${encodeURIComponent(tenantId as string)}/invites`,
      ).then(parsed<InviteListResponse>(inviteListResponseSchema)),
    // Only run once we know which tenant to read (a member has no tenant to manage).
    enabled: !!tenantId,
    retry: false,
  })
}

/** GET /v1/superadmin/tenants — the tenant picker (requireSuperadmin server-side). */
export function useTenants(enabled: boolean) {
  return useQuery<TenantListResponse, ApiError>({
    queryKey: TENANTS_QUERY_KEY,
    queryFn: () =>
      apiFetch<unknown>('/v1/superadmin/tenants').then(
        parsed<TenantListResponse>(tenantListResponseSchema),
      ),
    enabled,
    retry: false,
  })
}

export interface InviteMemberInput {
  email: string
  /** Only a superadmin may pass `admin`; a tenant-admin POSTing admin gets a 403. */
  role?: MemberRole
}

/** POST /v1/tenants/:tenantId/invites — add a member (or admin, if superadmin). */
export function useInviteMember(tenantId: string | null) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, InviteMemberInput>({
    mutationFn: (input) =>
      apiFetch<void>(`/v1/tenants/${encodeURIComponent(tenantId as string)}/invites`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamQueryKey(tenantId ?? '') })
    },
  })
}

/** DELETE /v1/tenants/:tenantId/invites/:email — revoke + remove the member. */
export function useRevokeInvite(tenantId: string | null) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (email) =>
      apiFetch<void>(
        `/v1/tenants/${encodeURIComponent(tenantId as string)}/invites/${encodeURIComponent(email)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamQueryKey(tenantId ?? '') })
    },
  })
}

export interface SetMemberRoleInput {
  did: string
  role: MemberRole
}

/** PATCH /v1/tenants/:tenantId/members/:did — superadmin promote/demote. */
export function useSetMemberRole(tenantId: string | null) {
  const qc = useQueryClient()
  return useMutation<void, ApiError, SetMemberRoleInput>({
    mutationFn: ({ did, role }) =>
      apiFetch<void>(
        `/v1/tenants/${encodeURIComponent(tenantId as string)}/members/${encodeURIComponent(did)}`,
        { method: 'PATCH', body: JSON.stringify({ role }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamQueryKey(tenantId ?? '') })
    },
  })
}
