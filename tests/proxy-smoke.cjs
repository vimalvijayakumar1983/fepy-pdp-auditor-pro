const {spawn}=require('node:child_process');
const http=require('node:http');
const assert=require('node:assert/strict');
let received;
const fake=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer proxy-test-token');
 res.setHeader('Content-Type','application/json');
 if(req.url==='/capabilities')return res.end(JSON.stringify({decisions:{configured:true},embeddings:{configured:true,state:'ready'}}));
 if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;received=JSON.parse(raw);res.statusCode=202;return res.end(JSON.stringify({id:'a'.repeat(32),status:'queued',total:received.rows.length}));}
 res.end(JSON.stringify({id:'a'.repeat(32),status:'completed',total:1,completed:1,results:[{rowIndex:0,sku:'A',decisions:{status:'completed',checks:[{name:'content_consistency',assessment:'contradiction',confidence:.96,needsReview:true}]},embeddings:{status:'completed',textNeighbors:[],imageNeighbors:[]}}]}));
});
const server=spawn('node',['node_modules/next/dist/bin/next','start','--port','3100'],{env:{...process.env,AUDITOR_WORKER_URL:'http://127.0.0.1:3101',AUDITOR_WORKER_TOKEN:'proxy-test-token',AUDITOR_APP_PASSWORD:'synthetic-proxy-password',AUDITOR_SESSION_SECRET:'synthetic-proxy-session-secret-32-characters'},stdio:'ignore'});
(async()=>{
 try {
  await new Promise(r=>fake.listen(3101,'127.0.0.1',r));
  const base='http://127.0.0.1:3100';
  for(let i=0;i<100;i++){try{await fetch(base+'/catalog');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-proxy-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const originalFetch=global.fetch;global.fetch=(url,options={})=>originalFetch(url,{...options,headers:{Cookie:cookie,Origin:base,...options.headers}});
  assert.equal((await fetch(base+'/catalog')).status,200);
  const cap=await (await fetch(base+'/api/catalog-ai')).json();assert.equal(cap.decisions.configured,true);
  const submitted=await fetch(base+'/api/catalog-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:[{sku:'A',title_en:'Drill'}],decisions:true,embeddings:true})});assert.equal(submitted.status,202);
  const job=await submitted.json();const result=await (await fetch(base+'/api/catalog-ai/'+job.id)).json();assert.equal(result.results[0].decisions.checks[0].assessment,'contradiction');assert.equal(received.rows[0].sku,'A');
  assert.equal((await fetch(base+'/api/catalog-ai/invalid')).status,400);
  const malformed=await fetch(base+'/api/catalog-audit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"rows":[null]}'});assert.equal(malformed.status,400);
  console.log('App-to-worker proxy smoke passed: capabilities, authenticated submission, polling, payload/result preservation, invalid ID and malformed input. Inference mocked.');
 }finally {server.kill();fake.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
