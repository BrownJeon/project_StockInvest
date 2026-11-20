import {readBootstrapPresence} from '../bootstrap-presence';
const rows=(...pairs:string[][])=>[pairs.map(([table_name,object_name])=>({table_name,object_name})),[]];
test('only exact allowlisted names in the current database suppress duplicate DDL',async()=>{
 const query=jest.fn().mockResolvedValueOnce(rows(['signals','market'],['signals','price_at_skip'],['orders','market'],['symbol_universe','market'],['signals','status'],['SIGNALS','price_1h_after'])).mockResolvedValueOnce(rows(['signals','idx_signals_market'],['orders','idx_orders_market']));
 const p=await readBootstrapPresence({query});expect(p.hasColumn('signals','market')).toBe(true);expect(p.hasColumn('signals','price_at_skip')).toBe(true);expect(p.hasColumn('orders','market')).toBe(true);expect(p.hasColumn('symbol_universe','market')).toBe(true);expect(p.hasColumn('signals','status')).toBe(false);expect(p.hasColumn('SIGNALS','price_1h_after')).toBe(false);expect(p.hasIndex('orders','idx_orders_market')).toBe(true);expect(p.hasIndex('signals','idx_signals_market')).toBe(true);
 for(const [options] of query.mock.calls){expect(options.sql).toContain('TABLE_SCHEMA=DATABASE()');expect(options.timeout).toBe(3000);}expect(query).toHaveBeenCalledTimes(2);
});
test.each([undefined,{},[{}],[[{table_name:'signals'}]],[[null]],[[{table_name:'signals',object_name:'market'},{table_name:12,object_name:'market'}]]])('unknown metadata shape falls back without partial positives: %j',async value=>{const p=await readBootstrapPresence({query:jest.fn().mockResolvedValue(value)});expect(p.hasColumn('signals','market')).toBe(false);expect(p.hasIndex('orders','idx_orders_market')).toBe(false);});
test('absent objects and independent query failures preserve DDL fallback',async()=>{const query=jest.fn().mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(rows(['orders','idx_orders_market']));const p=await readBootstrapPresence({query});expect(p.hasColumn('signals','market')).toBe(false);expect(p.hasIndex('orders','idx_orders_market')).toBe(true);expect(p.hasIndex('signals','idx_signals_market')).toBe(false);});
test('pool wait is bounded; late metadata cannot change the returned absence snapshot',async()=>{jest.useFakeTimers();let finish!:(v:unknown)=>void;const query=jest.fn().mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce(rows());try{const pending=readBootstrapPresence({query});await jest.advanceTimersByTimeAsync(3001);const p=await pending;finish(rows(['signals','market']));await Promise.resolve();expect(p.hasColumn('signals','market')).toBe(false);expect(jest.getTimerCount()).toBe(0);}finally{jest.useRealTimers();}});

// ── T-179 확장 — 정의 완전 일치(columnIs)와 조회 성공 여부(known) ─────────────────────────────
const defRows=(...r:Array<[string,string,string,string,string|null]>)=>[r.map(([table_name,object_name,column_type,is_nullable,column_default])=>({table_name,object_name,column_type,is_nullable,column_default})),[]];
const FLOAT6={columnType:'float',isNullable:'NO' as const,columnDefault:'6'};
test('T-179 columnIs — 세 값이 모두 같을 때만 참(하나라도 다르면 DDL 을 보낸다)',async()=>{
 const query=jest.fn().mockResolvedValueOnce(defRows(['strategies','backtest_interval_h','float','NO','6'],['strategies','applicable_styles','set(\'a\')','NO',"'a'"])).mockResolvedValueOnce(rows());
 const p=await readBootstrapPresence({query});
 expect(p.columnIs('strategies','backtest_interval_h',FLOAT6)).toBe(true);
 expect(p.columnIs('strategies','backtest_interval_h',{...FLOAT6,columnType:'double'})).toBe(false);
 expect(p.columnIs('strategies','backtest_interval_h',{...FLOAT6,isNullable:'YES'})).toBe(false);
 expect(p.columnIs('strategies','backtest_interval_h',{...FLOAT6,columnDefault:null})).toBe(false);
 expect(p.columnIs('strategies','backtest_interval_h',{...FLOAT6,columnDefault:'6.0'})).toBe(false);
 expect(p.columnIs('strategies','missing_col',FLOAT6)).toBe(false);
 expect(p.hasColumn('strategies','applicable_styles')).toBe(true);
 expect(p.columnsKnown).toBe(true);expect(p.indexesKnown).toBe(true);
 expect(query.mock.calls[0][0].sql).toMatch(/TABLE_NAME IN \('strategies','signals','orders','symbol_universe','position_state','stock_favorites','research_rally_results'\)/);
 expect(query.mock.calls[1][0].sql).toMatch(/TABLE_NAME IN \('signals','orders','symbol_universe','position_state'\)/);
});
test('T-179 columnIs — 정의 필드가 없거나 형태가 낯설면 이름만 인정하고 정의는 모름',async()=>{
 const query=jest.fn().mockResolvedValueOnce(rows(['strategies','backtest_interval_h'])).mockResolvedValueOnce(rows());
 let p=await readBootstrapPresence({query});
 expect(p.hasColumn('strategies','backtest_interval_h')).toBe(true);
 expect(p.columnIs('strategies','backtest_interval_h',FLOAT6)).toBe(false);
 const q2=jest.fn().mockResolvedValueOnce([[{table_name:'strategies',object_name:'backtest_interval_h',column_type:'float',is_nullable:'no',column_default:'6'}],[]]).mockResolvedValueOnce(rows());
 p=await readBootstrapPresence({query:q2});
 expect(p.columnIs('strategies','backtest_interval_h',FLOAT6)).toBe(false);
 const q3=jest.fn().mockResolvedValueOnce([[{table_name:'strategies',object_name:'backtest_interval_h',column_type:'float',is_nullable:'NO',column_default:6}],[]]).mockResolvedValueOnce(rows());
 p=await readBootstrapPresence({query:q3});
 expect(p.columnIs('strategies','backtest_interval_h',FLOAT6)).toBe(false);
});
test('T-179 known — 조회 실패·낯선 형태면 false(호출부는 실패 경고를 내지 않고 지금처럼 보낸다)',async()=>{
 const query=jest.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
 const p=await readBootstrapPresence({query});
 expect(p.columnsKnown).toBe(false);expect(p.indexesKnown).toBe(false);
 expect(p.hasColumn('signals','scenario_source')).toBe(false);
 const q2=jest.fn().mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows());
 const p2=await readBootstrapPresence({query:q2});
 expect(p2.columnsKnown).toBe(true);expect(p2.hasColumn('signals','scenario_source')).toBe(false);
});
test('T-179 새로 판단하는 객체 — 허용 목록에 정확한 이름으로 들어 있다',async()=>{
 const cols:[string,string][]=[['strategies','applicable_styles'],['signals','scenario_source'],['signals','valid_from'],['symbol_universe','tier'],['symbol_universe','rs_rating'],['symbol_universe','near_52w_high'],['symbol_universe','vol_ratio_20d'],['symbol_universe','rs_updated_at'],['position_state','scenario_exit'],['position_state','holding_deadline'],['stock_favorites','research_enabled'],['research_rally_results','today_active_rule_ids'],['research_rally_results','price_targets']];
 const idx:[string,string][]=[['signals','idx_signals_valid_from'],['symbol_universe','idx_universe_tier'],['symbol_universe','idx_rs_rating'],['position_state','idx_position_state_deadline']];
 const query=jest.fn().mockResolvedValueOnce(rows(...cols)).mockResolvedValueOnce(rows(...idx));
 const p=await readBootstrapPresence({query});
 for(const [t,c] of cols) expect(p.hasColumn(t,c)).toBe(true);
 for(const [t,i] of idx) expect(p.hasIndex(t,i)).toBe(true);
 expect(p.hasColumn('users','password_hash')).toBe(false);
});
