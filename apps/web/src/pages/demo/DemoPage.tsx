import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Lock, Sparkles } from 'lucide-react'
import { BrandLockup } from '@/components/shell/BrandLockup'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { demoApi, type DemoApproval, type DemoRun, type DemoState } from '@/pages/demo/demo-api'

/**
 * PUBLIC demo (`/demo`) — served by the Vite app, mounted OUTSIDE the auth gate
 * (no login). It drives the engine's open `demo` tenant: the SAME call-intake →
 * proposal-step → send-step workflows + approval gates the real app runs, via the
 * unauthenticated `/demo/api/*` surface (engine-scoped to consumerId 'demo',
 * no-LLM, rate-limited). Not a mock — real runs, real gates, a real Notion write.
 */

const SAMPLE_TRANSCRIPT = `Granola — Discovery call: Vino Design Build × Maria Delgado
Participants: Maria Delgado (homeowner), Sales (Vino)

Sales: Thanks for hopping on, Maria. Tell me about the project.
Maria: We just bought a place in Oak Park. The kitchen is original 1990s and the primary bath is rough — we want to redo both.
Sales: Walk me through the kitchen.
Maria: Full gut. New cabinets, quartz counters, and an island with seating. I'd love to open the wall between the kitchen and dining.
Sales: And the primary bath?
Maria: Walk-in shower, double vanity, heated floor.
Sales: Budget range you're comfortable with?
Maria: Somewhere around $120–150k. I want a clear line-item breakdown.
Sales: Timeline?
Maria: Hoping to start in ~8 weeks, done before the holidays.`

type NodeState = 'idle' | 'work' | 'wait' | 'done' | 'err'

interface CrmEntry {
  account?: string
  contactName?: string
  opportunityName?: string
  stage?: string
  estimatedValue?: string
  summary?: string
  tags?: string[]
}
interface Proposal {
  title?: string
  summary?: string
  lineItems?: { name: string; detail: string; price: string }[]
  subtotal?: string
  timelineText?: string
  exclusions?: string[]
}
interface ClientEmail {
  to?: string
  subject?: string
  body?: string
}
interface CrmResult {
  status?: string
  url?: string
  error?: string
}

const isTerminal = (s: DemoState | null): boolean => {
  if (!s) return false
  const send = s.runsByWf['send-step']
  if (send && (send.status === 'succeeded' || send.status === 'failed')) return true
  return s.approvals.some((a) => a.state === 'rejected')
}

const pendingGate = (s: DemoState | null, target: string): DemoApproval | undefined =>
  s?.approvals.find((a) => a.workflowId === target && a.state === 'pending')

const nodeFromRun = (run: DemoRun | undefined): NodeState => {
  if (!run) return 'idle'
  if (run.status === 'succeeded') return 'done'
  if (run.status === 'failed') return 'err'
  return 'work'
}

export function DemoPage() {
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT)
  const [rootRunId, setRootRunId] = useState<string | null>(null)
  const [state, setState] = useState<DemoState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pollRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Poll engine state while a run is in flight; stop once the chain is terminal.
  useEffect(() => {
    if (!rootRunId) return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await demoApi.state(rootRunId)
        if (cancelled) return
        setState(next)
        if (isTerminal(next)) stopPolling()
      } catch {
        /* transient poll error — keep trying until terminal */
      }
    }
    void tick()
    pollRef.current = window.setInterval(tick, 1500)
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [rootRunId, stopPolling])

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setState(null)
    setRootRunId(null)
    try {
      const { rootRunId: id } = await demoApi.run(transcript)
      setRootRunId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the demo run.')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (id: string, approve: boolean) => {
    setError(null)
    try {
      await (approve ? demoApi.approve(id) : demoApi.reject(id))
      const next = await demoApi.state(rootRunId!)
      setState(next)
      if (!isTerminal(next) && pollRef.current == null) {
        pollRef.current = window.setInterval(async () => {
          const s = await demoApi.state(rootRunId!).catch(() => null)
          if (s) {
            setState(s)
            if (isTerminal(s)) stopPolling()
          }
        }, 1500)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action failed — try again.')
    }
  }

  const intake = state?.runsByWf['call-intake']
  const proposalRun = state?.runsByWf['proposal-step']
  const sendRun = state?.runsByWf['send-step']
  const crm = (intake?.output as { crmEntry?: CrmEntry } | undefined)?.crmEntry
  const proposalOut = proposalRun?.output as
    | { proposal?: Proposal; email?: ClientEmail; crmResult?: CrmResult }
    | undefined
  const gate1 = pendingGate(state, 'proposal-step')
  const gate2 = pendingGate(state, 'send-step')
  const rejected = state?.approvals.find((a) => a.state === 'rejected')

  const nodes: { label: string; gate?: boolean; st: NodeState }[] = [
    { label: 'Read call · extract', st: nodeFromRun(intake) },
    {
      label: 'CRM review',
      gate: true,
      st: gate1 ? 'wait' : proposalRun ? 'done' : intake?.status === 'succeeded' ? 'wait' : 'idle',
    },
    { label: 'Draft proposal + email', st: nodeFromRun(proposalRun) },
    {
      label: 'Send approval',
      gate: true,
      st: gate2 ? 'wait' : sendRun ? 'done' : proposalRun?.status === 'succeeded' ? 'wait' : 'idle',
    },
    { label: 'Sent', st: nodeFromRun(sendRun) },
  ]
  if (rejected) {
    const idx = rejected.workflowId === 'proposal-step' ? 1 : 3
    const node = nodes[idx]
    if (node) node.st = 'err'
  }

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--rule)] bg-[var(--surface)]">
        <div className="mx-auto flex h-[68px] max-w-[1000px] items-center gap-4 px-6">
          <BrandLockup size="sm" />
          <span className="border border-[var(--rule)] bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--primary-foreground)]">
            Live demo
          </span>
          <a
            href="/"
            className="ml-auto text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline"
          >
            Sign in →
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-10">
        <h1 className="font-funnel text-3xl font-semibold tracking-tight">
          Call <span className="text-[var(--muted-foreground)]">→</span> CRM{' '}
          <span className="text-[var(--muted-foreground)]">→</span> Proposal{' '}
          <span className="text-[var(--muted-foreground)]">→</span> Email
        </h1>
        <p className="mt-3 max-w-[64ch] text-[var(--foreground-soft)]">
          An agent reads a discovery call and drafts the work.{' '}
          <b className="font-semibold text-[var(--foreground)]">
            Nothing is written or sent without a human approving it.
          </b>{' '}
          Two gates: approve the CRM entry, then approve the outbound email. This runs the real
          engine — approve a gate and a row really lands in Notion.
        </p>

        {/* pipeline rail */}
        <ol className="mt-8 flex items-start gap-2 border border-[var(--rule)] bg-[var(--surface)] p-5">
          {nodes.map((n, i) => (
            <li key={n.label} className="flex flex-1 flex-col items-center gap-2 text-center">
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full border-2 text-[11px]',
                  n.st === 'done' && 'border-[var(--status-ok)] bg-[var(--status-ok-bg)] text-[var(--status-ok)]',
                  n.st === 'work' && 'border-[var(--primary)] text-[var(--primary)]',
                  n.st === 'wait' && 'border-[var(--status-warn)] text-[var(--status-warn)]',
                  n.st === 'err' && 'border-[var(--status-fail)] text-[var(--status-fail)]',
                  n.st === 'idle' && 'border-[var(--border)] text-[var(--muted-foreground)]',
                )}
              >
                {n.st === 'done' ? (
                  <Check className="size-3.5" />
                ) : n.st === 'work' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : n.gate ? (
                  <Lock className="size-3" />
                ) : (
                  i + 1
                )}
              </span>
              {n.gate && (
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--status-warn)]">
                  Human gate
                </span>
              )}
              <span
                className={cn(
                  'text-[11px] leading-tight',
                  n.st === 'idle' ? 'text-[var(--muted-foreground)]' : 'text-[var(--foreground)]',
                )}
              >
                {n.label}
              </span>
            </li>
          ))}
        </ol>

        {/* transcript + run */}
        <details className="mt-6 border border-[var(--rule)] bg-[var(--surface)]" open={!rootRunId}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--foreground-soft)]">
            Call transcript (editable sample)
          </summary>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="block min-h-[180px] w-full resize-y border-t border-[var(--border)] bg-transparent px-4 py-3 font-mono text-xs leading-relaxed text-[var(--foreground)] outline-none"
          />
        </details>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={run} disabled={busy || transcript.trim().length < 20}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> {rootRunId ? 'Run again' : 'Run the pipeline'}
              </>
            )}
          </Button>
          {rootRunId && !isTerminal(state) && (
            <span className="text-sm text-[var(--muted-foreground)]">Engine is working…</span>
          )}
        </div>

        {error && (
          <p className="mt-4 border border-[var(--status-fail-line)] bg-[var(--status-fail-bg)] px-4 py-3 text-sm text-[var(--status-fail)]">
            {error}
          </p>
        )}

        {/* feed */}
        <div className="mt-8 flex flex-col gap-5">
          {crm && (
            <Card kicker="Step 1 · extracted from the call" title="CRM draft">
              <Field k="Opportunity" v={crm.opportunityName} />
              <Field k="Account" v={crm.account} />
              <Field k="Contact" v={crm.contactName} />
              <Field k="Stage" v={crm.stage} />
              <Field k="Estimated value" v={crm.estimatedValue} />
              <Field k="Summary" v={crm.summary} />
              {crm.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {crm.tags.map((t) => (
                    <span key={t} className="border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          )}

          {gate1 && (
            <GateCard
              title="Gate 1 · Approve the CRM entry"
              body="The agent drafted this CRM opportunity. Approve it to write the row to Notion and draft the proposal — or reject to stop."
              onApprove={() => decide(gate1.approvalId, true)}
              onReject={() => decide(gate1.approvalId, false)}
            />
          )}

          {proposalOut?.crmResult && (
            <Card kicker="Step 2 · written to your workspace" title="CRM row created">
              <div className="flex items-center gap-2 text-sm">
                <StatusDot ok={proposalOut.crmResult.status === 'ok'} />
                <span className="text-[var(--foreground)]">
                  Notion · {proposalOut.crmResult.status === 'ok' ? 'row written' : (proposalOut.crmResult.status ?? 'pending')}
                </span>
                {proposalOut.crmResult.url && (
                  <a
                    href={proposalOut.crmResult.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent-text)] underline-offset-4 hover:underline"
                  >
                    Open in Notion →
                  </a>
                )}
              </div>
              {proposalOut.crmResult.status === 'simulated' && (
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                  Notion isn’t configured in this environment, so the write is simulated.
                </p>
              )}
            </Card>
          )}

          {proposalOut?.proposal && (
            <Card kicker="Step 2 · drafted" title={proposalOut.proposal.title ?? 'Proposal'}>
              {proposalOut.proposal.summary && (
                <p className="mb-3 text-sm text-[var(--foreground-soft)]">{proposalOut.proposal.summary}</p>
              )}
              <table className="w-full text-sm">
                <tbody>
                  {proposalOut.proposal.lineItems?.map((li) => (
                    <tr key={li.name} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-3">
                        <div className="font-medium text-[var(--foreground)]">{li.name}</div>
                        <div className="text-xs text-[var(--muted-foreground)]">{li.detail}</div>
                      </td>
                      <td className="whitespace-nowrap py-2 text-right font-medium tabular-nums text-[var(--foreground)]">
                        {li.price}
                      </td>
                    </tr>
                  ))}
                  {proposalOut.proposal.subtotal && (
                    <tr>
                      <td className="py-2 font-semibold">Subtotal</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {proposalOut.proposal.subtotal}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>
          )}

          {proposalOut?.email && (
            <Card kicker="Step 2 · drafted" title="Client email">
              <Field k="To" v={proposalOut.email.to} />
              <Field k="Subject" v={proposalOut.email.subject} />
              {proposalOut.email.body && (
                <pre className="mt-2 whitespace-pre-wrap border border-[var(--border)] bg-[var(--background)] p-3 font-sans text-sm text-[var(--foreground-soft)]">
                  {proposalOut.email.body}
                </pre>
              )}
            </Card>
          )}

          {gate2 && (
            <GateCard
              title="Gate 2 · Approve the outbound email"
              body="Nothing leaves until you approve. This is the reputation / money-impacting step. Approve to send, or reject to hold."
              onApprove={() => decide(gate2.approvalId, true)}
              onReject={() => decide(gate2.approvalId, false)}
            />
          )}

          {sendRun?.status === 'succeeded' && (
            <Card kicker="Done" title="Sent ✅">
              <p className="text-sm text-[var(--foreground-soft)]">
                The approved email was dispatched. Every step ran through the engine with a human in
                the loop at each gate.
              </p>
            </Card>
          )}

          {rejected && (
            <Card kicker="Stopped" title="Gate rejected">
              <p className="text-sm text-[var(--foreground-soft)]">
                You rejected a gate, so nothing further ran — exactly the point: the agent can draft,
                but it cannot act without approval. Run it again to try the full flow.
              </p>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}

function Card({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[var(--rule)] bg-[var(--surface)] p-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--muted-foreground)]">
        {kicker}
      </div>
      <h3 className="mb-3 font-funnel text-lg font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Field({ k, v }: { k: string; v?: string }) {
  if (!v) return null
  return (
    <div className="flex gap-3 border-b border-[var(--border)] py-1.5 text-sm last:border-b-0">
      <span className="min-w-[120px] text-[var(--muted-foreground)]">{k}</span>
      <span className="text-[var(--foreground)]">{v}</span>
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full',
        ok ? 'bg-[var(--status-ok)]' : 'bg-[var(--status-warn)]',
      )}
    />
  )
}

function GateCard({
  title,
  body,
  onApprove,
  onReject,
}: {
  title: string
  body: string
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <section className="border-2 border-[var(--status-warn-line)] bg-[var(--status-warn-bg)] p-5">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--status-warn)]">
        <Lock className="size-3" /> Human gate
      </div>
      <h3 className="mb-2 font-funnel text-lg font-semibold">{title}</h3>
      <p className="mb-4 max-w-[60ch] text-sm text-[var(--foreground-soft)]">{body}</p>
      <div className="flex gap-3">
        <Button size="sm" onClick={onApprove}>
          <Check className="size-4" /> Approve
        </Button>
        <Button size="sm" variant="destructive" onClick={onReject}>
          Reject
        </Button>
      </div>
    </section>
  )
}

export default DemoPage
