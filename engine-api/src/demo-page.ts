import { SEED_TRANSCRIPT } from './demo-data'

export function demoPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>godin-engine · Vino call-to-proposal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#0b0d12; --panel:#14181f; --panel2:#0f131a; --border:#232a36;
    --text:#e7ebf2; --muted:#8b94a6; --amber:#f5b544; --amber-dim:#7a6230;
    --green:#3ecf8e; --red:#f2606b; --blue:#5b9bff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 70% -10%,#161b26 0,var(--bg) 55%);color:var(--text);
    font-family:Inter,system-ui,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
  .wrap{max-width:980px;margin:0 auto;padding:32px 24px 80px}
  header{display:flex;align-items:center;gap:14px;margin-bottom:6px}
  .logo{font-weight:700;font-size:20px;letter-spacing:-.02em}
  .logo b{color:var(--amber)}
  .tag{color:var(--muted);font-size:13px}
  .live{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(62,207,142,.6);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(62,207,142,.5)}70%{box-shadow:0 0 0 7px rgba(62,207,142,0)}100%{box-shadow:0 0 0 0 rgba(62,207,142,0)}}
  h1{font-size:26px;letter-spacing:-.02em;margin:18px 0 4px}
  .sub{color:var(--muted);font-size:14px;margin-bottom:24px;max-width:680px}
  .sub b{color:var(--text);font-weight:600}

  /* rail */
  .rail{display:flex;align-items:flex-start;gap:0;margin:26px 0 8px;padding:18px 4px;background:var(--panel);
    border:1px solid var(--border);border-radius:14px}
  .node{flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;position:relative;text-align:center;padding:0 6px}
  .node:not(:last-child)::after{content:"";position:absolute;top:13px;left:calc(50% + 18px);right:calc(-50% + 18px);
    height:2px;background:var(--border)}
  .node.done:not(:last-child)::after{background:linear-gradient(90deg,var(--green),var(--border))}
  .bead{width:28px;height:28px;border-radius:50%;border:2px solid var(--border);background:var(--panel2);
    display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--muted);z-index:1;transition:.25s}
  .node.work .bead{border-color:var(--amber);color:var(--amber);animation:spin 1.1s linear infinite}
  .node.wait .bead{border-color:var(--amber);color:var(--amber);box-shadow:0 0 0 4px rgba(245,181,68,.12)}
  .node.done .bead{border-color:var(--green);color:var(--green);background:rgba(62,207,142,.1)}
  .node.err .bead{border-color:var(--red);color:var(--red)}
  @keyframes spin{to{transform:rotate(360deg)}}
  .node .lbl{font-size:11.5px;color:var(--muted);max-width:120px}
  .node.done .lbl,.node.work .lbl,.node.wait .lbl{color:var(--text)}
  .gate-mark{font-size:9px;letter-spacing:.08em;color:var(--amber);text-transform:uppercase;font-weight:600}

  /* controls */
  .controls{display:flex;align-items:center;gap:12px;margin:18px 0}
  button{font-family:inherit;font-weight:600;font-size:14px;border-radius:10px;border:1px solid var(--border);
    background:var(--panel);color:var(--text);padding:10px 16px;cursor:pointer;transition:.15s}
  button:hover{border-color:#33405a}
  button:disabled{opacity:.45;cursor:not-allowed}
  .btn-primary{background:var(--amber);color:#1a1407;border-color:var(--amber)}
  .btn-primary:hover{filter:brightness(1.06);border-color:var(--amber)}
  .btn-approve{background:var(--green);color:#04140c;border-color:var(--green)}
  .btn-reject{background:transparent;color:var(--red);border-color:#3a2730}
  .badge{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
  .badge.live{color:var(--green);border-color:rgba(62,207,142,.4)}
  .badge.scripted{color:var(--amber);border-color:var(--amber-dim)}

  details{margin:10px 0 4px;background:var(--panel2);border:1px solid var(--border);border-radius:12px}
  summary{cursor:pointer;padding:12px 16px;font-size:13px;color:var(--muted);font-weight:600}
  textarea{width:100%;min-height:200px;background:transparent;color:var(--text);border:0;border-top:1px solid var(--border);
    padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.6;resize:vertical;outline:none}

  /* cards */
  .feed{display:flex;flex-direction:column;gap:16px;margin-top:8px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 20px;animation:rise .35s ease}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .card h3{margin:0 0 2px;font-size:15px;display:flex;align-items:center;gap:9px}
  .chip{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px}
  .chip.pending{background:rgba(245,181,68,.14);color:var(--amber)}
  .chip.approved{background:rgba(62,207,142,.14);color:var(--green)}
  .chip.rejected{background:rgba(242,96,107,.14);color:var(--red)}
  .chip.work{background:rgba(91,155,255,.14);color:var(--blue)}
  .kicker{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:10px}
  .row{display:flex;gap:8px;font-size:13.5px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)}
  .row .k{color:var(--muted);min-width:128px}
  .row .v{color:var(--text)}
  .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .tags span{font-size:11px;padding:2px 9px;border-radius:999px;background:var(--panel2);border:1px solid var(--border);color:var(--muted)}
  table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13.5px}
  td{padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
  td.price{text-align:right;color:var(--amber);white-space:nowrap;font-variant-numeric:tabular-nums}
  .total td{border:0;font-weight:700;padding-top:12px}
  .email{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:4px}
  .email .meta{font-size:12.5px;color:var(--muted);padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--border)}
  .email .body{white-space:pre-wrap;font-size:13.5px}
  .gate-actions{display:flex;gap:10px;margin-top:16px;align-items:center}
  .gate-actions .who{font-size:12px;color:var(--muted);margin-left:auto}
  .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--amber);border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;margin-right:8px;vertical-align:-2px}
  .muted{color:var(--muted);font-size:13.5px}
  .sent{display:flex;align-items:center;gap:12px}
  .sent .big{font-size:30px}
  a.src{color:var(--blue);text-decoration:none}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">godin<b>·</b>engine</div>
    <div class="tag">control plane · governed agent pipelines</div>
    <div class="live"><span class="dot"></span> live</div>
  </header>

  <h1>Call → CRM → Proposal → Client email</h1>
  <div class="sub">An agent reads a discovery call and drafts the work. <b>Nothing is written or sent without a human approving it.</b> Two gates: approve the CRM entry, then approve the outbound email.</div>

  <div class="rail" id="rail"></div>

  <div class="controls">
    <button class="btn-primary" id="run">Run pipeline on this call</button>
    <button id="reset" style="display:none">Reset</button>
    <span class="badge" id="genby" style="display:none"></span>
  </div>

  <details id="tdetails" open>
    <summary>Call transcript (editable — paste a fresh Granola export to demo live)</summary>
    <textarea id="transcript" spellcheck="false"></textarea>
  </details>

  <div class="feed" id="feed"></div>
</div>

<script>
const SEED = ${JSON.stringify(SEED_TRANSCRIPT)};
const $ = (id)=>document.getElementById(id);
const esc = (s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
$('transcript').value = SEED;

const STAGES = [
  {key:'intake', kind:'run', wf:'call-intake', label:'Read call · extract'},
  {key:'crmGate', kind:'gate', gateFor:'proposal-step', label:'CRM review', gate:true},
  {key:'proposal', kind:'run', wf:'proposal-step', label:'Draft proposal + email'},
  {key:'emailGate', kind:'gate', gateFor:'send-step', label:'Send approval', gate:true},
  {key:'send', kind:'run', wf:'send-step', label:'Sent'},
];

let rootRunId=null, timer=null, lastSig=null;

function stateSig(s){
  const r=s.runsByWf||{};
  return JSON.stringify({
    i:r['call-intake']?.status, g:r['call-intake']?.output?.generatedBy,
    p:r['proposal-step']?.status, s:r['send-step']?.status,
    a:(s.approvals||[]).map(x=>[x.workflowId,x.state])
  });
}

function runStatusClass(st){return st==='succeeded'?'done':(st==='running'?'work':(st==='failed'?'err':(st==='queued'?'work':'idle')))}
function gateStatusClass(state){return state==='approved'?'done':(state==='pending'?'wait':(state==='rejected'?'err':'idle'))}
function bead(stage,cls){
  const sym = cls==='done'?'✓':(cls==='err'?'!':(cls==='work'?'◜':(stage.gate?'★':'·')));
  return sym;
}

function renderRail(state){
  const rail=$('rail'); rail.innerHTML='';
  STAGES.forEach(s=>{
    let cls='idle';
    if(state){
      if(s.kind==='run') cls=runStatusClass(state.runsByWf[s.wf]?.status);
      else cls=gateStatusClass((state.approvals.find(a=>a.workflowId===s.gateFor)||{}).state);
    }
    const n=document.createElement('div'); n.className='node '+cls;
    n.innerHTML='<div class="bead">'+bead(s,cls)+'</div>'+
      (s.gate?'<div class="gate-mark">human gate</div>':'')+
      '<div class="lbl">'+esc(s.label)+'</div>';
    rail.appendChild(n);
  });
}

function card(html){const d=document.createElement('div');d.className='card';d.innerHTML=html;return d}
function row(k,v){return '<div class="row"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>'}

function crmCard(crm, state, approval){
  const chip = state==='pending'?'<span class="chip pending">awaiting approval</span>'
    : state==='approved'?'<span class="chip approved">✓ approved → written to CRM</span>'
    : state==='rejected'?'<span class="chip rejected">rejected</span>':'';
  let h='<div class="kicker">Gate 1 · CRM opportunity (draft)</div>'+
    '<h3>'+esc(crm.opportunityName||'CRM entry')+' '+chip+'</h3>'+
    row('Account',crm.account)+row('Contact',crm.contactName)+row('Stage',crm.stage)+
    row('Est. value',crm.estimatedValue)+row('Summary',crm.summary)+
    '<div class="tags">'+(crm.tags||[]).map(t=>'<span>'+esc(t)+'</span>').join('')+'</div>';
  if(state==='pending'){
    h+='<div class="gate-actions"><button class="btn-approve" onclick="approve(\\''+approval.approvalId+'\\')">Approve CRM entry</button>'+
       '<button class="btn-reject" onclick="reject(\\''+approval.approvalId+'\\')">Reject</button>'+
       '<span class="who">approver: '+esc(approval.approver)+'</span></div>';
  }
  return card(h);
}

function proposalCard(p){
  let rows=(p.lineItems||[]).map(li=>'<tr><td><b>'+esc(li.name)+'</b><br><span class="muted">'+esc(li.detail)+'</span></td><td class="price">'+esc(li.price)+'</td></tr>').join('');
  return card('<div class="kicker">Proposal (drafted)</div><h3>'+esc(p.title||'Proposal')+'</h3>'+
    '<div class="muted" style="margin-bottom:6px">'+esc(p.summary)+'</div>'+
    '<table>'+rows+'<tr class="total"><td>Subtotal</td><td class="price">'+esc(p.subtotal)+'</td></tr></table>'+
    (p.timelineText?row('Timeline',p.timelineText):'')+
    ((p.exclusions&&p.exclusions.length)?'<div class="tags"><span class="muted" style="border:0;background:none;padding-left:0">excludes:</span>'+p.exclusions.map(e=>'<span>'+esc(e)+'</span>').join('')+'</div>':''));
}

function emailCard(em, state, approval){
  const chip = state==='pending'?'<span class="chip pending">awaiting approval</span>'
    : state==='approved'?'<span class="chip approved">✓ approved</span>'
    : state==='rejected'?'<span class="chip rejected">rejected</span>':'';
  let h='<div class="kicker">Gate 2 · Outbound client email (draft)</div>'+
    '<h3>Email to client '+chip+'</h3>'+
    '<div class="email"><div class="meta"><b>To:</b> '+esc(em.to)+' &nbsp; <b>Subject:</b> '+esc(em.subject)+'</div>'+
    '<div class="body">'+esc(em.body)+'</div></div>';
  if(state==='pending'){
    h+='<div class="gate-actions"><button class="btn-approve" onclick="approve(\\''+approval.approvalId+'\\')">Approve &amp; send</button>'+
       '<button class="btn-reject" onclick="reject(\\''+approval.approvalId+'\\')">Reject</button>'+
       '<span class="who">approver: '+esc(approval.approver)+'</span></div>';
  }
  return h?card(h):null;
}

function workingCard(title){return card('<div class="kicker">working</div><h3><span class="spinner"></span>'+esc(title)+'</h3><div class="muted">agent runtime is drafting…</div>')}

function render(state){
  renderRail(state);
  const feed=$('feed'); feed.innerHTML='';
  if(!state) return;
  const intake=state.runsByWf['call-intake'];
  const crmGate=state.approvals.find(a=>a.workflowId==='proposal-step');
  const prop=state.runsByWf['proposal-step'];
  const emailGate=state.approvals.find(a=>a.workflowId==='send-step');
  const send=state.runsByWf['send-step'];

  // generatedBy badge
  const gb=intake?.output?.generatedBy;
  if(gb){const b=$('genby');b.style.display='';b.className='badge '+(gb==='llm'?'live':'scripted');
    b.textContent=gb==='llm'?'drafted live by LLM':'scripted demo content';}

  if(intake && intake.status!=='succeeded' || (!intake)) feed.appendChild(workingCard('Reading the call & extracting the opportunity'));
  if(crmGate) feed.appendChild(crmCard(crmGate.artifact?.crmEntry||intake?.output?.crmEntry||{}, crmGate.state, crmGate));
  else if(intake?.status==='succeeded' && intake.output?.crmEntry) feed.appendChild(crmCard(intake.output.crmEntry,'',{}));

  if(prop && prop.status!=='succeeded') feed.appendChild(workingCard('Drafting the proposal & client email'));
  const proposal = prop?.output?.proposal || emailGate?.artifact?.proposal;
  if(proposal) feed.appendChild(proposalCard(proposal));

  if(emailGate){const ec=emailCard(emailGate.artifact?.email||prop?.output?.email||{}, emailGate.state, emailGate); if(ec) feed.appendChild(ec);}

  if(send?.status==='succeeded'){
    feed.appendChild(card('<div class="sent"><span class="big">✅</span><div><h3 style="margin:0">Email sent to '+esc(send.output?.to||'client')+'</h3>'+
      '<div class="muted">'+esc(send.output?.subject||'')+' · '+esc(send.output?.note||'')+'</div></div></div>'));
  }
}

async function poll(){
  if(!rootRunId) return;
  try{
    const r=await fetch('/demo/api/state/'+rootRunId); if(!r.ok) return;
    const state=await r.json();
    const sig=stateSig(state);
    if(sig!==lastSig){ lastSig=sig; render(state); }   // only repaint on real change
    if(state.runsByWf['send-step']?.status==='succeeded'){clearInterval(timer);timer=null;}
  }catch(e){}
}

$('run').onclick=async()=>{
  $('run').disabled=true; $('run').textContent='Running…';
  const transcript=$('transcript').value;
  const r=await fetch('/demo/api/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transcript})});
  const j=await r.json();
  if(j.error){alert(j.error);$('run').disabled=false;$('run').textContent='Run pipeline on this call';return;}
  rootRunId=j.rootRunId; lastSig=null;
  $('tdetails').open=false; $('run').style.display='none'; $('reset').style.display='';
  render(null);
  await poll(); timer=setInterval(poll,1500);
};
window.approve=async(id)=>{await fetch('/demo/api/approvals/'+id+'/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decided_by:'Carlos (owner)'})});await poll();};
window.reject=async(id)=>{await fetch('/demo/api/approvals/'+id+'/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decided_by:'Carlos (owner)'})});await poll();};
$('reset').onclick=()=>{location.reload()};
renderRail(null);
</script>
</body>
</html>`
}
