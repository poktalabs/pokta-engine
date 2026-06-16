import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Loader2, Lock, Sparkles, X } from 'lucide-react'
import { BrandLockup } from '@/components/shell/BrandLockup'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { demoApi, type DemoApproval, type DemoRun, type DemoState } from '@/pages/demo/demo-api'

/**
 * PUBLIC demo (`/demo`) — served by the Vite app, mounted OUTSIDE the auth gate
 * (no login). It drives the engine's open `demo` tenant: the SAME call-intake →
 * proposal-step → send-step workflows + approval gates the real app runs, via the
 * unauthenticated `/demo/api/*` surface (no-LLM, rate-limited). Not a mock.
 *
 * Layout is a STAGED workflow, not a feed: a sticky left stepper (the pipeline
 * spine) + a right panel that shows only the ONE active stage. The action you need
 * (a human gate) is always front-and-center — no scroll-chasing. Completed stages
 * are clickable to review.
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

type StageId = 'call' | 'crm' | 'proposal' | 'send' | 'sent'
type StageStatus = 'idle' | 'active' | 'done' | 'rejected'

const STAGES: { id: StageId; label: string; sub: string; gate?: boolean }[] = [
  { id: 'call', label: 'Read the call', sub: 'Extract the opportunity' },
  { id: 'crm', label: 'Approve CRM entry', sub: 'Human gate', gate: true },
  { id: 'proposal', label: 'Draft proposal + email', sub: 'Write to Notion' },
  { id: 'send', label: 'Approve send', sub: 'Human gate', gate: true },
  { id: 'sent', label: 'Sent', sub: 'Complete' },
]

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
}
interface ClientEmail {
  to?: string
  subject?: string
  body?: string
}
interface CrmResult {
  status?: string
  url?: string
}

const isTerminal = (s: DemoState | null): boolean => {
  if (!s) return false
  const send = s.runsByWf['send-step']
  if (send && (send.status === 'succeeded' || send.status === 'failed')) return true
  return s.approvals.some((a) => a.state === 'rejected')
}
const pendingGate = (s: DemoState | null, target: string): DemoApproval | undefined =>
  s?.approvals.find((a) => a.workflowId === target && a.state === 'pending')
const rejectedAt = (s: DemoState | null, target: string): boolean =>
  !!s?.approvals.some((a) => a.workflowId === target && a.state === 'rejected')
const isRunning = (r: DemoRun | undefined): boolean =>
  !!r && r.status !== 'succeeded' && r.status !== 'failed'

export function DemoPage() {
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT)
  const [rootRunId, setRootRunId] = useState<string | null>(null)
  const [demoRef, setDemoRef] = useState<string | null>(null)
  const [state, setState] = useState<DemoState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<StageId>('call')
  const pollRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const refresh = useCallback(async (id: string) => {
    const next = await demoApi.state(id)
    setState(next)
    return next
  }, [])

  useEffect(() => {
    if (!rootRunId) return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await refresh(rootRunId)
        if (!cancelled && isTerminal(next)) stopPolling()
      } catch {
        /* transient — keep polling */
      }
    }
    void tick()
    pollRef.current = window.setInterval(tick, 1500)
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [rootRunId, refresh, stopPolling])

  // ── derive the live workflow position ────────────────────────────────────
  const intake = state?.runsByWf['call-intake']
  const proposalRun = state?.runsByWf['proposal-step']
  const sendRun = state?.runsByWf['send-step']
  const crm = (intake?.output as { crmEntry?: CrmEntry } | undefined)?.crmEntry
  const proposalOut = proposalRun?.output as
    | { proposal?: Proposal; email?: ClientEmail; crmResult?: CrmResult }
    | undefined
  const gate1 = pendingGate(state, 'proposal-step')
  const gate2 = pendingGate(state, 'send-step')

  const stageStatus = (id: StageId): StageStatus => {
    switch (id) {
      case 'call':
        return intake?.status === 'succeeded' ? 'done' : intake ? 'active' : 'idle'
      case 'crm':
        return rejectedAt(state, 'proposal-step') ? 'rejected' : proposalRun ? 'done' : gate1 ? 'active' : 'idle'
      case 'proposal':
        return proposalRun?.status === 'succeeded' ? 'done' : proposalRun ? 'active' : 'idle'
      case 'send':
        return rejectedAt(state, 'send-step') ? 'rejected' : sendRun ? 'done' : gate2 ? 'active' : 'idle'
      case 'sent':
        return sendRun?.status === 'succeeded' ? 'done' : 'idle'
    }
  }

  const currentStage = (): StageId => {
    if (!rootRunId) return 'call'
    if (gate2) return 'send'
    if (gate1) return 'crm'
    if (sendRun) return 'sent'
    if (rejectedAt(state, 'send-step')) return 'send'
    if (rejectedAt(state, 'proposal-step')) return 'crm'
    if (proposalRun) return 'proposal'
    return 'call'
  }
  const current = currentStage()

  // Follow the live stage automatically; the user can still click back to review.
  useEffect(() => {
    setSelected(current)
  }, [current])

  const start = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setState(null)
    setRootRunId(null)
    setDemoRef(null)
    try {
      const { rootRunId: id, demoRef: ref } = await demoApi.run(transcript)
      setDemoRef(ref)
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
      if (rootRunId) {
        const next = await refresh(rootRunId)
        if (!isTerminal(next) && pollRef.current == null) {
          pollRef.current = window.setInterval(() => {
            if (rootRunId) void refresh(rootRunId).then((s) => isTerminal(s) && stopPolling())
          }, 1500)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action failed — try again.')
    }
  }

  const started = !!rootRunId

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-20 border-b border-[var(--rule)] bg-[var(--surface)]">
        <div className="mx-auto flex h-[68px] max-w-[1120px] items-center gap-4 px-6">
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

      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── left: the pipeline spine ── */}
        <aside className="md:sticky md:top-[92px] md:self-start">
          <h1 className="font-funnel text-xl font-semibold tracking-tight">
            Call → CRM → Proposal → Email
          </h1>
          <p className="mt-2 text-sm text-[var(--foreground-soft)]">
            An agent drafts the work. Nothing is written or sent without your approval.
          </p>

          {demoRef && (
            <div className="mt-4 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs">
              <span className="text-[var(--muted-foreground)]">Your demo ref</span>{' '}
              <span className="font-mono font-semibold text-[var(--foreground)]">{demoRef}</span>
              <div className="mt-0.5 text-[var(--muted-foreground)]">
                Look for <span className="font-mono">Demo {demoRef}</span> on the row in Notion.
              </div>
            </div>
          )}

          <ol className="mt-6 flex flex-col gap-1">
            {STAGES.map((s, i) => {
              const st = stageStatus(s.id)
              const reachable = started && (st !== 'idle' || s.id === current)
              const isSel = selected === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => reachable && setSelected(s.id)}
                    className={cn(
                      'flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors',
                      isSel
                        ? 'border-l-[var(--accent-text)] bg-[var(--surface-2)]'
                        : 'border-l-transparent hover:bg-[var(--surface-2)]',
                      !reachable && 'cursor-default opacity-55 hover:bg-transparent',
                    )}
                  >
                    <StageDot status={st} index={i} gate={s.gate} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{s.label}</span>
                      <span
                        className={cn(
                          'block text-[11px] leading-tight',
                          s.gate ? 'text-[var(--status-warn)]' : 'text-[var(--muted-foreground)]',
                        )}
                      >
                        {st === 'active' ? 'Now' : st === 'rejected' ? 'Stopped' : s.sub}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        {/* ── right: the single active stage ── */}
        <section className="min-w-0">
          {error && (
            <p className="mb-5 border border-[var(--status-fail-line)] bg-[var(--status-fail-bg)] px-4 py-3 text-sm text-[var(--status-fail)]">
              {error}
            </p>
          )}

          {!started ? (
            <StartPanel
              transcript={transcript}
              setTranscript={setTranscript}
              busy={busy}
              onRun={start}
            />
          ) : (
            <StagePanel
              stage={selected}
              statusOf={stageStatus}
              intakeRunning={isRunning(intake)}
              proposalRunning={isRunning(proposalRun)}
              crm={crm}
              proposalOut={proposalOut}
              demoRef={demoRef}
              gate1={gate1}
              gate2={gate2}
              onDecide={decide}
              onRunAgain={start}
            />
          )}
        </section>
      </div>
    </main>
  )
}

function StageDot({ status, index, gate }: { status: StageStatus; index: number; gate?: boolean }) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold',
        status === 'done' && 'border-[var(--status-ok)] bg-[var(--status-ok-bg)] text-[var(--status-ok)]',
        status === 'active' && 'border-[var(--status-warn)] bg-[var(--status-warn-bg)] text-[var(--status-warn)]',
        status === 'rejected' && 'border-[var(--status-fail)] text-[var(--status-fail)]',
        status === 'idle' && 'border-[var(--border)] text-[var(--muted-foreground)]',
      )}
    >
      {status === 'done' ? (
        <Check className="size-3.5" />
      ) : status === 'rejected' ? (
        <X className="size-3.5" />
      ) : status === 'active' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : gate ? (
        <Lock className="size-3" />
      ) : (
        index + 1
      )}
    </span>
  )
}

function StartPanel({
  transcript,
  setTranscript,
  busy,
  onRun,
}: {
  transcript: string
  setTranscript: (v: string) => void
  busy: boolean
  onRun: () => void
}) {
  return (
    <div className="border border-[var(--rule)] bg-[var(--surface)] p-6">
      <Kicker>Start here</Kicker>
      <h2 className="mb-2 font-funnel text-2xl font-semibold tracking-tight">
        Turn a sales call into approved work
      </h2>
      <p className="mb-5 max-w-[60ch] text-sm text-[var(--foreground-soft)]">
        The engine reads this discovery call, drafts a CRM opportunity, and waits for you at two
        human gates — approve the CRM entry, then approve the outbound email. Approve gate 1 and a
        real row lands in Notion.
      </p>
      <details className="mb-5 border border-[var(--border)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--foreground-soft)]">
          Call transcript (editable sample)
        </summary>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          className="block min-h-[200px] w-full resize-y border-t border-[var(--border)] bg-transparent px-4 py-3 font-mono text-xs leading-relaxed outline-none"
        />
      </details>
      <Button onClick={onRun} disabled={busy || transcript.trim().length < 20} size="lg">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Starting…
          </>
        ) : (
          <>
            <Sparkles className="size-4" /> Run the pipeline
          </>
        )}
      </Button>
    </div>
  )
}

function StagePanel({
  stage,
  statusOf,
  intakeRunning,
  proposalRunning,
  crm,
  proposalOut,
  demoRef,
  gate1,
  gate2,
  onDecide,
  onRunAgain,
}: {
  stage: StageId
  statusOf: (id: StageId) => StageStatus
  intakeRunning: boolean
  proposalRunning: boolean
  crm?: CrmEntry
  proposalOut?: { proposal?: Proposal; email?: ClientEmail; crmResult?: CrmResult }
  demoRef: string | null
  gate1?: DemoApproval
  gate2?: DemoApproval
  onDecide: (id: string, approve: boolean) => void
  onRunAgain: () => void
}) {
  const st = statusOf(stage)

  if (stage === 'call') {
    if (intakeRunning || !crm)
      return <Working title="Reading the call" body="Extracting the opportunity from the transcript…" />
    return (
      <Panel kicker="Step 1 · extracted" title="Opportunity">
        <CrmFields crm={crm} />
      </Panel>
    )
  }

  if (stage === 'crm') {
    if (!crm) return <Working title="Reading the call" body="Extracting the opportunity…" />
    const live = st === 'active' && gate1
    return (
      <Panel
        kicker={live ? 'Gate 1 · your approval' : st === 'rejected' ? 'Gate 1 · rejected' : 'Gate 1 · approved'}
        title="Approve the CRM entry"
        gate={!!live}
      >
        <p className="mb-4 max-w-[60ch] text-sm text-[var(--foreground-soft)]">
          The agent drafted this CRM opportunity. Approve it to write the row to Notion and draft the
          proposal — or reject to stop. The agent cannot write without your approval.
        </p>
        <CrmFields crm={crm} />
        {live && gate1 && <GateActions id={gate1.approvalId} onDecide={onDecide} approveLabel="Approve & write to Notion" />}
        {st === 'rejected' && <Stopped />}
      </Panel>
    )
  }

  if (stage === 'proposal') {
    if (proposalRunning || !proposalOut)
      return <Working title="Working" body="Writing the CRM row to Notion and drafting the proposal + email…" />
    return (
      <Panel kicker="Step 2 · drafted" title="Proposal + email">
        <NotionResult result={proposalOut.crmResult} demoRef={demoRef} />
        <ProposalTable proposal={proposalOut.proposal} />
        <EmailBlock email={proposalOut.email} />
      </Panel>
    )
  }

  if (stage === 'send') {
    if (!proposalOut) return <Working title="Working" body="Drafting the outbound email…" />
    const live = st === 'active' && gate2
    return (
      <Panel
        kicker={live ? 'Gate 2 · your approval' : st === 'rejected' ? 'Gate 2 · rejected' : 'Gate 2 · approved'}
        title="Approve the outbound email"
        gate={!!live}
      >
        <p className="mb-4 max-w-[60ch] text-sm text-[var(--foreground-soft)]">
          Nothing leaves until you approve — this is the reputation / money-impacting step.
        </p>
        <EmailBlock email={proposalOut.email} />
        {live && gate2 && <GateActions id={gate2.approvalId} onDecide={onDecide} approveLabel="Approve & send" />}
        {st === 'rejected' && <Stopped />}
      </Panel>
    )
  }

  // sent
  return (
    <Panel kicker="Complete" title="Sent">
      <p className="mb-4 max-w-[60ch] text-[var(--foreground-soft)]">
        The approved email was dispatched. Every step ran through the engine with you in the loop at
        each gate.
      </p>
      <NotionResult result={proposalOut?.crmResult} demoRef={demoRef} />
      <div className="mt-5">
        <Button onClick={onRunAgain} variant="secondary" size="sm">
          <Sparkles className="size-4" /> Run it again
        </Button>
      </div>
    </Panel>
  )
}

// ── presentational bits ──────────────────────────────────────────────────────

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--muted-foreground)]">
      {children}
    </div>
  )
}

function Panel({
  kicker,
  title,
  gate,
  children,
}: {
  kicker: string
  title: string
  gate?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'border bg-[var(--surface)] p-6',
        gate ? 'border-2 border-[var(--status-warn-line)] bg-[var(--status-warn-bg)]' : 'border-[var(--rule)]',
      )}
    >
      <div
        className={cn(
          'mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em]',
          gate ? 'text-[var(--status-warn)]' : 'text-[var(--muted-foreground)]',
        )}
      >
        {gate && <Lock className="size-3" />}
        {kicker}
      </div>
      <h2 className="mb-4 font-funnel text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function Working({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex items-center gap-4 border border-[var(--rule)] bg-[var(--surface)] p-6">
      <Loader2 className="size-6 animate-spin text-[var(--primary)]" />
      <div>
        <div className="font-funnel text-lg font-semibold">{title}</div>
        <div className="text-sm text-[var(--foreground-soft)]">{body}</div>
      </div>
    </section>
  )
}

function CrmFields({ crm }: { crm: CrmEntry }) {
  return (
    <div>
      <Field k="Opportunity" v={crm.opportunityName} />
      <Field k="Account" v={crm.account} />
      <Field k="Contact" v={crm.contactName} />
      <Field k="Stage" v={crm.stage} />
      <Field k="Estimated value" v={crm.estimatedValue} />
      <Field k="Summary" v={crm.summary} />
      {crm.tags?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {crm.tags.map((t) => (
            <span key={t} className="border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
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

function NotionResult({ result, demoRef }: { result?: CrmResult; demoRef: string | null }) {
  if (!result) return null
  const ok = result.status === 'ok'
  return (
    <div className="mb-5 border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn('inline-block size-2 rounded-full', ok ? 'bg-[var(--status-ok)]' : 'bg-[var(--status-warn)]')} />
        <span className="font-medium text-[var(--foreground)]">
          Notion · {ok ? 'row written' : (result.status ?? 'pending')}
        </span>
        {demoRef && (
          <span className="text-[var(--muted-foreground)]">
            (tagged <span className="font-mono">demo-{demoRef}</span>)
          </span>
        )}
        {result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-0.5 font-medium text-[var(--accent-text)] underline-offset-4 hover:underline"
          >
            Open in Notion <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>
      {result.status === 'simulated' && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          Notion isn’t configured in this environment, so the write is simulated.
        </p>
      )}
    </div>
  )
}

function ProposalTable({ proposal }: { proposal?: Proposal }) {
  if (!proposal) return null
  return (
    <div className="mb-5">
      <div className="mb-2 font-funnel font-semibold">{proposal.title ?? 'Proposal'}</div>
      {proposal.summary && <p className="mb-3 text-sm text-[var(--foreground-soft)]">{proposal.summary}</p>}
      <table className="w-full text-sm">
        <tbody>
          {proposal.lineItems?.map((li) => (
            <tr key={li.name} className="border-b border-[var(--border)]">
              <td className="py-2 pr-3">
                <div className="font-medium text-[var(--foreground)]">{li.name}</div>
                <div className="text-xs text-[var(--muted-foreground)]">{li.detail}</div>
              </td>
              <td className="whitespace-nowrap py-2 text-right font-medium tabular-nums">{li.price}</td>
            </tr>
          ))}
          {proposal.subtotal && (
            <tr>
              <td className="py-2 font-semibold">Subtotal</td>
              <td className="py-2 text-right font-semibold tabular-nums">{proposal.subtotal}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function EmailBlock({ email }: { email?: ClientEmail }) {
  if (!email) return null
  return (
    <div className="mb-1">
      <Field k="To" v={email.to} />
      <Field k="Subject" v={email.subject} />
      {email.body && (
        <pre className="mt-2 whitespace-pre-wrap border border-[var(--border)] bg-[var(--background)] p-3 font-sans text-sm text-[var(--foreground-soft)]">
          {email.body}
        </pre>
      )}
    </div>
  )
}

function GateActions({
  id,
  approveLabel,
  onDecide,
}: {
  id: string
  approveLabel: string
  onDecide: (id: string, approve: boolean) => void
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-3">
      <Button size="sm" onClick={() => onDecide(id, true)}>
        <Check className="size-4" /> {approveLabel}
      </Button>
      <Button size="sm" variant="destructive" onClick={() => onDecide(id, false)}>
        <X className="size-4" /> Reject
      </Button>
    </div>
  )
}

function Stopped() {
  return (
    <p className="mt-5 border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground-soft)]">
      You rejected this gate, so nothing further ran — the agent can draft, but it cannot act without
      approval. Run it again to try the full flow.
    </p>
  )
}

export default DemoPage
