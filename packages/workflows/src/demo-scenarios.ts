import type { CrmEntry, Extraction } from './call-intake'
import type { ClientEmail, Proposal } from './proposal-step'

/**
 * Demo scenario GENERATOR. The public /demo runs no-LLM (scripted), so without
 * variety every CRM row would be identical. Instead of a handful of fixed
 * scenarios, we synthesize a believable Vino Design Build deal per run:
 *   - a homeowner from a list of 23 names,
 *   - a random subset (2–4) of 10 services, each with a base price,
 *   - a per-run price multiplier f so totals vary (kitchen+bath ≈ f(135k)).
 *
 * It is SEEDED from the run's demoRef and fully pure (no Date.now/Math.random),
 * so call-intake (extraction + crmEntry) and proposal-step (proposal + email)
 * pick the SAME deal from the same ref and stay consistent. The ref is then
 * stamped on top (in call-intake) for guaranteed uniqueness.
 */
export interface DemoScenario {
  extraction: Extraction
  crmEntry: CrmEntry
  proposal: Proposal
  email: ClientEmail
}

interface Contact {
  first: string
  last: string
}
const NAMES: Contact[] = [
  { first: 'Maria', last: 'Delgado' },
  { first: 'Ada', last: 'Okafor' },
  { first: 'Kenji', last: 'Tanaka' },
  { first: 'Shauna', last: 'Brennan' },
  { first: 'Marco', last: 'Russo' },
  { first: 'Priya', last: 'Nair' },
  { first: 'Daniel', last: 'Cohen' },
  { first: 'Leila', last: 'Haddad' },
  { first: 'Grace', last: 'Kim' },
  { first: 'Hassan', last: 'Ali' },
  { first: 'Sofia', last: 'Marquez' },
  { first: 'Tom', last: 'Becker' },
  { first: 'Nina', last: 'Petrov' },
  { first: 'Andre', last: 'Dubois' },
  { first: 'Mei', last: 'Lin' },
  { first: 'Omar', last: 'Farouk' },
  { first: 'Claire', last: 'Whitman' },
  { first: 'Diego', last: 'Santos' },
  { first: 'Hannah', last: 'Schultz' },
  { first: 'Ravi', last: 'Patel' },
  { first: 'Bianca', last: 'Rossi' },
  { first: 'Eli', last: 'Greenberg' },
  { first: 'Yuki', last: 'Watanabe' },
]

const NEIGHBORHOODS = [
  'Oak Park', 'Evanston', 'Berwyn', 'La Grange', 'Naperville', 'Hinsdale',
  'Wilmette', 'Elmhurst', 'Glen Ellyn', 'Park Ridge',
]

interface Service {
  word: string // for the opportunity name
  label: string // proposal line-item name
  detail: string
  base: number // base price the per-run multiplier scales
  tag: string
}
const SERVICES: Service[] = [
  { word: 'Kitchen', label: 'Kitchen remodel', detail: 'Cabinetry, quartz counters, island w/ seating, appliance install', base: 72_000, tag: 'kitchen' },
  { word: 'Primary Bath', label: 'Primary bath remodel', detail: 'Walk-in shower, double vanity, heated floor, tile', base: 38_000, tag: 'bath' },
  { word: 'Systems Upgrade', label: 'Plumbing, electrical + HVAC', detail: 'Full re-plumb + re-wire, high-efficiency HVAC', base: 96_000, tag: 'systems' },
  { word: 'Backyard ADU', label: 'Detached ADU', detail: '~600 sq ft suite: kitchenette, full bath, separate entrance', base: 180_000, tag: 'adu' },
  { word: 'Primary Suite Addition', label: 'Primary suite addition', detail: 'Second-story suite, walk-in closet, spa bath', base: 84_000, tag: 'addition' },
  { word: 'Basement Finish', label: 'Basement finish', detail: 'Family room, egress window, full bath, finishes', base: 64_000, tag: 'basement' },
  { word: 'Deck', label: 'Rear deck', detail: 'Composite deck, footings, railings, stairs', base: 24_000, tag: 'deck' },
  { word: 'Home Theater', label: 'Home theater', detail: 'Soundproofing, wiring, built-ins, recessed lighting', base: 28_000, tag: 'home-theater' },
  { word: 'Roof + Siding', label: 'Roof + siding', detail: 'Architectural shingle roof, fiber-cement siding', base: 46_000, tag: 'exterior' },
  { word: 'Outdoor Living', label: 'Hardscape + landscaping', detail: 'Patio, retaining walls, planting, lighting', base: 32_000, tag: 'landscape' },
]

const TIMELINES = [
  'Start in ~8 weeks; done before the holidays',
  'Flexible; ready to start in the spring',
  'Wants it done within ~6 months',
  'Hoping to start late summer',
  'No rush; sometime this year',
]
const RISKS = [
  'Possible load-bearing wall',
  'Long lead time on selected finishes',
  'Permit timeline',
  'Existing foundation load capacity',
  'Moisture / waterproofing',
  'Utility tie-in distance',
  'Historic-district review',
  'Knob-and-tube wiring',
]
const STAGES = ['Discovery', 'Qualification', 'Proposal']

// ── seeded RNG (mulberry32) — pure, deterministic from the demo ref ──────────
function seedFrom(ref?: string): number {
  if (!ref) return 1
  let h = 2166136261
  for (let i = 0; i < ref.length; i++) {
    h ^= ref.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(seed: number): () => number {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const usd = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const roundTo = (n: number, step: number): number => Math.round(n / step) * step

/** Synthesize a complete, believable deal, deterministically from the demo ref. */
export function pickScenario(ref?: string): DemoScenario {
  const rng = mulberry32(seedFrom(ref))
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!

  const contact = pick(NAMES)
  const neighborhood = pick(NEIGHBORHOODS)
  const stage = pick(STAGES)
  const timeline = pick(TIMELINES)

  // 2–4 distinct services.
  const count = 2 + Math.floor(rng() * 3)
  const pool = [...SERVICES]
  const chosen: Service[] = []
  for (let i = 0; i < count && pool.length; i++) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!)
  }

  // f(x): a per-run multiplier (0.85–1.30) applied to each service base price.
  const factor = 0.85 + rng() * 0.45
  const lineItems = chosen.map((s) => ({
    name: s.label,
    detail: s.detail,
    price: usd(roundTo(s.base * factor, 500)),
    _n: roundTo(s.base * factor, 500),
  }))
  const servicesSubtotal = lineItems.reduce((sum, li) => sum + li._n, 0)
  // Design + PM as 8–12% of the build subtotal.
  const designPm = roundTo(servicesSubtotal * (0.08 + rng() * 0.04), 500)
  const total = servicesSubtotal + designPm

  const projectType = chosen.map((s) => s.word).join(' + ')
  const opportunityName = `${contact.last} ${projectType}`
  const account = `${contact.last} Residence — ${neighborhood}`
  const tags = ['design-build', ...chosen.map((s) => s.tag)]

  const proposalLineItems = [
    ...lineItems.map(({ name, detail, price }) => ({ name, detail, price })),
    { name: 'Design + project management', detail: 'Drawings, selections, permits, on-site coordination', price: usd(designPm) },
  ]

  return {
    extraction: {
      client: `${contact.last} Residence (${contact.first} ${contact.last})`,
      contact: `${contact.first} ${contact.last}`,
      projectType,
      scopeHighlights: chosen.map((s) => s.detail),
      budgetSignal: `Around ${usd(total * 0.92)}–${usd(total * 1.08)}`,
      timeline,
      risks: [pick(RISKS), pick(RISKS)].filter((r, i, a) => a.indexOf(r) === i),
      nextSteps: ['Send line-item proposal', 'Schedule on-site measure', 'Confirm scope + selections'],
    },
    crmEntry: {
      account,
      contactName: `${contact.first} ${contact.last}`,
      opportunityName,
      stage,
      estimatedValue: usd(total),
      summary: `Discovery call: ${projectType.toLowerCase()} at the ${contact.last} residence in ${neighborhood}. Budget ~${usd(total)}. ${timeline}.`,
      tags,
    },
    proposal: {
      title: `Proposal — ${opportunityName}`,
      summary: `Design-build proposal for ${projectType.toLowerCase()} at the ${contact.last} residence.`,
      lineItems: proposalLineItems,
      subtotal: usd(total),
      timelineText: `Approx. ${8 + chosen.length * 2}–${12 + chosen.length * 2} weeks from permit approval.`,
      exclusions: ['Permit/HOA fees', 'Client-supplied fixtures over allowance', 'Unforeseen structural / hazmat'],
    },
    email: {
      to: `${contact.first}.${contact.last}@example.com`.toLowerCase(),
      subject: `Your proposal — ${opportunityName}`,
      body: `Hi ${contact.first},\n\nThanks for the great conversation. Based on what you shared, we've put together a line-item proposal for your ${projectType.toLowerCase()} — estimated at ${usd(total)}.\n\nThe attached proposal breaks down every line item. Once you've had a look, we'd love to schedule the on-site measure.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  }
}
