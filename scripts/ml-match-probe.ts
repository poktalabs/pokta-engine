import { readFileSync } from 'node:fs'
import { createShopifyClient } from '../integrations/src/shopify/index.js'
import { createMercadoLibreClient } from '../integrations/src/mercado-libre/index.js'
import { buildProductIdentityFromShopify, type ProductIdentity } from '../packages/workflows/pricing/lib/product-identity.js'
const env = (k: string) => process.env[k] || ''
const shopify = createShopifyClient({ baseUrl: env('SB'), accessToken: env('ST') })
const ml = createMercadoLibreClient({ accessToken: env('MLA'), refreshToken: env('MLR'),
  oauth: env('MLCID') ? { clientId: env('MLCID'), clientSecret: env('MLCS'), redirectUri: env('MLRU') } : undefined })
const costSkus = new Set(readFileSync('/tmp/cost-skus.txt','utf-8').split('\n').map(s=>s.trim()).filter(Boolean))
const q = (i: ProductIdentity) => [i.marca_empresa, i.modelo_estimado, i.title_shopify].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
const delay = (ms:number)=>new Promise(r=>setTimeout(r,ms))
const cat = await shopify.getCatalog({ status: 'active' })
const ids: ProductIdentity[] = []
for (const p of cat.products) for (const v of p.variants ?? []) { const id = buildProductIdentityFromShopify(p, v); if (id) ids.push(id) }
const withCost = ids.filter(i => costSkus.has(i.sku))
process.stdout.write(`active=${ids.length} active+cost=${withCost.length} ml.configured=${ml.configured}\n`)
let hit=0, done=0; const reasons: Record<string,number> = {}
for (let k=0;k<withCost.length;k++){
  const id = withCost[k]!
  let r
  try { r = await ml.search(q(id)) } catch(e){ reasons['THREW']=(reasons['THREW']||0)+1; done++; process.stdout.write(`[${done}/${withCost.length}] xTHREW ${id.sku}\n`); continue }
  done++
  if (r.price_mxn != null) { hit++; process.stdout.write(`[${done}/${withCost.length}] OK ${id.sku} "${q(id).slice(0,38)}" -> $${r.price_mxn}\n`) }
  else { const why=r.failure_reason||'unknown'; reasons[why]=(reasons[why]||0)+1; process.stdout.write(`[${done}/${withCost.length}] x:${why} ${id.sku}\n`) }
  if (k<withCost.length-1) await delay(200)
}
process.stdout.write(`\n=== ML usable competitor price: ${hit}/${withCost.length} (${(100*hit/withCost.length).toFixed(0)}%) ===\n`)
process.stdout.write('miss reasons: '+JSON.stringify(reasons)+'\n')
