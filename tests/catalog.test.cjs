const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}}; new Function('module','exports',compiled)(module,module.exports); return module.exports;
}
const {parseCsv}=load('lib/csv.ts');
const {auditCatalogRow}=load('lib/catalogAudit.ts');
assert.deepEqual(parseCsv('\uFEFFsku,title_en,description_en\r\nA,"Drill, 18V","first line\nsecond ""quoted"" line"'),[{sku:'A',title_en:'Drill, 18V',description_en:'first line\nsecond "quoted" line'}]);
assert.throws(()=>parseCsv('sku,title_en\nA,"broken'));
assert.throws(()=>parseCsv('sku,sku\nA,B'));
assert.throws(()=>parseCsv('title_en\nDrill'));
const row=auditCatalogRow({sku:'A',title_en:'Bosch GSB Drill',brand:'Bosch',model_number:'GSB',price_aed:'NaN'});
assert.ok(row.issues.some(i=>i.code==='missing_price'));
assert.equal(row.suggestedTitle,'Bosch GSB Drill');
assert.ok(!row.suggestedIntro.includes('UAE site and trade work'));
const enriched=auditCatalogRow({sku:'B',title_en:'Bosch Washer',brand:'Bosch',model_number:'06008A7971',description_en:'For outdoor cleaning.',specs_inline:'wattage: 1500W | hose_length: 5m | unsupported | blank:'});
assert.deepEqual(enriched.facts,[{label:'wattage',value:'1500W'},{label:'hose length',value:'5m'}]);
assert.ok(enriched.suggestedIntro.includes('Bosch Washer 06008A7971'));
assert.ok(enriched.suggestedIntro.includes('1500W'));
assert.ok(enriched.suggestedIntro.includes('5m'));
assert.ok(!enriched.suggestedIntro.includes('warranty'));
assert.ok(!enriched.suggestedMeta.includes('Price on request'));
assert.ok(!enriched.suggestedMeta.includes('AED NaN'));
assert.equal(enriched.suggestedTitle,'Bosch Washer 06008A7971');
assert.ok(enriched.missingFacts.length);
console.log('CSV and rule regression tests passed.');
