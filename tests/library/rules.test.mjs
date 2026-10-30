import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path=new URL('../../firebase/library/database.rules.json',import.meta.url);
test('library rules are generated reproducibly and deny admin/engagement writes to clients',()=>{
  const before=readFileSync(path,'utf8');
  const result=spawnSync('python3',['firebase/library/build-rules.py'],{cwd:new URL('../../',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(path,'utf8'),before);
  const {rules}=JSON.parse(before);assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);
  for(const node of ['bookEngagement','engagementPreviews','engagementShares'])assert.equal(rules[node]['.write'],false);
  assert.equal(rules.userLikes.$uid['.write'],false);
  assert.match(rules.books.$id['.write'],/libraryOwner/);
  assert.equal(rules.books.$id.likes['.write'],false);
  assert.equal(rules.bookStats.$id.views['.write'],false);
  assert.equal(rules.siteConfig.adminEmails['.write'],false);
});
