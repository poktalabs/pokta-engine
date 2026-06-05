/**
 * Operator dashboard (Phase 0 shell — built out by Lane C / TASK-003).
 *
 * New surface, separate from the /demo storytelling console (D4). Read-only:
 * it observes engine_runs / engine_approvals / listManifests() and derives the
 * outcome registry from run output (crmResult / sendResult). It never writes.
 */
export function dashboardShellPage(): string {
  const views = [
    ['Runs', 'live engine_runs: status, workflow, consumer, timing'],
    ['Approvals', 'pending gates with approve / reject'],
    ['Workflows — nodes', 'step → gate → step graph, derived from policy[] + parentRunId'],
    ['Integrations & outcomes', 'Notion / Resend, plus the registry of CRM rows + emails sent'],
  ]
  const cards = views
    .map(
      ([t, d]) => `<div class="card"><h3>${t}</h3><p>${d}</p><span class="tag">TASK-003</span></div>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>godin-engine · dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  body{margin:0;background:#0b0d12;color:#e7ebf2;font-family:Inter,system-ui,sans-serif}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 22px 60px}
  a{color:#5b9bff;text-decoration:none}
  h1{font-size:20px;margin:0 0 2px}h1 b{color:#f5b544}
  .sub{color:#8b94a6;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
  .card{background:#14181f;border:1px solid #232a36;border-radius:12px;padding:16px 18px;position:relative}
  .card h3{margin:0 0 6px;font-size:15px}
  .card p{margin:0;color:#8b94a6;font-size:13px;line-height:1.5}
  .tag{position:absolute;top:14px;right:14px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#f5b544;border:1px solid #3a3320;background:#1c1a12;border-radius:6px;padding:2px 6px}
  .note{margin-top:26px;color:#8b94a6;font-size:12.5px}
</style></head><body><div class="wrap">
  <h1>godin<b>·</b>engine — operator dashboard</h1>
  <div class="sub">Phase 0 shell. Read-only operator surface. <a href="/demo">demo</a> · <a href="/demo/ops">ops</a></div>
  <div class="grid">${cards}</div>
  <p class="note">Views land in Lane C (TASK-003). Data comes from engine_runs, engine_approvals,
  listManifests(), and run output (crmResult / sendResult) — no new table.</p>
</div></body></html>`
}
