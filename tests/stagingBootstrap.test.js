const {settings}=require('../scripts/bootstrap-staging');
const good={APP_ENV:'staging',MONGODB_URI:'mongodb://localhost:27017/totmart_staging'};
for(const kind of ['ADMIN','MERCHANT','CUSTOMER']){good[`STAGING_${kind}_EMAIL`]=`${kind.toLowerCase()}@example.invalid`;good[`STAGING_${kind}_PASSWORD`]='staging-tests-only-12345';}
test('bootstrap refuses production databases even with staging flag',()=>{expect(()=>settings({...good,MONGODB_URI:'mongodb://localhost:27017/totmart'})).toThrow('totmart_staging');expect(()=>settings({...good,APP_ENV:'production'})).toThrow('staging');});
test('bootstrap validates credentials and creates distinct role contracts',()=>{expect(settings(good).map(x=>x.role)).toEqual(['admin','merchant','user']);expect(()=>settings({...good,STAGING_ADMIN_PASSWORD:'short'})).toThrow('password');});
