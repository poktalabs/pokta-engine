/**
 * Operator console UI (alternate to /dashboard). Single HTML shell with a fixed
 * left nav and one section per page (hash-routed), fed by /console/api/data.
 * Read-only. Kept beside /dashboard for comparison.
 */
export function consolePage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>godin-engine · console</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0a0c10; --panel:#12161d; --panel2:#161b23; --line:#222a36; --line2:#2c3645;
    --txt:#e7ebf2; --muted:#8b94a6; --muted2:#646d7e;
    --accent:#f5b544; --blue:#5b9bff; --green:#3ecf8e; --red:#f2606b; --amber:#f5b544; --purple:#b48cff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:Inter,system-ui,sans-serif;font-size:14px}
  a{color:var(--blue);text-decoration:none}
  code,.mono{font-family:'JetBrains Mono',monospace;font-size:12px}
  .app{display:grid;grid-template-columns:228px 1fr;min-height:100vh}

  /* sidebar */
  .side{background:#0c0f14;border-right:1px solid var(--line);padding:18px 14px;position:sticky;top:0;height:100vh}
  .brand{font-size:16px;font-weight:700;padding:6px 10px 16px}
  .brand b{color:var(--accent)}
  .brand .v{display:block;font-size:11px;color:var(--muted2);font-weight:500;margin-top:2px}
  .nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:var(--muted);font-weight:500;margin-bottom:2px}
  .nav a:hover{background:var(--panel);color:var(--txt)}
  .nav a.active{background:var(--panel2);color:var(--txt)}
  .nav a.active .ic{color:var(--accent)}
  .nav .ic{width:16px;text-align:center;font-size:13px;color:var(--muted2)}
  .nav .ct{margin-left:auto;font-size:11px;color:var(--muted2);font-family:'JetBrains Mono',monospace}
  .sidefoot{position:absolute;bottom:14px;left:14px;right:14px;font-size:11px;color:var(--muted2);line-height:1.6}
  .sidefoot a{color:var(--muted)}

  /* main */
  .main{padding:24px 30px 60px;max-width:1180px}
  .hd{display:flex;align-items:center;gap:12px;margin-bottom:4px}
  .hd h1{font-size:20px;margin:0;font-weight:700}
  .hd .dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}
  .sub{color:var(--muted);font-size:13px;margin-bottom:22px}

  /* tiles */
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:22px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tile .n{font-size:26px;font-weight:700;line-height:1}
  .tile .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-top:7px}

  /* tables */
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:24px 0 10px}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:10px 13px;border-bottom:1px solid var(--line);background:var(--panel2)}
  td{padding:9px 13px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}
  tr:last-child td{border-bottom:0}
  tr:hover td{background:rgba(255,255,255,.015)}
  .muted{color:var(--muted)} .mono.dim{color:var(--muted)}
  .empty{color:var(--muted);padding:16px;font-size:13px}

  /* pills */
  .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid transparent}
  .pill.green{color:var(--green);background:rgba(62,207,142,.1);border-color:rgba(62,207,142,.25)}
  .pill.red{color:var(--red);background:rgba(242,96,107,.1);border-color:rgba(242,96,107,.25)}
  .pill.amber{color:var(--amber);background:rgba(245,181,68,.1);border-color:rgba(245,181,68,.25)}
  .pill.grey{color:var(--muted);background:rgba(139,148,166,.1);border-color:rgba(139,148,166,.22)}
  .pill.blue{color:var(--blue);background:rgba(91,155,255,.1);border-color:rgba(91,155,255,.25)}
  .pill.purple{color:var(--purple);background:rgba(180,140,255,.1);border-color:rgba(180,140,255,.25)}

  /* cards */
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .card h3{margin:0 0 4px;font-size:15px;display:flex;align-items:center;gap:8px}
  .card .meta{color:var(--muted);font-size:12px;margin-bottom:10px}
  .kv{display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid rgba(255,255,255,.05);font-size:12.5px}
  .kv .k{color:var(--muted)}

  /* pipeline graph */
  .flow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
  .node{border:1px solid var(--line2);border-radius:10px;padding:10px 13px;min-width:130px;background:var(--panel2)}
  .node .t{font-weight:600;font-size:13px}
  .node .r{font-size:11px;color:var(--muted);margin-top:3px}
  .node .intg{margin-top:7px}
  .gate{border:1px dashed var(--amber);border-radius:10px;padding:10px 12px;background:rgba(245,181,68,.06);text-align:center;min-width:96px}
  .gate .t{font-size:11px;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .gate .a{font-size:11px;color:var(--muted);margin-top:3px}
  .arrow{color:var(--muted2);font-size:18px}
  .banner{background:rgba(245,181,68,.08);border:1px solid rgba(245,181,68,.25);border-radius:10px;padding:11px 14px;color:#d9c08a;font-size:12.5px;margin-bottom:18px}
</style></head><body>
<div class="app">
  <aside class="side">
    <div class="brand">godin<b>·</b>engine<span class="v">operator console</span></div>
    <nav class="nav" id="nav">
      <a href="#jobs"          data-s="jobs"><span class="ic">▸</span>Jobs<span class="ct" id="ct-jobs"></span></a>
      <a href="#workflows"     data-s="workflows"><span class="ic">⛭</span>Workflows<span class="ct" id="ct-workflows"></span></a>
      <a href="#integrations"  data-s="integrations"><span class="ic">⤫</span>Integrations<span class="ct" id="ct-integrations"></span></a>
      <a href="#policies"      data-s="policies"><span class="ic">§</span>Policies<span class="ct" id="ct-policies"></span></a>
      <a href="#observability" data-s="observability"><span class="ic">◎</span>Observability</a>
      <a href="#state"         data-s="state"><span class="ic">▤</span>Database / State<span class="ct" id="ct-state"></span></a>
    </nav>
    <div class="sidefoot">
      read-only · polls every 3s<br/>
      <a href="/dashboard">↗ old dashboard</a> · <a href="/demo">demo</a>
    </div>
  </aside>
  <main class="main">
    <div class="hd"><span class="dot"></span><h1 id="title">Jobs</h1></div>
    <div class="sub" id="subtitle">loading…</div>
    <div id="view"></div>
  </main>
</div>
<script>
const SECTIONS = {
  jobs:'Jobs', workflows:'Workflows', integrations:'Integrations',
  policies:'Policies', observability:'Observability', state:'Database / State'
};
const SUBS = {
  jobs:'Every run the engine has launched — the parallel job pool (engine_runs).',
  workflows:'Registered workflows, their runtime, timeout, policies, and the pipeline graph.',
  integrations:'External systems the engine writes to, and the registry of outcomes.',
  policies:'Governance: quota + human-approval policies, the quota ledger, and gates.',
  observability:'Health at a glance — throughput, statuses, and failures to act on.',
  state:'The system-of-record: raw row counts and recent rows per table.'
};
let DATA = null;
const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sh = (s)=>s?esc(String(s).slice(0,8)):'—';
const ts = (v)=>{ if(!v) return '—'; try{return new Date(v).toISOString().replace('T',' ').slice(0,19);}catch{return esc(v);} };
function statusPill(s){
  const m={succeeded:'green',approved:'green',ok:'green',failed:'red',rejected:'red',running:'amber',pending:'amber',queued:'grey'};
  return '<span class="pill '+(m[s]||'grey')+'">'+esc(s)+'</span>';
}
function rtPill(r){ const m={agent:'purple',sandbox:'blue',serverless:'grey'}; return '<span class="pill '+(m[r]||'grey')+'">'+esc(r)+'</span>'; }
function tbl(head, rows){ if(!rows) rows=''; return '<table><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+(rows||'<tr><td class="empty" colspan="'+head.length+'">nothing here yet</td></tr>')+'</table>'; }

function activeSection(){ return (location.hash.replace('#','')||'jobs'); }

function render(){
  const s = activeSection();
  $('title').textContent = SECTIONS[s]||'Jobs';
  $('subtitle').textContent = DATA ? (SUBS[s]||'') : 'loading…';
  document.querySelectorAll('#nav a').forEach(a=>a.classList.toggle('active', a.dataset.s===s));
  if(!DATA){ $('view').innerHTML=''; return; }
  $('view').innerHTML = (VIEWS[s]||VIEWS.jobs)();
}

const VIEWS = {
  jobs(){
    const o=DATA.overview, c=o.counts;
    const tiles = [['runs',c.runs],['queued',c.runsByStatus.queued||0],['running',c.runsByStatus.running||0],
      ['succeeded',c.runsByStatus.succeeded||0],['failed',c.runsByStatus.failed||0],['pending gates',c.pendingApprovals]];
    const t = '<div class="tiles">'+tiles.map(([l,n])=>'<div class="tile"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('')+'</div>';
    const rows = o.runs.map(r=>'<tr><td><code>'+esc(r.workflowId)+'</code></td><td>'+statusPill(r.status)+'</td><td>'+esc(r.consumerId)+'</td><td class="mono dim">'+sh(r.runId)+'</td><td class="mono dim">'+sh(r.parentRunId)+'</td><td class="muted">'+ts(r.createdAt)+'</td><td class="muted">'+ts(r.finishedAt)+'</td></tr>').join('');
    return t+'<h2>Job runs · engine_runs</h2>'+tbl(['workflow','status','consumer','run','parent','created (UTC)','finished'],rows);
  },
  workflows(){
    const g=DATA.overview.graph;
    const flow = '<h2>Pipeline graph</h2><div class="flow">'+g.elements.map((e,i)=>{
      const a = i>0?'<span class="arrow">→</span>':'';
      if(e.kind==='gate') return a+'<div class="gate"><div class="t">⛓ gate</div><div class="a">'+esc(e.approver)+'</div></div>';
      const intg = e.integration?'<div class="intg"><span class="pill '+(e.integration==='notion'?'blue':'purple')+'">'+esc(e.integration)+'</span></div>':'';
      return a+'<div class="node"><div class="t">'+esc(e.id)+'</div><div class="r">'+rtPill(e.runtime)+'</div>'+intg+'</div>';
    }).join('')+'</div>';
    const cards = '<h2>Registered workflows</h2><div class="cards">'+DATA.workflows.map(w=>{
      const pol = w.policies.length?w.policies.map(p=>'<div class="kv"><span class="k">'+esc(p.kind)+'</span><span>'+esc(p.detail||'—')+'</span></div>').join(''):'<div class="kv"><span class="k">policy</span><span class="muted">none</span></div>';
      return '<div class="card"><h3>'+esc(w.id)+' '+rtPill(w.runtime)+'</h3><div class="meta">v'+esc(w.version)+' · timeout '+(w.timeoutMs/1000)+'s</div>'+pol+'</div>';
    }).join('')+'</div>';
    return flow+cards;
  },
  integrations(){
    const cards = '<div class="cards">'+DATA.integrations.map(i=>(
      '<div class="card"><h3>'+esc(i.provider)+' '+(i.configured?'<span class="pill green">configured</span>':'<span class="pill grey">not set</span>')+'</h3><div class="meta">'+esc(i.detail)+'</div></div>'
    )).join('')+'</div>';
    const note = '<div class="banner">Config status reflects the <b>engine-api</b> process env. The <b>worker</b> is what runs the integrations — on Railway it has its own env. Outcomes below come from real run output (no creds locally → expect empty or failed).</div>';
    const o=DATA.overview.outcomes;
    const crm = o.crm.map(x=>'<tr><td><code>'+esc(x.workflowId)+'</code></td><td>'+statusPill(x.status)+'</td><td>'+(x.url?'<a href="'+esc(x.url)+'" target="_blank">open ↗</a>':'<span class="muted">'+sh(x.ref)+'</span>')+'</td><td class="muted">'+(x.error?esc(x.error):'—')+'</td><td class="muted">'+ts(x.at)+'</td></tr>').join('');
    const em = o.emails.map(x=>'<tr><td><code>'+esc(x.workflowId)+'</code></td><td>'+statusPill(x.status)+'</td><td class="mono dim">'+(x.ref?esc(x.ref):'—')+'</td><td class="muted">'+(x.error?esc(x.error):'—')+'</td><td class="muted">'+ts(x.at)+'</td></tr>').join('');
    return note+cards+'<h2>CRM rows · Notion (crmResult)</h2>'+tbl(['workflow','outcome','page','error','at'],crm)+'<h2>Emails sent · Resend (sendResult)</h2>'+tbl(['workflow','outcome','message id','error','at'],em);
  },
  policies(){
    const wf = DATA.workflows.filter(w=>w.policies.length);
    const rows = wf.flatMap(w=>w.policies.map(p=>'<tr><td><code>'+esc(w.id)+'</code></td><td><span class="pill '+(p.kind==='approval'?'amber':'blue')+'">'+esc(p.kind)+'</span></td><td>'+esc(p.detail||'—')+'</td></tr>')).join('');
    const ql = DATA.quotaLedger.map(q=>'<tr><td>'+esc(q.consumerId)+'</td><td><code>'+esc(q.workflowId)+'</code></td><td class="muted">'+esc(q.day)+'</td><td>'+esc(q.count)+'</td></tr>').join('');
    const ap = DATA.overview.approvals.map(a=>'<tr><td><code>'+esc(a.workflowId)+'</code></td><td>'+statusPill(a.state)+'</td><td>'+esc(a.approver)+'</td><td class="muted">'+esc(a.decidedBy||'—')+'</td><td class="mono dim">'+sh(a.sourceRunId)+'</td><td class="muted">'+ts(a.createdAt)+'</td></tr>').join('');
    return '<h2>Declared policies (per workflow)</h2>'+tbl(['workflow','kind','detail'],rows)+
      '<h2>Quota ledger · engine_quota_ledger</h2>'+tbl(['consumer','workflow','day (UTC)','count'],ql)+
      '<h2>Approval gates · engine_approvals</h2>'+tbl(['onApprove →','state','approver','decided by','source run','created'],ap);
  },
  observability(){
    const o=DATA.overview, c=o.counts;
    const tiles=[['total jobs',c.runs],['succeeded',c.runsByStatus.succeeded||0],['failed',c.runsByStatus.failed||0],
      ['pending gates',c.pendingApprovals],['CRM created',c.crmCreated],['emails sent',c.emailsSent],['failed outcomes',c.failedOutcomes]];
    const t='<div class="tiles">'+tiles.map(([l,n])=>'<div class="tile"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('')+'</div>';
    const f=o.outcomes.failures.map(x=>'<tr><td><span class="pill '+(x.provider==='notion'?'blue':'purple')+'">'+esc(x.provider)+'</span></td><td><code>'+esc(x.workflowId)+'</code></td><td>run '+statusPill(x.runStatus)+' / outcome '+statusPill(x.status)+'</td><td class="muted">'+esc(x.error||'—')+'</td><td class="mono dim">'+sh(x.runId)+'</td></tr>').join('');
    const recent=o.runs.slice(0,12).map(r=>'<tr><td><code>'+esc(r.workflowId)+'</code></td><td>'+statusPill(r.status)+'</td><td class="muted">'+ts(r.createdAt)+'</td><td class="muted">'+ts(r.finishedAt)+'</td></tr>').join('');
    return t+'<h2>Failed outcomes — needs retry (fail-soft)</h2>'+tbl(['provider','workflow','run / outcome','error','run'],f)+'<h2>Recent activity</h2>'+tbl(['workflow','status','created','finished'],recent);
  },
  state(){
    return DATA.tables.map(t=>{
      const cols = t.recent.length?Object.keys(t.recent[0]).filter(k=>k!=='input'&&k!=='output'&&k!=='error'&&k!=='artifact'):[];
      const rows = t.recent.map(r=>'<tr>'+cols.map(k=>{
        let v=r[k]; if(v&&typeof v==='object') v=JSON.stringify(v); if(typeof v==='string'&&v.length>32) v=v.slice(0,32)+'…';
        return '<td class="'+(k.endsWith('At')||k==='day'?'muted':'mono dim')+'">'+esc(v==null?'—':v)+'</td>';
      }).join('')+'</tr>').join('');
      return '<h2>'+esc(t.name)+' · <span class="muted">'+t.count+' rows</span></h2>'+(cols.length?tbl(cols,rows):'<div class="empty">empty</div>');
    }).join('');
  }
};

function counts(){
  if(!DATA) return;
  const c=DATA.overview.counts;
  const set=(id,v)=>{const el=$(id); if(el) el.textContent=v;};
  set('ct-jobs',c.runs); set('ct-workflows',DATA.workflows.length);
  set('ct-integrations',DATA.integrations.filter(i=>i.configured).length+'/'+DATA.integrations.length);
  set('ct-policies',DATA.workflows.filter(w=>w.policies.length).length);
  set('ct-state',DATA.tables.reduce((a,t)=>a+t.count,0));
}

async function load(){
  try{
    const r=await fetch('/console/api/data'); DATA=await r.json(); counts(); render();
  }catch(e){ $('subtitle').textContent='failed to load: '+e; }
}
window.addEventListener('hashchange',render);
load(); setInterval(load,3000);
</script>
</body></html>`
}
