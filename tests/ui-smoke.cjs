const {spawn}=require('node:child_process');
const http=require('node:http');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()]}));
const sample='sku,title_en,brand,model_number,category,description_en\nA,"Bosch Drill, 18V",Bosch,GSB,Power Tools,"First line\nsecond line"\nB,Bosch Drill 18V,Bosch,GSB,Power Tools,Short description';
let rows,polls=0,authCalls=0;
const checks=[{name:'content_consistency',assessment:'contradiction',confidence:.96,needsReview:true}];
const fake=http.createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer test-worker-token');authCalls++;
 res.setHeader('Content-Type','application/json');
 if(req.url==='/capabilities') return res.end(JSON.stringify({decisions:{configured:true},embeddings:{configured:true,state:'ready'}}));
 if(req.method==='POST') {let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);rows=body.rows;assert.equal(body.decisions,true);assert.equal(body.embeddings,true);res.statusCode=202;return res.end(JSON.stringify({id:'a'.repeat(32),status:'queued',total:rows.length}));}
 polls++;
 res.end(JSON.stringify({id:'a'.repeat(32),status:'completed',total:rows.length,completed:rows.length,results:rows.map((r,i)=>({rowIndex:i,sku:r.sku,decisions:{status:'completed',checks},embeddings:{status:'completed',imageStatus:'not_supplied',imageTextSimilarity:null,textNeighbors:[{rowIndex:1-i,sku:rows[1-i].sku,similarity:.99}],imageNeighbors:[]}}))}));
});
const server=spawn('node',['node_modules/next/dist/bin/next','start','--port','3100'],{env:{...process.env,AUDITOR_WORKER_URL:'http://127.0.0.1:3101',AUDITOR_WORKER_TOKEN:'test-worker-token'},stdio:'ignore'});
(async()=>{
 let browser;
 try {
  await new Promise(r=>fake.listen(3101,'127.0.0.1',r));
  for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:3100/catalog');break;}catch{await new Promise(r=>setTimeout(r,100));}}
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:960}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3100/catalog');
  await page.locator('#catalog-csv').fill(sample);
  await page.getByRole('button',{name:'Run rules + selected AI checks'}).click();
  await page.getByText('AI audit: completed').waitFor({timeout:15000});
  assert.equal(rows[0].title_en,'Bosch Drill, 18V');assert.equal(rows[0].description_en,'First line\nsecond line');
  assert.ok((await page.getByText('confidence 96%',{exact:false}).count())===2);
  await page.getByRole('button',{name:'Mark manually reviewed'}).first().click();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download results'}).click();
  const download=await downloadEvent;const report=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(report.products[0].manuallyReviewed,true);assert.equal(report.aiJob.status,'completed');
  assert.equal(report.products[0].ai.embeddings.textNeighbors[0].sku,'B');
  await page.screenshot({path:'/tmp/catalog-ai-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/tmp/catalog-ai-mobile.png',fullPage:true});
  const invalid=await fetch('http://127.0.0.1:3100/api/catalog-audit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"rows":[null]}'});assert.equal(invalid.status,400);
  assert.equal(errors.length,0);assert.ok(polls>0&&authCalls>=3);
  console.log('UI/proxy smoke passed: quoted CSV, AI submission, progress polling, findings, manual review, JSON export, invalid input and mobile layout. Inference mocked.');
 }finally {if(browser)await browser.close();server.kill();fake.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
