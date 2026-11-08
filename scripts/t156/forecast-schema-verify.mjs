/** Read-only migration guard. Run preflight before DDL and postflight after DDL. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const forecastTriggerDefinitions=[
 ['t156_forecast_run_no_update','t156_forecast_run','UPDATE'],['t156_forecast_run_no_delete','t156_forecast_run','DELETE'],
 ['t156_forecast_horizon_no_update','t156_forecast_horizon','UPDATE'],['t156_forecast_horizon_no_delete','t156_forecast_horizon','DELETE'],
 ['t156_forecast_eval_no_update','t156_forecast_evaluation','UPDATE'],['t156_forecast_eval_no_delete','t156_forecast_evaluation','DELETE'],
 ['t156_forecast_continuation_no_update','t156_forecast_continuation','UPDATE'],['t156_forecast_continuation_no_delete','t156_forecast_continuation','DELETE'],
];
const normalize=v=>String(v).trim().replace(/;$/,'').replace(/\s+/g,' ').replace(/\s*=\s*/g,'=').toLowerCase();
const body=normalize("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forecast ledger immutable'");
export function assertForecastTriggerDefinitions(rows,{requireAll=true}={}){
 const found=new Set();
 for(const row of rows){const expected=forecastTriggerDefinitions.find(([name])=>name===row.TRIGGER_NAME);
  if(!expected||row.EVENT_OBJECT_TABLE!==expected[1]||row.EVENT_MANIPULATION!==expected[2]||row.ACTION_TIMING!=='BEFORE'||row.ACTION_ORIENTATION!=='ROW'||row.ACTION_CONDITION!==null||normalize(row.ACTION_STATEMENT)!==body)throw Error('forecast_trigger_definition_mismatch');
  if(found.has(expected[0]))throw Error('forecast_trigger_duplicate');found.add(expected[0]);
 }
 if(requireAll&&found.size!==forecastTriggerDefinitions.length)throw Error('forecast_trigger_missing');
 return {verified:found.size,required:forecastTriggerDefinitions.length};
}
export async function verifyForecastTriggers(db,{requireAll=true}={}){
 const [rows]=await db.query(`SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_CONDITION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('t156_forecast_run','t156_forecast_horizon','t156_forecast_evaluation','t156_forecast_continuation')`);
 return assertForecastTriggerDefinitions(rows,{requireAll});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const mode=process.argv[2];if(!['--preflight','--postflight'].includes(mode))throw Error('forecast_schema_check_mode_required');
 const require=createRequire(resolve(process.env.T156_NODE_PACKAGE_ROOT??process.cwd(),'package.json'));
 const mysql=require('mysql2/promise');
 const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER,password:process.env.DB_PWD,database:process.env.DB_NAME,multipleStatements:false});
 try{const result=await verifyForecastTriggers(db,{requireAll:mode==='--postflight'});process.stdout.write(JSON.stringify({ok:true,mode,...result})+'\n');}finally{await db.end();}
}
