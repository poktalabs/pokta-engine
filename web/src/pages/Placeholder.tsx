/**
 * P0 placeholder page. Real surfaces (Approvals, Workflows, Runs, Integrations,
 * Reports, Settings) replace these in P1–P4. Kept intentionally minimal — the
 * design system lands in P1.
 */
export default function Placeholder({ title }: { title: string }) {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>{title}</h1>
      <p>Placeholder — built in a later M2 phase.</p>
    </main>
  )
}
