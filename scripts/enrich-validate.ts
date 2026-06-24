import { writeFileSync, readFileSync } from 'node:fs'
import { scoreProductMatch } from '../packages/workflows/pricing/lib/matching-score.js'
import { refreshAccessToken } from '../integrations/src/mercado-libre/oauth.js'
const env=(k:string)=>process.env[k]||''
const tr=await refreshAccessToken(env('MLR'),{clientId:env('MLCID'),clientSecret:env('MLCS')})
writeFileSync('/tmp/ml-tokens.json',JSON.stringify({access_token:tr.access_token,refresh_token:tr.refresh_token,expires_in:tr.expires_in},null,2))
const tok=tr.access_token
process.stdout.write(`token refreshed; NEW refresh_token captured to /tmp/ml-tokens.json (len ${tr.refresh_token?.length})\n`)
const meta=JSON.parse(readFileSync('/tmp/csv-meta.json','utf-8'))
async function search(q:string){ const u=`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(q)}&limit=6`
  const r=await fetch(u,{headers:{Authorization:`Bearer ${tok}`}}); if(!r.ok)return{status:r.status,c:[] as any[]}; return{status:r.status,c:((await r.json()) as any).results??[]} }
for(const sku of ['OLED55C5ESA','86UA7500PSA']){
  const m=meta[sku]
  const mi={sku, title:'', search_query:'', brand:m.brand, model:m.model, category:m.cat,
    gtin:m.upc||undefined, ean:m.upc||undefined, barcode:m.upc||undefined,
    required_terms:(m.req||'').split(',').map((s:string)=>s.trim()).filter(Boolean),
    forbidden_terms:(m.forb||'').split(',').map((s:string)=>s.trim()).filter(Boolean)}
  for(const [label,q] of [['UPC',m.upc],['brand+mfr',`${m.brand} ${m.mfr}`],['brand+model',`${m.brand} ${m.model}`]] as [string,string][]){
    if(!q) continue
    const {status,c}=await search(q)
    process.stdout.write(`\n${sku} [${label}] q="${q}" -> HTTP ${status}, ${c.length} cands\n`)
    for(const cand of c.slice(0,5)){ const sc=scoreProductMatch({...mi,search_query:q,title:cand.name??''}, cand.name??null)
      process.stdout.write(`   [${sc?.confidence}/${sc?.reason_code}] ${(cand.name||'').slice(0,55)} gtin?=${cand.attributes?cand.attributes.some?'?':'?':'?'}\n`) }
  }
}
