import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStatement, executeDumpStatement } from './archive-lib.mjs';
test('only source tables and local FK names are translated', () => {
  const s = 'CREATE TABLE `x` (`id` int, CONSTRAINT `x_fk` FOREIGN KEY (`id`) REFERENCES `y` (`id`));';
  assert.match(mapStatement(s,['x','y']), /REFERENCES `t156_research_y`/);
  assert.match(mapStatement(s,['x','y']), /CONSTRAINT `t156_research_x_fk`/);
  assert.throws(()=>mapStatement('DROP TABLE `orders`;', ['x']));
  assert.throws(()=>mapStatement('INSERT INTO `orders` VALUES(1);', ['x']));
  assert.throws(()=>mapStatement('USE stockinvest;', ['x']));
});
test('large binary goes through bounded chunks and variables are cleared', async () => {
  const calls=[]; const db={query:async(...args)=>calls.push(args)};
  await executeDumpStatement(db,"INSERT INTO `t156_research_x` VALUES(0x"+'AB'.repeat(1048576)+');');
  assert.equal(calls.filter(([sql])=>sql.includes('CONCAT')).length,4);
  assert.match(calls.at(-2)[0], /VALUES\(@t156_part_0\)/);
  assert.equal(calls.at(-1)[0], 'SET @t156_part_0=NULL');
  assert(calls.every(([sql,args])=>Buffer.byteLength(sql)+Buffer.byteLength(args?.[0]??'')<1024*1024));
});

test('data literals with source identifiers remain byte exact',()=> {
 const s="INSERT INTO `x` VALUES('see `x` and `y`');";
 assert.equal(mapStatement(s,['x','y']),"INSERT INTO `t156_research_x` VALUES('see `x` and `y`');");
});

test('long hexadecimal-looking document text stays byte exact',async()=> {
 const calls=[];const sql="INSERT INTO `t156_research_x` VALUES('text 0x"+'AB'.repeat(600000)+"');";
 await executeDumpStatement({query:async(s)=>calls.push(s)},sql);
 assert.deepEqual(calls,[sql]);
});
