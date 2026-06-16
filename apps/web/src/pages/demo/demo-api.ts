/**
 * Public demo API client. Talks to the engine's open `demo` tenant surface
 * (`/demo/api/*`) — UNAUTHENTICATED by design (no Privy token, no service key):
 * the engine scopes every read/write to consumerId 'demo', forces the chain
 * no-LLM (scripted), and per-IP rate-limits the run endpoint. This is a different
 * origin from the SPA in prod, so the engine mounts CORS on `/demo/api/*`.
 *
 * The demo dispatches the SAME engine workflows the real app runs (call-intake →
 * proposal-step → send-step) with the SAME approval-gate machinery — it is not a
 * mock. The shapes here mirror the raw engine_runs / engine_approvals rows the
 * `/demo/api/state` endpoint returns.
 */

const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

export interface DemoRun {
  runId: string
  workflowId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | string
  output: unknown
  error: string | null
  parentRunId: string | null
}

export interface DemoApproval {
  approvalId: string
  /** The onApprove target this gate dispatches (e.g. 'proposal-step' / 'send-step'). */
  workflowId: string
  state: 'pending' | 'approved' | 'rejected' | string
  approver: string
  sourceRunId: string
  decidedBy: string | null
}

export interface DemoState {
  rootRunId: string
  runsByWf: Record<string, DemoRun>
  approvals: DemoApproval[]
}

/** Parse a JSON response, rejecting with the parsed body on a non-2xx. */
async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new DemoApiError(res.status, body)
  return body as T
}

export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(
      (body as { error?: string | { message?: string } })?.error instanceof Object
        ? ((body as { error: { message?: string } }).error.message ?? 'demo request failed')
        : ((body as { error?: string }).error ?? `demo request failed (${status})`),
    )
    this.name = 'DemoApiError'
  }
}

const DECIDED_BY = 'You (demo)'

export const demoApi = {
  run: (transcript: string): Promise<{ rootRunId: string; demoRef: string }> =>
    fetch(`${API}/demo/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript }),
    }).then((r) => asJson<{ rootRunId: string; demoRef: string }>(r)),

  state: (rootRunId: string): Promise<DemoState> =>
    fetch(`${API}/demo/api/state/${rootRunId}`).then((r) => asJson<DemoState>(r)),

  approve: (approvalId: string): Promise<{ ok: true; runId: string }> =>
    fetch(`${API}/demo/api/approvals/${approvalId}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decided_by: DECIDED_BY }),
    }).then((r) => asJson<{ ok: true; runId: string }>(r)),

  reject: (approvalId: string): Promise<{ ok: true }> =>
    fetch(`${API}/demo/api/approvals/${approvalId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decided_by: DECIDED_BY }),
    }).then((r) => asJson<{ ok: true }>(r)),
}
