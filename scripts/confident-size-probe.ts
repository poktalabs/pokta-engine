import { readFileSync } from 'node:fs'
import { createShopifyClient } from '../integrations/src/shopify/index.js'
import { createMercadoLibreClient } from '../integrations/src/mercado-libre/index.js'
import { buildProductIdentityFromShopify, type ProductIdentity } from '../packages/workflows/pricing/lib/product-identity.js'
import { scoreProductMatch, decisionForMatchConfidence } from '../packages/workflows/pricing/lib/matching-score.js'
import { computeSuggestedPrice } from '../packages/workflows/pricing/lib/pricing-logic.js'
const env = (k:string)=>process.env[k]||''
const shopify = createShopifyClient({ baseUrl: env('SB'), accessToken: env('ST') })
const ml = createMercadoLibreClient({ accessToken: env('MLA'), refreshToken: env('MLR'), oauth: env('MLCID')?{clientId:env('MLCID'),clientSecret:env('MLCS'),redirectUri:env('MLRU')}:undefined })
const FLOOR = 15
// cost map from CSV col23 (Costo TOTAL c/IVA)
const cost: Record<string,number> = {}
{ const rows = readFileSync('../../docs/clients/mi-pase/Precios-y-Margenes-Mi-Pase-2.csv','utf-8').split('\n')
  // naive CSV won't handle quoted commas; use python-prepared file instead
}
const costPairs = readFileSync('/tmp/cost-map.tsv','utf-8').split('\n').filter(Boolean)
for (const line of costPairs){ const [sku,c]=line.split('\t'); if(sku&&c) cost[sku]=Number(c) }
const q=(i:ProductIdentity)=>[i.marca_empresa,i.modelo_estimado,i.title_shopify].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const cat = await shopify.getCatalog({ status:'active' })
const ids:ProductIdentity[]=[]
for(const p of cat.products) for(const v of p.variants??[]){ const id=buildProductIdentityFromShopify(p,v); if(id&&cost[id.sku]!=null) ids.push(id) }
process.stdout.write(`active+cost SKUs=${ids.length}\n`)
let confident=0; const byMatch:Record<string,number>={accept:0,manual_review:0,reject:0,no_competitor:0}; const byDecision:Record<string,number>={}; const wins:string[]=[]
for(let k=0;k<ids.length;k++){
  const id=ids[k]!
  let comp; try{ comp=await ml.search(q(id)) }catch{ comp=null }
  const compPrice=comp?.price_mxn??null
  const match = comp?.title ? scoreProductMatch({sku:id.sku,title:id.title_shopify,search_query:q(id),brand:id.marca_empresa,model:id.modelo_estimado,category:id.categoria_interna,barcode:id.barcode,ean:id.ean,gtin:id.gtin,required_terms:id.palabras_requeridas,forbidden_terms:id.palabras_prohibidas}, comp.title) : null
  const mc = match?.confidence ?? null
  const md = decisionForMatchConfidence(mc)
  if(!comp?.title) byMatch.no_competitor++; else byMatch[md]++
  const trusted = md==='accept' ? compPrice : null
  const priced = computeSuggestedPrice({sku:id.sku,current_price_mxn:id.price_mipase,cost_mxn:cost[id.sku]!,competitor_min_mxn:trusted,margin_floor_pct:FLOOR})
  byDecision[priced.decision]=(byDecision[priced.decision]||0)+1
  const isConf = md==='accept' && priced.decision!=='manual_review' && priced.decision!=='skipped'
  if(isConf){ confident++; if(wins.length<20) wins.push(`  ${id.sku} "${id.title_shopify.slice(0,32)}" ${priced.decision} $${id.price_mipase}→$${priced.suggested_price_mxn} (comp $${compPrice}, ${mc})`) }
  process.stdout.write(`[${k+1}/${ids.length}] md=${md} dec=${priced.decision} ${isConf?'CONFIDENT':''} ${id.sku}\n`)
  if(k<ids.length-1) await delay(200)
}
process.stdout.write(`\n=== CONFIDENT (trustworthy auto-recommendations): ${confident}/${ids.length} (${(100*confident/ids.length).toFixed(0)}%) ===\n`)
process.stdout.write('match decision split: '+JSON.stringify(byMatch)+'\n')
process.stdout.write('price decision split: '+JSON.stringify(byDecision)+'\n')
process.stdout.write('\nconfident recommendations:\n'+wins.join('\n')+'\n')
