import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=path=>readFileSync(root+path,'utf8');
test('retired tools are deleted, unlisted, and removed from sitemap',()=>{
  const retired=['GLM','ChatGPT','Claude','Gemini','Grok','Deepseek'];
  for(const name of retired){
    assert.equal(existsSync(root+name),false,name);
    for(const path of ['index.html','Tools/index.html','Main/index.html','sitemap1.xml','sitemap2.xml'])assert.ok(!read(path).includes('https://htmltools.me/'+name),path+' '+name);
  }
  assert.ok(read('404.html').includes("location.replace('/AI-Playground/')"));
  assert.ok(read('404.html').includes("fetch('/AI-Playground/Chat/index.html')"));
  assert.ok(read('Research/index.html').includes('/AI-Playground/Login/'));
});
test('remaining tools do not read payload collections for list navigation',()=>{
  for(const path of ['AI-Playground/Chat/index.html','ImageEditorAI/index.html','ImageGeneratorAI/index.html','Research/index.html','SlidesAI/Library/index.html','Art/Museum/index.html']){
    const text=read(path);assert.ok(text.includes('HTData.page('),path);
    assert.ok(!/db\.ref\((?:convPath\(\)|userPath\(\)|'slidesai_library'|'art_museum'|"users\/" \+ user.uid \+ "\/conversations")\)\.(?:get|once|on)\(/.test(text),path);
  }
  const art=read('Art/Create/index.html');
  assert.ok(art.includes('loadedChunks[ck].stop()'));
  assert.ok(art.includes("ref.on('child_changed',changed)"));
  assert.ok(art.includes('queuePixel(dbRefForPixel'));
});
test('rules are generated reproducibly with deny-by-default and bounded metadata reads',()=>{
  const before=read('firebase/database.rules.json');
  const result=spawnSync('python3',['firebase/build-rules.py'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  assert.equal(read('firebase/database.rules.json'),before);
  const {rules}=JSON.parse(before);assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
  for(const key of ['slidesai_index','art_museum_index'])assert.match(rules[key]['.read'],/query.limitToLast <= 50/);
  for(const key of ['slidesai_library','art_museum'])assert.equal(rules[key]['.read'],undefined);
  assert.match(rules.art_presence.$room.$uid['.write'],/\+ 200/);
  assert.match(rules.art_chat.$room.$message['.write'],/now - 1000/);
  // Avoid unsupported RTDB APIs and permissive root/collection grants.
  assert.ok(!before.includes('numChildren('));
});
