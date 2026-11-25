import fs from 'node:fs'
const edit=(p,f)=>fs.writeFileSync(p,f(fs.readFileSync(p,'utf8')))
edit('worker/src/routes/saleRoutes.ts',s=>{
 const start=s.indexOf('  // POST /api/sales/checkout'),end=s.indexOf('  // POST /api/sales/:id/void')
 s=s.slice(0,start)+`  if(request.method==='POST' && (path==='/api/sales/checkout'||path==='/api/sales/sync'))return checkout(request,env,user,path.endsWith('/sync'));

`+s.slice(end)
 const a=s.indexOf('interface SaleItemInput'),b=s.indexOf('export async function handleSaleRoutes')
 return "import { checkout } from '../checkout'\n"+s.slice(0,a)+s.slice(b)
})
edit('worker/src/routes/authRoutes.ts',s=>{
 s="import { assertChanged } from '../checkout'\n"+s
 s=s.replace("    const deviceId = body.deviceId || 'shop-pos-pc';", "    if(!['admin','manager','cashier'].includes(user.role)||user.status!=='active')return errorResponse('Forbidden',403);\n    if(!body.deviceId||!/^[\\w-]{1,128}$/.test(body.deviceId))return errorResponse('Valid deviceId required');\n    const deviceId = body.deviceId;")
 s=s.replace('`sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`','crypto.randomUUID()').replace('24 * 3600','12 * 3600')
 const a=s.indexOf('    const countRow'),b=s.indexOf('    return jsonResponse({',a)
 s=s.slice(0,a)+`    const body = await request.json().catch(()=>({})) as {secret?:string;name?:string;phone?:string};
    if(!env.BOOTSTRAP_SECRET||!env.BOOTSTRAP_OWNER_UID||verified.uid!==env.BOOTSTRAP_OWNER_UID||body.secret!==env.BOOTSTRAP_SECRET)return errorResponse('Trusted owner provisioning is required.',403);
    const name=body.name||verified.name||'Owner',email=verified.email;
    if(!email)return errorResponse('Owner token must include an email.',403);
    const guard=crypto.randomUUID();
    try {await env.DB.batch([
      env.DB.prepare("INSERT INTO owner_provisioning(id,uid) SELECT 1,? WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='admin')").bind(verified.uid),
      assertChanged(env.DB,guard),
      env.DB.prepare("INSERT INTO users(uid,email,name,phone,role,status,branch_id) VALUES(?,?,?,?,'admin','active','main')").bind(verified.uid,email,name,body.phone||''),
      env.DB.prepare("INSERT OR IGNORE INTO settings(branch_id,business_name) VALUES('main','Z17 SPORTS')"),
      env.DB.prepare('DELETE FROM transaction_guards WHERE id=?').bind(guard),
    ])}catch(error){if(/constraint/i.test(String(error)))return errorResponse('Owner provisioning has already been consumed or an owner exists.',409);throw error}

`+s.slice(b)
 return s
})
edit('worker/src/types.ts',s=>s.replace('BOOTSTRAP_SECRET?: string;','BOOTSTRAP_SECRET?: string;\n  BOOTSTRAP_OWNER_UID?: string;'))
edit('worker/src/auth.ts',s=>{
 const a=s.indexOf('  // Allow test / mock'),b=s.indexOf("  if (header.alg !== 'RS256')",a)
 s=s.slice(0,a)+s.slice(b)
 return s.replace("  environment = 'production'","  _environment = 'production'").replace('if (payload.exp && payload.exp < nowSeconds)',"if (!Number.isFinite(payload.exp) || payload.exp! <= nowSeconds)")
})
edit('worker/wrangler.toml',s=>s.replace('database_id = "z17-sports-db-id"','# Local-only placeholder. Configure an actual D1 UUID in a separate production config before any deployment.\ndatabase_id = "00000000-0000-0000-0000-000000000000"').replace('ENVIRONMENT = "production"','ENVIRONMENT = "local"'))
edit('worker/package.json',s=>{const p=JSON.parse(s);p.scripts['d1:local']='wrangler d1 migrations apply z17-sports-db --local';p.scripts['test:d1']='node ../scripts/test-worker-d1.mjs';return JSON.stringify(p,null,2)+'\n'})
