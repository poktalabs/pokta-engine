/**
 * Operator dashboard page (Lane C / TASK-003). Read-only. A static HTML shell
 * that polls GET /dashboard/api/overview every few seconds and renders the four
 * views client-side: Runs, Approvals, Workflows-as-nodes, and Integrations +
 * outcome registry.
 *
 * D3 fail-soft rendering: a run can be status:'succeeded' while its outcome is
 * status:'failed'. The outcome registry renders these DISTINCTLY — the run chip
 * stays green, the outcome row goes red with the error and a retry affordance.
 * Mid-flight runs with no crmResult/sendResult yet simply don't appear in the
 * registry (handled in buildOutcomes), so nothing crashes.
 */
export function dashboardPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>godin-engine · operator dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0b0d12;--panel:#14181f;--panel2:#0f131a;--border:#232a36;--text:#e7ebf2;
    --muted:#8b94a6;--amber:#f5b544;--green:#3ecf8e;--red:#f2606b;--blue:#5b9bff}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 70% -10%,#161b26 0,var(--bg) 55%);
    color:var(--text);font-family:Inter,system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1080px;margin:0 auto;padding:30px 22px 70px}
  a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
  header{display:flex;align-items:center;gap:14px;margin-bottom:4px}
  .logo{font-weight:700;font-size:20px;letter-spacing:-.02em}.logo b{color:var(--amber)}
  .tag{color:var(--muted);font-size:13px}
  .live{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(62,207,142,.5)}70%{box-shadow:0 0 0 7px rgba(62,207,142,0)}100%{box-shadow:0 0 0 0 rgba(62,207,142,0)}}
  .sub{color:var(--muted);font-size:13px;margin:4px 0 18px}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
  .stat{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:9px 14px;min-width:104px}
  .stat .n{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
  .stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .stat.alert .n{color:var(--red)}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:30px 0 8px}
  table{width:100%;border-collapse:collapse;font-size:13px;background:var(--panel);
    border:1px solid var(--border);border-radius:12px;overflow:hidden}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);
    padding:10px 12px;border-bottom:1px solid var(--border)}
  td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
  tr:last-child td{border-bottom:0}
  code,.mono{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:#aeb6c6}
  .muted{color:var(--muted)}
  .empty{color:var(--muted);font-size:13px;padding:14px}
  .pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
  .pill.ok,.pill.succeeded,.pill.approved{background:rgba(62,207,142,.14);color:var(--green)}
  .pill.failed,.pill.rejected{background:rgba(242,96,107,.14);color:var(--red)}
  .pill.pending,.pill.running,.pill.queued{background:rgba(245,181,68,.14);color:var(--amber)}
  .pill.simulated{background:rgba(139,148,166,.16);color:var(--muted)}
  .simnote{color:var(--muted);font-size:11px;margin-top:3px}
  /* node graph */
  .rail{display:flex;align-items:stretch;gap:0;background:var(--panel);border:1px solid var(--border);
    border-radius:14px;padding:18px 10px;overflow-x:auto}
  .gnode{flex:1;min-width:150px;display:flex;flex-direction:column;align-items:center;gap:8px;
    text-align:center;padding:0 8px;position:relative}
  .gnode:not(:last-child)::after{content:"→";position:absolute;right:-6px;top:18px;color:var(--border);font-size:18px}
  .gbead{width:36px;height:36px;border-radius:9px;border:2px solid var(--border);background:var(--panel2);
    display:flex;align-items:center;justify-content:center;font-size:15px}
  .gnode.gate .gbead{border-color:var(--amber);color:var(--amber);border-radius:50%}
  .gnode.step .gbead{border-color:var(--blue);color:var(--blue)}
  .gname{font-size:12.5px;font-weight:600}
  .gmeta{font-size:10.5px;color:var(--muted)}
  .gint{font-size:10px;font-weight:600;padding:1px 7px;border-radius:999px;background:rgba(91,155,255,.14);color:var(--blue)}
  .gpol{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--amber);max-width:150px}
  /* outcome failure callout */
  tr.outcome-fail td{background:rgba(242,96,107,.06)}
  .retry{display:inline-block;margin-top:4px;font-size:11px;font-weight:600;color:var(--red);
    border:1px solid rgba(242,96,107,.4);border-radius:7px;padding:3px 9px;background:transparent;cursor:default}
  .errmsg{color:var(--red);font-size:12px;margin-top:3px}
  .notewrap{margin-top:30px;color:var(--muted);font-size:12px}
</style></head><body><div class="wrap">
  <header>
    <div class="logo">godin<b>·</b>engine</div>
    <div class="tag">operator dashboard · read-only</div>
    <div class="live"><span class="dot"></span> live</div>
  </header>
  <div class="sub">Observes engine_runs, engine_approvals, listManifests() and the outcome registry
    (crmResult / sendResult on run output). Never writes. <a href="/demo">demo</a> · <a href="/demo/ops">ops</a></div>
  <div class="stats" id="stats"></div>

  <h2>Workflow node graph · derived from policy[] + parentRunId chain</h2>
  <div class="rail" id="graph"><div class="empty">loading…</div></div>

  <h2>Runs · engine_runs</h2>
  <table id="runs"><tr><th>workflow</th><th>status</th><th>consumer</th><th>run</th><th>parent</th><th>created (UTC)</th><th>finished</th></tr>
    <tr><td class="empty" colspan="7">loading…</td></tr></table>

  <h2 id="approvals">Approvals · engine_approvals</h2>
  <table id="approvalsT"><tr><th>onApprove →</th><th>state</th><th>approver</th><th>decided by</th><th>source run</th><th>dispatched</th><th>created (UTC)</th></tr>
    <tr><td class="empty" colspan="7">loading…</td></tr></table>

  <h2>Integrations &amp; outcome registry · scanned from run output (no new table)</h2>
  <table id="outcomes"><tr><th>provider</th><th>run status</th><th>outcome</th><th>ref / message id</th><th>artifact</th><th>workflow</th><th>at (UTC)</th></tr>
    <tr><td class="empty" colspan="7">loading…</td></tr></table>

  <p class="notewrap">A run can be <b style="color:var(--green)">succeeded</b> while its outcome is
    <b style="color:var(--red)">failed</b> (fail-soft, D3) — those rows are highlighted red with the error and a retry affordance.
    Read-only: retry is wired by the consumer's control plane, not this dashboard.</p>
</div>
<script>
const $=(id)=>document.getElementById(id);
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const short=(s)=>esc((s||'').slice(0,8));
const ts=(v)=>{if(!v)return '';try{return new Date(v).toISOString().replace('T',' ').slice(0,19)}catch(e){return esc(v)}};
const pill=(s)=>'<span class="pill '+esc(s)+'">'+esc(s)+'</span>';

function renderStats(o){
  const c=o.counts||{};
  const cells=[
    ['runs',c.runs],['pending gates',c.pendingApprovals],
    ['CRM rows',c.crmCreated],['emails sent',c.emailsSent],
    ['failed outcomes',c.failedOutcomes,(c.failedOutcomes>0)],
  ];
  $('stats').innerHTML=cells.map(([l,n,alert])=>
    '<div class="stat'+(alert?' alert':'')+'"><div class="n">'+(n??0)+'</div><div class="l">'+esc(l)+'</div></div>').join('');
}

function renderGraph(g){
  const els=(g&&g.elements)||[];
  if(!els.length){$('graph').innerHTML='<div class="empty">no workflows</div>';return}
  $('graph').innerHTML=els.map(e=>{
    if(e.kind==='gate'){
      return '<div class="gnode gate"><div class="gbead">★</div>'+
        '<div class="gname">human gate</div><div class="gmeta">guards '+esc(e.guards)+'</div>'+
        '<div class="gpol">'+esc(e.approver)+'</div></div>';
    }
    const pols=(e.policies||[]).map(p=>esc(p.kind)+': '+esc(p.detail)).join(' · ');
    return '<div class="gnode step"><div class="gbead">▣</div>'+
      '<div class="gname">'+esc(e.id)+'</div>'+
      '<div class="gmeta">'+esc(e.runtime)+'</div>'+
      (e.integration?'<span class="gint">'+esc(e.integration)+'</span>':'')+
      (pols?'<div class="gpol">'+pols+'</div>':'')+'</div>';
  }).join('');
}

function renderRuns(runs){
  const rows=(runs||[]).map(r=>'<tr>'+
    '<td><code>'+esc(r.workflowId)+'</code></td>'+
    '<td>'+pill(r.status)+'</td>'+
    '<td>'+esc(r.consumerId)+'</td>'+
    '<td class="mono">'+short(r.runId)+'</td>'+
    '<td class="mono">'+short(r.parentRunId)+'</td>'+
    '<td class="muted">'+ts(r.createdAt)+'</td>'+
    '<td class="muted">'+ts(r.finishedAt)+'</td></tr>').join('');
  $('runs').innerHTML='<tr><th>workflow</th><th>status</th><th>consumer</th><th>run</th><th>parent</th><th>created (UTC)</th><th>finished</th></tr>'+
    (rows||'<tr><td class="empty" colspan="7">no runs yet</td></tr>');
}

function renderApprovals(aps){
  const rows=(aps||[]).map(a=>'<tr>'+
    '<td><code>'+esc(a.workflowId)+'</code></td>'+
    '<td>'+pill(a.state)+'</td>'+
    '<td>'+esc(a.approver)+'</td>'+
    '<td>'+esc(a.decidedBy||'—')+'</td>'+
    '<td class="mono">'+short(a.sourceRunId)+'</td>'+
    '<td class="mono">'+short(a.dispatchedRunId)+'</td>'+
    '<td class="muted">'+ts(a.createdAt)+'</td></tr>').join('');
  $('approvalsT').innerHTML='<tr><th>onApprove →</th><th>state</th><th>approver</th><th>decided by</th><th>source run</th><th>dispatched</th><th>created (UTC)</th></tr>'+
    (rows||'<tr><td class="empty" colspan="7">no gates yet</td></tr>');
}

function outcomeRow(o){
  const failed=o.status==='failed';
  const simulated=o.status==='simulated';
  // D3: run can be green while outcome is red. Render all three distinctly.
  let artifact='—';
  if(o.provider==='notion'&&o.url) artifact='<a href="'+esc(o.url)+'" target="_blank" rel="noopener">open Notion page →</a>';
  else if(o.url) artifact='<a href="'+esc(o.url)+'" target="_blank" rel="noopener">open →</a>';
  const outcomeCell=failed
    ?'<span class="pill failed">failed</span><div class="errmsg">'+esc(o.error||'integration failed')+'</div><span class="retry">↻ retry needed</span>'
    :simulated
    ?'<span class="pill simulated">simulated</span><div class="simnote">no provider key — side effect skipped</div>'
    :'<span class="pill ok">ok</span>';
  return '<tr'+(failed?' class="outcome-fail"':'')+'>'+
    '<td>'+esc(o.provider)+'</td>'+
    '<td>'+pill(o.runStatus)+'</td>'+
    '<td>'+outcomeCell+'</td>'+
    '<td class="mono">'+esc(o.ref||'—')+'</td>'+
    '<td>'+artifact+'</td>'+
    '<td><code>'+esc(o.workflowId)+'</code></td>'+
    '<td class="muted">'+ts(o.at)+'</td></tr>';
}

function renderOutcomes(out){
  const all=[...((out&&out.crm)||[]),...((out&&out.emails)||[])]
    .sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  const rows=all.map(outcomeRow).join('');
  $('outcomes').innerHTML='<tr><th>provider</th><th>run status</th><th>outcome</th><th>ref / message id</th><th>artifact</th><th>workflow</th><th>at (UTC)</th></tr>'+
    (rows||'<tr><td class="empty" colspan="7">no integration outcomes yet (mid-flight runs have no crmResult / sendResult)</td></tr>');
}

async function refresh(){
  try{
    const r=await fetch('/dashboard/api/overview',{cache:'no-store'});
    if(!r.ok) return;
    const o=await r.json();
    renderStats(o); renderGraph(o.graph); renderRuns(o.runs);
    renderApprovals(o.approvals); renderOutcomes(o.outcomes);
  }catch(e){}
}
refresh();
setInterval(refresh,2500);
</script>
</body></html>`
}
