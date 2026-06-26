import { readFileSync } from 'node:fs'
import { createShopifyClient } from '../integrations/src/shopify/index.js'
import { createMercadoLibreClient } from '../integrations/src/mercado-libre/index.js'
import { createAmazonMxSource } from '../integrations/src/amazon-mx/index.js'
import { buildProductIdentityFromShopify, type ProductIdentity } from '../packages/workflows/pricing/lib/product-identity.js'
import { scoreProductMatch } from '../packages/workflows/pricing/lib/matching-score.js'
const env=(k:string)=>process.env[k]||''
const shopify=createShopifyClient({baseUrl:env('SB'),accessToken:env('ST')})
// accessToken ONLY (no refresh/oauth) → client cannot rotate the refresh token. Safe.
const accessToken=JSON.parse(readFileSync('/tmp/ml-tokens.json','utf-8')).access_token
const ml=createMercadoLibreClient({accessToken})
// PR2: also probe Amazon MX (scraping). Expect LOW yield from a datacenter IP
// (CAPTCHA/blocks) — measuring that is the point. Set AMZ_PROXY to front it.
const amz=createAmazonMxSource({enabled:true,proxyUrl:env('AMZ_PROXY')||undefined})
const meta=JSON.parse(readFileSync('/tmp/csv-meta.json','utf-8'))
const costSkus=new Set(readFileSync('/tmp/cost-skus.txt','utf-8').split('\n').map(s=>s.trim()).filter(Boolean))
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms))
const cat=await shopify.getCatalog({status:'active'})
const ids:ProductIdentity[]=[]
for(const p of cat.products)for(const v of p.variants??[]){const id=buildProductIdentityFromShopify(p,v);if(id)ids.push(id)}
process.stdout.write(`active SKUs=${ids.length}, with cost=${ids.filter(i=>costSkus.has(i.sku)).length}\n\n`)
let found=0, foundCost=0, hasUpc=0, amzFound=0, comboFound=0
for(let k=0;k<ids.length;k++){
  const id=ids[k]!; const m=meta[id.sku]||{}
  const mpn=(m.mfr||'').trim(); const upc=(m.upc||'').trim()
  // RECIPE: GTIN-first query when UPC present, else brand+MPN+title
  const textQ=[id.marca_empresa,mpn||id.modelo_estimado,id.title_shopify].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
  const query = upc || textQ
  if(upc) hasUpc++
  let r; try{ r=await ml.search(query) }catch{ r=null }
  // enriched MatchInput: MPN as model + UPC as identifiers + CSV required/forbidden
  const mi={sku:id.sku,title:id.title_shopify,search_query:query,brand:id.marca_empresa||m.brand,
    model:mpn||id.modelo_estimado,category:id.categoria_interna||m.cat,
    gtin:upc||undefined,ean:upc||undefined,barcode:upc||id.barcode||undefined,
    required_terms:(m.req||'').split(',').map((s:string)=>s.trim()).filter(Boolean),
    forbidden_terms:(m.forb||'').split(',').map((s:string)=>s.trim()).filter(Boolean)}
  const sc = r?.title ? scoreProductMatch(mi, r.title) : null
  const isFound = sc?.confidence==='high' && r?.price_mxn!=null
  if(isFound){ found++; if(costSkus.has(id.sku)) foundCost++ }
  // Amazon MX (same query, scored the same way). Fail-soft → null on block/miss.
  let aq=null; try{ aq=await amz.lookup(query) }catch{ aq=null }
  const asc = aq?.title ? scoreProductMatch(mi, aq.title) : null
  const amzOk = asc?.confidence==='high' && aq?.priceMxn!=null
  if(amzOk) amzFound++
  if(isFound||amzOk) comboFound++
  process.stdout.write(`[${k+1}/${ids.length}] ML:${isFound?'FOUND':'-----'} AMZ:${amzOk?'FOUND':(aq?'--noacc':'--block')} ${id.sku} ${upc?'(upc)':''} ${isFound?`ml$${r?.price_mxn}`:''} ${amzOk?`amz$${aq?.priceMxn}`:''}\n`)
  if(k<ids.length-1) await delay(200)
}
process.stdout.write(`\n=== RECIPE coverage: trustworthy match (high + priced) ===\n`)
const pct=(n:number)=>`${(100*n/ids.length).toFixed(0)}%`
process.stdout.write(`  ML only:        ${found} of ${ids.length} (${pct(found)})\n`)
process.stdout.write(`  Amazon only:    ${amzFound} of ${ids.length} (${pct(amzFound)})\n`)
process.stdout.write(`  Combined (ML∪AMZ): ${comboFound} of ${ids.length} (${pct(comboFound)})  [+${comboFound-found} over ML alone]\n`)
process.stdout.write(`  of ${ids.filter(i=>costSkus.has(i.sku)).length} active+cost (ML): ${foundCost}\n`)
process.stdout.write(`  (SKUs with a UPC in CSV: ${hasUpc})\n`)
