import {parseStockJson,stockNumber,stockDecimal} from '../forward-stock-json';
test('decimal lexemes remain exact beyond IEEE754 and scientific notation',()=>{const p=parseStockJson('{"p":123.45000000000000001,"n":9007199254740993,"e":1.230e-2}') as Record<string,unknown>;expect(stockNumber(p.p)).toBe('123.45000000000000001');expect(stockNumber(p.n)).toBe('9007199254740993');expect(stockNumber(p.e)).toBe('0.0123');expect(stockDecimal('1.2300')).toBe('1.23');});
test.each(['{"p":1,"p":2}','[1,]','01','1e999','{"p":NaN}','{"p":1} secret'])('malformed/ambiguous numeric JSON rejected %s',s=>expect(()=>parseStockJson(s)).toThrow('forward_pair_json_invalid'));
test('number strings cannot impersonate JSON numeric values',()=>expect(()=>stockNumber('123')).toThrow('forward_pair_json_invalid'));
