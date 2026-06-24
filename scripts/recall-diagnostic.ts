import { createShopifyClient } from '../integrations/src/shopify/index.js'
import { buildProductIdentityFromShopify, type ProductIdentity } from '../packages/workflows/pricing/lib/product-identity.js'
import { scoreProductMatch } from '../packages/workflows/pricing/lib/matching-score.js'
import { refreshAccessToken } from '../integrations/src/mercado-libre/oauth.js'
const env=(k:string)=>process.env[k]||''
const shopify=createShopifyClient({baseUrl:env('SB'),accessToken:env('ST')})
const tok=(await refreshAccessToken(env('MLR'),{clientId:env('MLCID'),clientSecret:env('MLCS')})).access_token
process.stdout.write(`refreshed token ok (len ${tok.length})\n`)
const TARGETS=new Set(['OLED55C5ESA','86UA7500PSA','TCL50QLED','S25-ULTRA-512','EDGE-60-FUSION-5G','REDMI-NOTE-14-PRO'])
const q=(i:ProductIdentity)=>[i.marca_empresa,i.modelo_estimado,i.title_shopify].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()
// alt query: brand + model only (no noisy title)
const qAlt=(i:ProductIdentity)=>[i.marca_empresa,i.modelo_estimado].filter(Boolean).join(' ').trim()
const cat=await shopify.getCatalog({status:'active'})
const ids:ProductIdentity[]=[]
for(const p of cat.products)for(const v of p.variants??[]){const id=buildProductIdentityFromShopify(p,v);if(id&&TARGETS.has(id.sku))ids.push(id)}
async function search(query:string){ if(!query)return {status:0,cands:[] as any[]}
  const url=`https://api.mercadolibre.com/products/search?site_id=MLM&q=${encodeURIComponent(query)}&limit=8`
  const r=await fetch(url,{headers:{Authorization:`Bearer ${tok}`}}); if(!r.ok)return{status:r.status,cands:[]}
  return {status:r.status,cands:((await r.json()) as any).results??[]} }
for(const id of ids){
  const query=q(id)
  process.stdout.write(`\n=== ${id.sku} model="${id.modelo_estimado||'-'}" brand="${id.marca_empresa||'-'}"\n  QUERY(current): "${query}"\n`)
  const a=await search(query)
  if(!a.cands.length) process.stdout.write(`  (current) HTTP ${a.status} -> ${a.cands.length} candidates\n`)
  for(const c of a.cands.slice(0,6)){ const sc=scoreProductMatch({sku:id.sku,title:id.title_shopify,search_query:query,brand:id.marca_empresa,model:id.modelo_estimado,category:id.categoria_interna,required_terms:id.palabras_requeridas,forbidden_terms:id.palabras_prohibidas},c.name??null)
    process.stdout.write(`    [${sc?.confidence}/${sc?.reason_code}] ${(c.name||'').slice(0,58)}\n`) }
  const altq=qAlt(id)
  if(altq && altq!==query){ const b=await search(altq); process.stdout.write(`  QUERY(brand+model): "${altq}" -> ${b.cands.length} cands\n`)
    for(const c of b.cands.slice(0,6)){ const sc=scoreProductMatch({sku:id.sku,title:id.title_shopify,search_query:altq,brand:id.marca_empresa,model:id.modelo_estimado,category:id.categoria_interna,required_terms:id.palabras_requeridas,forbidden_terms:id.palabras_prohibidas},c.name??null)
      process.stdout.write(`    [${sc?.confidence}/${sc?.reason_code}] ${(c.name||'').slice(0,58)}\n`) } }
}
