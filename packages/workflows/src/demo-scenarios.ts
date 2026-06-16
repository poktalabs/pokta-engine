import type { CrmEntry, Extraction } from './call-intake'
import type { ClientEmail, Proposal } from './proposal-step'

/**
 * Demo scenario pool. The public /demo runs no-LLM (scripted), so without variety
 * every CRM row would be identical. Each run picks one of these complete, believable
 * Vino Design Build opportunities (deterministically from the run's demoRef), so the
 * Notion rows look like distinct real deals — not a repeated scripted entry. The
 * per-run demoRef is then stamped on top for guaranteed uniqueness.
 *
 * Both call-intake (extraction + crmEntry) and proposal-step (proposal + email) pick
 * the SAME scenario from the same demoRef, so the whole chain stays consistent.
 */
export interface DemoScenario {
  extraction: Extraction
  crmEntry: CrmEntry
  proposal: Proposal
  email: ClientEmail
}

export const SCENARIOS: DemoScenario[] = [
  {
    extraction: {
      client: 'Delgado Residence (homeowners: Maria & Tomás Delgado)',
      contact: 'Maria Delgado',
      projectType: 'Kitchen + primary bathroom remodel',
      scopeHighlights: [
        'Full kitchen gut: cabinets, quartz counters, island with seating',
        'Primary bath: walk-in shower, double vanity, heated floor',
        'Open the wall between kitchen and dining (verify load-bearing)',
      ],
      budgetSignal: 'Comfortable around $120–150k; wants a clear line-item breakdown',
      timeline: 'Start in ~8 weeks; done before the holidays',
      risks: ['Possible load-bearing wall', 'Long lead time on chosen tile'],
      nextSteps: ['Send line-item proposal', 'Schedule on-site measure', 'Confirm structural engineer'],
    },
    crmEntry: {
      account: 'Delgado Residence — Oak Park',
      contactName: 'Maria Delgado',
      opportunityName: 'Delgado Kitchen + Primary Bath Remodel',
      stage: 'Proposal',
      estimatedValue: '$135,000',
      summary:
        'Discovery call covered a full kitchen gut and primary bath remodel with an open-concept wall removal. Budget ~$120–150k. Next: line-item proposal + on-site measure.',
      tags: ['remodel', 'kitchen', 'bath', 'proposal-ready'],
    },
    proposal: {
      title: 'Proposal — Delgado Kitchen + Primary Bath Remodel',
      summary: 'Design-build proposal for a full kitchen and primary bath remodel at the Delgado residence.',
      lineItems: [
        { name: 'Kitchen remodel', detail: 'Cabinetry, quartz counters, island w/ seating, appliance install', price: '$72,000' },
        { name: 'Primary bath remodel', detail: 'Walk-in shower, double vanity, heated floor, tile', price: '$38,000' },
        { name: 'Wall removal + structural', detail: 'Open kitchen/dining wall; engineer + beam', price: '$15,000' },
        { name: 'Design + project management', detail: 'Drawings, selections, permits, coordination', price: '$10,000' },
      ],
      subtotal: '$135,000',
      timelineText: 'Approx. 10–12 weeks from permit approval; targeting completion before the holidays.',
      exclusions: ['HOA fees', 'Client-supplied appliances', 'Unforeseen structural beyond noted wall'],
    },
    email: {
      to: 'maria.delgado@example.com',
      subject: 'Your remodel proposal — Delgado Kitchen + Primary Bath',
      body: `Hi Maria,\n\nThanks for the great conversation. Based on what you shared, we've put together a line-item proposal for your kitchen and primary bath remodel, including opening up the kitchen/dining wall — estimated at $135,000 over a 10–12 week timeline.\n\nThe attached proposal breaks down every line item. Once you've had a look, we'd love to schedule the on-site measure and confirm the structural assessment.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  },
  {
    extraction: {
      client: 'Okafor Residence (homeowners: Ada & Chidi Okafor)',
      contact: 'Ada Okafor',
      projectType: 'Whole-home renovation of a 1910 Victorian',
      scopeHighlights: [
        'Re-plumb and re-wire throughout; new HVAC',
        'Restore original millwork + refinish floors',
        'New kitchen and two bathrooms; finish the attic',
      ],
      budgetSignal: 'Around $280–340k; financing in place',
      timeline: 'Flexible; ready to start in the spring',
      risks: ['Knob-and-tube wiring', 'Possible asbestos in old insulation', 'Permit timeline for a historic district'],
      nextSteps: ['Full design phase', 'Historic-district pre-review', 'Hazmat inspection'],
    },
    crmEntry: {
      account: 'Okafor Residence — Evanston',
      contactName: 'Ada Okafor',
      opportunityName: 'Okafor Whole-Home Victorian Renovation',
      stage: 'Discovery',
      estimatedValue: '$310,000',
      summary:
        'Whole-home renovation of a 1910 Victorian: re-plumb/re-wire, new HVAC, kitchen + two baths, restore millwork, finish attic. Historic district. Spring start.',
      tags: ['whole-home', 'historic', 'renovation', 'high-value'],
    },
    proposal: {
      title: 'Proposal — Okafor Whole-Home Victorian Renovation',
      summary: 'Phased design-build renovation of a 1910 Victorian, preserving original character while modernizing systems.',
      lineItems: [
        { name: 'Systems: plumbing, electrical, HVAC', detail: 'Full re-plumb + re-wire, new high-efficiency HVAC', price: '$118,000' },
        { name: 'Kitchen + two bathrooms', detail: 'New kitchen and two full baths, period-appropriate fixtures', price: '$96,000' },
        { name: 'Millwork restoration + floors', detail: 'Restore trim/casework, refinish hardwood throughout', price: '$52,000' },
        { name: 'Attic finish + design/PM', detail: 'Conditioned attic suite, drawings, permits, historic review', price: '$44,000' },
      ],
      subtotal: '$310,000',
      timelineText: 'Phased over ~7–9 months from permit approval, sequenced to keep part of the home livable.',
      exclusions: ['Hazmat abatement (priced after inspection)', 'Landscape/exterior masonry', 'Appliance allowances over budget'],
    },
    email: {
      to: 'ada.okafor@example.com',
      subject: 'Your whole-home renovation proposal — Okafor Victorian',
      body: `Hi Ada,\n\nWhat a special house. Here's our phased proposal to modernize the systems and kitchen/baths while restoring the original millwork and floors — estimated at $310,000, sequenced over 7–9 months so you keep part of the home livable.\n\nNext we'd line up the historic-district pre-review and a hazmat inspection before we finalize. Take a look and let's pick a design-phase start date.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  },
  {
    extraction: {
      client: 'Tanaka Residence (homeowner: Kenji Tanaka)',
      contact: 'Kenji Tanaka',
      projectType: 'Detached backyard ADU / in-law suite',
      scopeHighlights: [
        'New ~600 sq ft detached ADU with kitchenette + full bath',
        'Separate entrance, mini-split HVAC',
        'Tie into existing utilities',
      ],
      budgetSignal: 'Targeting $180–220k',
      timeline: 'Wants it done within 6 months for an aging parent',
      risks: ['Setback / zoning variance', 'Utility tie-in distance', 'Soil/grading at the rear lot'],
      nextSteps: ['Zoning feasibility check', 'Survey + site plan', 'Schematic design'],
    },
    crmEntry: {
      account: 'Tanaka Residence — Berwyn',
      contactName: 'Kenji Tanaka',
      opportunityName: 'Tanaka Backyard ADU (In-Law Suite)',
      stage: 'Qualification',
      estimatedValue: '$210,000',
      summary:
        'Detached ~600 sq ft ADU with kitchenette, full bath, separate entrance for an aging parent. 6-month target. Needs zoning feasibility + survey.',
      tags: ['adu', 'new-construction', 'accessory-dwelling'],
    },
    proposal: {
      title: 'Proposal — Tanaka Backyard ADU',
      summary: 'Turnkey detached accessory dwelling unit designed for comfortable single-level living.',
      lineItems: [
        { name: 'Foundation + shell', detail: 'Slab, framing, roofing, siding, windows/doors', price: '$92,000' },
        { name: 'Interior + kitchenette + bath', detail: 'Finishes, cabinets, full bath, accessible fixtures', price: '$64,000' },
        { name: 'Mechanical + utility tie-in', detail: 'Mini-split HVAC, electrical, plumbing, sewer/water connect', price: '$34,000' },
        { name: 'Design, survey + permits', detail: 'Zoning feasibility, survey, drawings, permitting', price: '$20,000' },
      ],
      subtotal: '$210,000',
      timelineText: 'Approx. 5–6 months from permit approval, weather permitting.',
      exclusions: ['Zoning variance fees if required', 'Landscaping/fencing', 'Major rear-lot grading'],
    },
    email: {
      to: 'kenji.tanaka@example.com',
      subject: 'Your backyard ADU proposal — Tanaka in-law suite',
      body: `Hi Kenji,\n\nThanks for walking me through the plan for your parent's suite. Here's a turnkey proposal for a ~600 sq ft detached ADU with a kitchenette and accessible full bath — estimated at $210,000 over about 5–6 months.\n\nOur first step is a quick zoning feasibility check and a survey so we can confirm setbacks. Have a look and we'll get that scheduled.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  },
  {
    extraction: {
      client: 'Brennan Residence (homeowners: Shauna & Paul Brennan)',
      contact: 'Shauna Brennan',
      projectType: 'Primary suite addition + rear deck',
      scopeHighlights: [
        'Second-story primary suite addition with walk-in closet',
        'Spa bath with soaking tub',
        'New 400 sq ft rear deck off the kitchen',
      ],
      budgetSignal: 'Around $150–180k',
      timeline: 'Hoping to start late summer',
      risks: ['Roof tie-in complexity', 'Existing foundation load capacity', 'Deck footings near the property line'],
      nextSteps: ['Structural assessment', 'Schematic design', 'Proposal'],
    },
    crmEntry: {
      account: 'Brennan Residence — La Grange',
      contactName: 'Shauna Brennan',
      opportunityName: 'Brennan Primary Suite Addition + Deck',
      stage: 'Proposal',
      estimatedValue: '$165,000',
      summary:
        'Second-story primary suite addition (walk-in closet + spa bath) plus a 400 sq ft rear deck. Budget ~$150–180k. Late-summer start. Needs structural assessment.',
      tags: ['addition', 'primary-suite', 'deck'],
    },
    proposal: {
      title: 'Proposal — Brennan Primary Suite Addition + Deck',
      summary: 'A second-story primary suite addition with a spa bath, plus a connected rear deck.',
      lineItems: [
        { name: 'Suite addition shell', detail: 'Framing, roof tie-in, windows, insulation, drywall', price: '$78,000' },
        { name: 'Spa bath + walk-in closet', detail: 'Soaking tub, tile shower, double vanity, custom closet', price: '$46,000' },
        { name: 'Rear deck', detail: '400 sq ft composite deck, footings, railings, stairs', price: '$24,000' },
        { name: 'Structural, design + permits', detail: 'Engineering, drawings, permitting, PM', price: '$17,000' },
      ],
      subtotal: '$165,000',
      timelineText: 'Approx. 12–14 weeks from permit approval.',
      exclusions: ['Foundation reinforcement if required by engineer', 'Landscaping under the deck', 'Furniture'],
    },
    email: {
      to: 'shauna.brennan@example.com',
      subject: 'Your addition proposal — Brennan primary suite + deck',
      body: `Hi Shauna,\n\nLoved the vision for the new primary suite. Attached is our proposal for the second-story addition with a spa bath and walk-in closet, plus the rear deck off the kitchen — estimated at $165,000 over about 12–14 weeks.\n\nThe one thing we'll confirm first is a structural assessment for the addition's load. Take a look and we'll line that up.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  },
  {
    extraction: {
      client: 'Russo Residence (homeowners: Gina & Marco Russo)',
      contact: 'Marco Russo',
      projectType: 'Basement finish: family room, wet bar, home theater',
      scopeHighlights: [
        'Finish ~900 sq ft basement: family room + home theater',
        'Wet bar with beverage fridge',
        'Egress window + full bathroom',
      ],
      budgetSignal: 'Around $85–110k',
      timeline: 'No rush; sometime this year',
      risks: ['Moisture / waterproofing', 'Egress window excavation', 'Low ceiling height in one zone'],
      nextSteps: ['Moisture assessment', 'Layout design', 'Proposal'],
    },
    crmEntry: {
      account: 'Russo Residence — Naperville',
      contactName: 'Marco Russo',
      opportunityName: 'Russo Basement Finish + Home Theater',
      stage: 'Discovery',
      estimatedValue: '$95,000',
      summary:
        'Finish a ~900 sq ft basement: family room, home theater, wet bar, egress window, full bath. Budget ~$85–110k. Flexible timeline. Needs moisture assessment.',
      tags: ['basement', 'finish', 'home-theater'],
    },
    proposal: {
      title: 'Proposal — Russo Basement Finish + Home Theater',
      summary: 'A finished basement built around a family room, home theater, and wet bar.',
      lineItems: [
        { name: 'Framing, insulation, drywall', detail: 'Full finish of ~900 sq ft, sound insulation at theater', price: '$38,000' },
        { name: 'Home theater + family room', detail: 'Wiring, recessed lighting, built-ins, flooring', price: '$26,000' },
        { name: 'Wet bar + full bathroom', detail: 'Bar cabinetry, beverage fridge, sink, full bath', price: '$22,000' },
        { name: 'Egress, design + permits', detail: 'Egress window + well, drawings, permitting', price: '$9,000' },
      ],
      subtotal: '$95,000',
      timelineText: 'Approx. 8–10 weeks from permit approval.',
      exclusions: ['Exterior waterproofing if assessment requires it', 'AV equipment', 'Bar appliances over allowance'],
    },
    email: {
      to: 'marco.russo@example.com',
      subject: 'Your basement proposal — Russo family room + theater',
      body: `Hi Marco,\n\nThanks for the tour. Here's our proposal to finish the basement into a family room, home theater, and wet bar with a full bath — estimated at $95,000 over about 8–10 weeks.\n\nBefore we start we'll do a quick moisture assessment so the finish lasts. Have a look and let us know what you think.\n\nWarmly,\nThe Vino Design Build Team`,
    },
  },
]

/** Deterministic per-run scenario pick from the demo ref (varied across runs). */
export function scenarioIndex(ref?: string): number {
  if (!ref) return 0
  let h = 0
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0
  return h % SCENARIOS.length
}

/** The scenario for a run, falling back to the first when no ref / out of range. */
export function pickScenario(ref?: string): DemoScenario {
  return SCENARIOS[scenarioIndex(ref)] ?? SCENARIOS[0]!
}
