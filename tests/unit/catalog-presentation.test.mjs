import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
function setup() {
  const state = { loading:false, error:'', catalogPage:1, filters:{query:'',task:'all'} };
  const ctx = vm.createContext({state, loading:()=>'', errorBox:()=>'', encodeURIComponent});
  const helpers = source.slice(source.indexOf('  function esc('), source.indexOf('  function safeUrl('));
  const cards = source.slice(source.indexOf('  var FEATURED_DATASETS'), source.indexOf('\n  function ', source.indexOf('  function datasetCard(')+15));
  const results = source.slice(source.indexOf('  function datasetResults('), source.indexOf('\n  // Repaints', source.indexOf('  function datasetResults(')));
  vm.runInContext(helpers + cards + results, ctx);
  return ctx;
}
const dataset = (name, n=0) => ({name,slug:'dataset-'+n,task:'classification',domain:'wireless',description:'Description',origin:'measured',releaseCount:1});
test('featured records appear once and pagination preserves every remaining entry',()=>{
  const c=setup(); const rows=[dataset('WiSig',100),...Array.from({length:17},(_,i)=>dataset('Other '+i,i))];
  let html=c.datasetResults(rows);
  assert.equal((html.match(/>WiSig</g)||[]).length,1);
  assert.equal((html.match(/tml-dataset-card/g)||[]).length,9);
  assert.match(html,/Page 1 of 3/);
  c.state.catalogPage=3; html=c.datasetResults(rows);
  assert.match(html,/>Other 16</); assert.doesNotMatch(html,/>Other 0</);
});
test('filtering uses one list and clamps a stale page number',()=>{
  const c=setup(); c.state.filters.query='WiSig'; c.state.catalogPage=10;
  const html=c.datasetResults([dataset('WiSig')]);
  assert.doesNotMatch(html,/Featured datasets/); assert.match(html,/Search results/);
  assert.equal(c.state.catalogPage,1);
});
test('cards escape metadata and show score availability without a contextless score',()=>{
  const c=setup(); const d=dataset('<img src=x>');d.baselineScore={value:.99};
  const html=c.datasetCard(d);
  assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/Baseline available/);
  assert.doesNotMatch(html,/0\.99|No verified score|0 files|tml-record-id/);
});
