/** Explicit operator only. No import-time DB writes, broker or application setup. */
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { PREFIX, identifier, statements, mapStatement, executeDumpStatement, sha256 } from './archive-lib.mjs';
const args = process.argv.slice(2);
const option = key => args[args.indexOf(key)+1];
const phase = args.includes('--phase') ? option('--phase') : 'plan';
const manifest = JSON.parse(await readFile(option('--manifest'),'utf8'));
const dumpPath = option('--dump');
const tables = manifest.tables.map(x=>x.table);
if (manifest.tables.some(x=>!Number.isSafeInteger(x.rows)||x.rows<0||!/^\d+$/.test(String(x.checksum)))) throw Error('invalid_manifest_checksum_or_count');
if (!tables.length || new Set(tables).size !== tables.length) throw Error('invalid_manifest');
tables.forEach(t=>identifier(PREFIX+t));
const require = createRequire(resolve(process.env.T156_NODE_PACKAGE_ROOT ?? process.cwd(), 'package.json'));
const mysql = require('mysql2/promise');
const db = await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER,password:process.env.DB_PWD,database:process.env.DB_NAME,charset:'utf8mb4',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false});
const datasetId='t156-research-db-20261108';
const log = value => process.stdout.write(JSON.stringify(value)+'\n');
async function fileHash(path) {const h=createHash('sha256'); for await(const b of createReadStream(path)) h.update(b); return h.digest('hex');}
try {
  await db.query("SET time_zone='+00:00'");
  const [[target]] = await db.query('SELECT DATABASE() AS db,@@max_allowed_packet AS packet');
  if (phase==='plan') {
    const [existing]=await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 't156\\_%'");
    log({phase,targetDatabase:target.db,packet:target.packet,sourceTables:tables.length,sourceRows:manifest.tables.reduce((s,x)=>s+x.rows,0),existing:existing.map(x=>x.TABLE_NAME)});
  } else {
    if(!args.includes('--apply') || !args.includes('--expect-db') || target.db!==option('--expect-db')) throw Error('explicit_target_required');
    if(phase==='ddl') {
      const ddl=await readFile(option('--schema'),'utf8');
      for (const stmt of ddl.split(/;\s*(?:\n|$)/).filter(x=>x.trim())) await db.query(stmt);
      log({phase,ok:true});
    } else if(phase==='import') {
      const dumpSha=await fileHash(dumpPath);
      if(manifest.dumpSha256!==dumpSha) throw Error('source_dump_hash_mismatch');
      const [prior]=await db.query('SELECT content_sha256,status FROM t156_dataset WHERE id=?',[datasetId]);
      if(prior.length && (prior[0].content_sha256!==dumpSha || prior[0].status!=='staged')) throw Error('dataset_already_published_or_conflict');
      if(!prior.length) {
        const [have]=await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)',[tables.map(t=>PREFIX+t)]);
        if(have.length) throw Error('unowned_target_tables_exist');
        await db.query(`INSERT INTO t156_dataset(id,kind,source_key,status,live_eligible,content_sha256,row_count,metadata_json,created_at) VALUES(?,?,?,'staged',0,?,0,?,UTC_TIMESTAMP(6))`,[datasetId,'research_database','t156_research_20261106',dumpSha,JSON.stringify({manifest,tablePrefix:PREFIX,liveEligibility:'research-only; per-source availability/identity/adjustment qualification required'})]);
      }
      await db.query('SET FOREIGN_KEY_CHECKS=0');
      await db.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO,NO_ENGINE_SUBSTITUTION'");
      let count=0;
      for await (const source of statements(dumpPath)) {
        let sql=mapStatement(source,tables);
        if(!sql) continue;
        sql=sql.replace(/^CREATE TABLE /,'CREATE TABLE IF NOT EXISTS ').replace(/^INSERT INTO /,'INSERT IGNORE INTO ');
        await executeDumpStatement(db,sql);
        if(++count%500===0) log({phase,statements:count});
      }
      await db.query('SET FOREIGN_KEY_CHECKS=1');
      log({phase,statements:count,ok:true,status:'staged'});
    } else if(phase==='verify'||phase==='publish') {
      const [dataset]=await db.query('SELECT content_sha256,status FROM t156_dataset WHERE id=?',[datasetId]);
      if(dataset.length!==1 || dataset[0].content_sha256!==manifest.dumpSha256 || dataset[0].status==='rejected') throw Error('dataset_manifest_conflict');
      const results=[];
      for(const source of manifest.tables) {
        const table=identifier(PREFIX+source.table);
        const [[row]]=await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
        const [[check]]=await db.query(`CHECKSUM TABLE ${table} EXTENDED`);
        const match=Number(row.n)===source.rows && String(check.Checksum)===String(source.checksum);
        results.push({table:source.table,rows:Number(row.n),checksum:String(check.Checksum),match});
        if(!match) throw Error('source_target_mismatch:'+source.table);
      }
      const metadata={manifest,verification:{verifiedAt:new Date().toISOString(),tables:results},tablePrefix:PREFIX,liveEligibility:'archive-queryable; research-only unless separately qualified'};
      await db.query('UPDATE t156_dataset SET row_count=?,metadata_json=?,status=? WHERE id=? AND content_sha256=? AND status=?',[results.reduce((s,x)=>s+x.rows,0),JSON.stringify(metadata),phase==='publish'?'published':dataset[0].status,datasetId,manifest.dumpSha256,dataset[0].status]);
      const [published]=await db.query('SELECT content_sha256,status,row_count FROM t156_dataset WHERE id=?',[datasetId]);
      if(published.length!==1 || published[0].content_sha256!==manifest.dumpSha256 || Number(published[0].row_count)!==results.reduce((s,x)=>s+x.rows,0) || published[0].status!==(phase==='publish'?'published':dataset[0].status)) throw Error('publish_readback_failed');
      if(args.includes('--report')) await writeFile(option('--report'),JSON.stringify({phase,datasetId,tables:results,status:published[0].status},null,2)+'\n');
      log({phase,ok:true,rows:results.reduce((s,x)=>s+x.rows,0),tables:results.length});
    } else if(phase==='artifacts') {
      const inventory=JSON.parse(await readFile(option('--inventory'),'utf8'));
      let bytes=0;
      for(const f of inventory.files) {
        const data=await readFile(resolve(option('--artifact-root'),f.file));
        const digest=sha256(data);
        if(digest!==f.sha256 || data.length!==f.bytes) throw Error('artifact_hash_mismatch:'+basename(f.file));
        const parts=Math.ceil(data.length/524288);
        await db.query('INSERT IGNORE INTO t156_blob(sha256,byte_length,part_count,encoding) VALUES(?,?,?,?)',[digest,data.length,parts,'binary']);
        const [[header]]=await db.query('SELECT byte_length,part_count,encoding FROM t156_blob WHERE sha256=?',[digest]);
        if(Number(header.byte_length)!==data.length || Number(header.part_count)!==parts || header.encoding!=='binary') throw Error('blob_header_conflict');
        for(let i=0;i<parts;i++) { const part=data.subarray(i*524288,(i+1)*524288);await db.execute('INSERT IGNORE INTO t156_blob_part(sha256,part_no,part_sha256,bytes) VALUES(?,?,?,?)',[digest,i,sha256(part),part]); }
        const [stored]=await db.query('SELECT part_no,part_sha256,bytes FROM t156_blob_part WHERE sha256=? ORDER BY part_no',[digest]);
        if(stored.length!==parts || stored.some((p,i)=>p.part_no!==i||sha256(p.bytes)!==p.part_sha256)||sha256(Buffer.concat(stored.map(p=>p.bytes)))!==digest) throw Error('artifact_readback_failed');
        const role=/audit|collection|backfill|additions|preflight/.test(f.file)?'audit':/input|library|observations/.test(f.file)?'input':'study_result';
        let metadata={bytes:data.length,sourcePath:f.file,originalFormat:f.type,originalIsAuthoritative:true};
        if(f.type==='.json'){const d=JSON.parse(data.toString());metadata.topLevelKeys=Object.keys(d);metadata.protocol=d.protocol??d.evaluation_protocol??null;}
        await db.query('INSERT IGNORE INTO t156_test_artifact(artifact_id,filename,sha256,role,metadata_json) VALUES(?,?,?,?,?)',['artifact-'+digest.slice(0,32),basename(f.file),digest,role,JSON.stringify(metadata)]);
        const [saved]=await db.query('SELECT filename,sha256,role,metadata_json FROM t156_test_artifact WHERE artifact_id=?',['artifact-'+digest.slice(0,32)]);
        if(saved.length!==1 || saved[0].filename!==basename(f.file) || saved[0].sha256!==digest || saved[0].role!==role || JSON.stringify(typeof saved[0].metadata_json==='string'?JSON.parse(saved[0].metadata_json):saved[0].metadata_json)!==JSON.stringify(metadata)) throw Error('artifact_metadata_conflict');
        bytes+=data.length; log({phase,file:basename(f.file),sha256:digest,readback:true});
      }
      log({phase,files:inventory.files.length,bytes,ok:true});
    } else throw Error('unknown_phase');
  }
} catch(error) { log({phase,ok:false,error:error.code??error.message}); process.exitCode=1; }
finally { await db.end(); }
