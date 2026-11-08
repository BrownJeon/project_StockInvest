import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { statements,mapStatement } from './archive-lib.mjs';
const [manifestPath,dumpPath]=process.argv.slice(2);
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
process.stdout.write("SET time_zone='+00:00';\nSET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\nSET sql_mode='STRICT_TRANS_TABLES,NO_AUTO_VALUE_ON_ZERO,NO_ENGINE_SUBSTITUTION';\n");
for await(const source of statements(dumpPath)) {
 const sql=mapStatement(source,manifest.tables.map(x=>x.table));
 if(sql && !process.stdout.write(sql+'\n')) await once(process.stdout,'drain');
}
process.stdout.write('SET FOREIGN_KEY_CHECKS=1;\n');
