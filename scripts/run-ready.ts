import { readFileSync, writeFileSync } from 'node:fs'
import { computeSuggestedPrice, type Decision } from '../packages/workflows/pricing/lib/pricing-logic.js'
const FLOOR=15
const rows=JSON.parse(readFileSync('/tmp/mipase-ready-input.json','utf-8'))
const c:Record<Decision,number>={hold:0,lower_to_competitor:0,hold_above_floor:0,manual_review:0,skipped:0}
let priced=0,delta=0; const lines=['sku,producto,current_price,cost,competitor_ref,ref_store,decision,suggested,delta,reason']
const esc=(s:any)=>`"${String(s).replace(/"/g,'""')}"`
for(const r of rows){ if(r.current_price_mxn==null)continue
  const res=computeSuggestedPrice({sku:r.sku,current_price_mxn:r.current_price_mxn,cost_mxn:r.cost_mxn,competitor_min_mxn:r.competitor_min_mxn,margin_floor_pct:FLOOR})
  c[res.decision]++; const sug=res.suggested_price_mxn
  if(sug!=null){priced++; delta+=sug-r.current_price_mxn}
  lines.push([esc(r.sku),esc(r.producto),r.current_price_mxn,r.cost_mxn,r.competitor_min_mxn??'',esc(r.ref_store),res.decision,sug??'',sug!=null?(sug-r.current_price_mxn).toFixed(2):'',esc(res.reason)].join(','))}
writeFileSync('../../docs/clients/mi-pase/ready-to-price-active54.csv',lines.join('\n'))
console.log(`\n=== READY 54 (active+cost) @ 15% floor ===`)
for(const[k,v]of Object.entries(c))console.log(`  ${k.padEnd(20)} ${String(v).padStart(3)}`)
console.log(`  priced: ${priced} | net change: $${delta.toFixed(0)} MXN`)
console.log('  exported docs/clients/mi-pase/ready-to-price-active54.csv')
