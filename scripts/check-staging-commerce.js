// Read-only public preflight. Never creates users, orders, receipts or migrations.
async function main() {
  const backend = new URL(process.env.BE_STAGING_URL || 'https://totmartapi-1.onrender.com');
  const frontend = new URL(process.env.FE_STAGING_URL || 'https://tot-mart-git-staging-furiousfast189-3255s-projects.vercel.app');
  if ([backend, frontend].some(u => u.username || u.password || u.search || u.hash))
    throw new Error('Use origin URLs without credentials, tokens or query parameters.');
  const checks = [];
  async function get(origin, path) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000), redirect: 'follow' });
    const body = await response.text();
    return { response, body };
  }
  for (const path of ['/api/home/health', '/api/commerce-policy']) {
    try {
      const {response,body}=await get(backend,path);const data=JSON.parse(body);
      const pass=path.endsWith('/health') ? data.success===true && data.status==='ready' :
        data.data?.shippingFee===0 && data.data?.shipping?.includedInCheckout===false;
      checks.push({path,status:response.status,pass:response.ok&&pass});
    } catch(error) { checks.push({path,pass:false,error:error.name}); }
  }
  for (const path of ['/subscription','/box','/gift']) {
    try {
      const {response,body}=await get(frontend,path);
      const protectedDeployment=new URL(response.url).hostname==='vercel.com';
      checks.push({path,status:response.status,protectedDeployment,
        pass:response.ok&&!protectedDeployment&&!body.includes('This page could not be found')});
    } catch(error) { checks.push({path,pass:false,error:error.name}); }
  }
  console.log(JSON.stringify({mode:'read_only_public_preflight',checks,
    requiresAuthenticatedAcceptance:['customer checkout and recovery','merchant ownership and transitions','admin Gift and COD settlement','real upload and staged webhook','read-only ownership migration review']},null,2));
  if(checks.some(c=>!c.pass))process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
