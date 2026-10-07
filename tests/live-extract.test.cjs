const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const vm=require('node:vm');
const cheerio=require('cheerio');
function extractHtml(html,extract){
 const $=cheerio.load(html);
 const wrap=node=>node?{
  get innerText(){return $(node).text()},get textContent(){return $(node).text()},
  get children(){return $(node).children().toArray().map(wrap)},get tagName(){return node.tagName?.toUpperCase()},
  get lang(){return $(node).attr('lang') || ''},get currentSrc(){return $(node).attr('src') || ''},get src(){return $(node).attr('src') || ''},naturalWidth:0,
  getBoundingClientRect(){return {width:100}},getAttribute(key){return $(node).attr(key)},
  querySelectorAll(selector){return $(node).find(selector).toArray().map(wrap)}
 }:null;
 const document={querySelector:selector=>wrap($(selector)[0]),querySelectorAll:selector=>$(selector).toArray().map(wrap),body:wrap($('body')[0]),documentElement:wrap($('html')[0]),images:$('img').toArray().map(wrap),title:$('title').text(),createElement:()=>({set innerHTML(value){this.textContent=cheerio.load(value).text()}})};
 return JSON.parse(vm.runInNewContext(`(${extract})()`,{document,location:{href:'https://www.fepy.com/test-product'}}));
}
const extract=JSON.parse(execFileSync('python',['-c','import sys,json;sys.path.insert(0,"railway");import live_pdp;print(json.dumps(live_pdp.EXTRACT))'],{encoding:'utf8'}));
(async()=>{
 const page={async setContent(html){this.html=html},async evaluate(extract){return JSON.stringify(extractHtml(this.html,extract))}};
  await page.setContent(`<nav aria-label="breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/tools">Power Tools</a></li><li><a href="/drills">Cordless Drills</a></li><li>Bosch Drill</li></ol></nav><h1>Bosch Drill</h1><section id="key-specifications"><div><p>Model No</p><p>GSB 18V-50 + 06019H51L0</p></div><div><p>No Load Speed</p><p>0 – 2,500 / 0 rpm</p></div></section><section id="faq"><h2>Frequently Asked Questions</h2><p>What is the no-load speed?</p><p>First gear 0 to 460 rpm and second gear 0 to 1,800 rpm.</p></section><script type="application/ld+json">{"@type":"Product","name":"Bosch Drill","category":"Home","sku":"A"}</script>`);
  let data=JSON.parse(await page.evaluate(extract));
  assert.equal(data.row.category,'Cordless Drills');
  assert.equal(data.row.model_number,'GSB 18V-50 + 06019H51L0');
  assert.match(data.row.faq_text,/1,800/);
  assert.equal(data.sources.model_number,'rendered Model No specification');
  await page.setContent(`<h1>Bosch Drill</h1><script type="application/ld+json">[{"@type":"Product","name":"Bosch Drill","category":"Home","mpn":"06019H51L0"},{"@type":"BreadcrumbList","itemListElement":[{"position":3,"name":"Bosch Drill"},{"position":1,"name":"Home"},{"position":2,"name":"Cordless Drills"}]}]</script>`);
  data=JSON.parse(await page.evaluate(extract));
  assert.equal(data.row.category,'Cordless Drills');
  assert.equal(data.row.model_number,'06019H51L0');
  console.log('Rendered breadcrumb, model fallback and FAQ extraction regressions passed.');

})().catch(err=>{console.error(err);process.exit(1)});
