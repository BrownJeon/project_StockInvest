import {test} from 'node:test';import assert from 'node:assert/strict';
import {forecastTriggerDefinitions,assertForecastTriggerDefinitions} from './forecast-schema-verify.mjs';
const rows=()=>forecastTriggerDefinitions.map(([TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION])=>({TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING:'BEFORE',ACTION_ORIENTATION:'ROW',ACTION_CONDITION:null,ACTION_STATEMENT:"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forecast ledger immutable'"}));
test('partial migration preflight allows only correct existing guards',()=>{assert.equal(assertForecastTriggerDefinitions(rows().slice(0,3),{requireAll:false}).verified,3);assert.throws(()=>assertForecastTriggerDefinitions(rows().slice(0,3)),/forecast_trigger_missing/);});
test('same-name no-op guard never satisfies preflight',()=>{const bad=rows();bad[0].ACTION_STATEMENT='SET @nothing=1';assert.throws(()=>assertForecastTriggerDefinitions(bad,{requireAll:false}),/definition_mismatch/);});
test('all eight exact guards satisfy postflight',()=>assert.equal(assertForecastTriggerDefinitions(rows()).verified,8));
