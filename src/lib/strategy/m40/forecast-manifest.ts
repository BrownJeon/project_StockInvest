/** Files are hashed without emitting their contents or private runtime values. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export function forecastCodeManifest(){
 const paths=['forecast-engine.ts','forecast-input.ts','forecast-types.ts','core.ts','paper-ledger.ts','types.ts','forward-calendar.ts','forecast-continuation.ts','forecast-evaluation.ts','forward-index-contract.ts','forward-sources.ts'];
 const files=paths.map(path=>({path:'src/lib/strategy/m40/'+path,sha256:createHash('sha256').update(readFileSync(join(process.cwd(),'src/lib/strategy/m40',path))).digest('hex')}));
 return {modelCodeSha256:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files,promptVersion:null,promptApplicability:'not_applicable_statistical_model'};
}
