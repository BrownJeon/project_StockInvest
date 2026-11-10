import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { fetchForwardIndexCurl } from '../forward-sources';
jest.mock('node:child_process',()=>({spawn:jest.fn()}));
const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=2026-11-01&coed=2026-11-09';
function processFixture(){const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),kill:jest.fn()});jest.mocked(spawn).mockReturnValue(child as never);return child;}
afterEach(()=>{jest.useRealTimers();jest.resetAllMocks();});
test('curl ignores user config, verifies TLS, allows no redirects, and bounds bytes/time',async()=>{
 const child=processFixture(),promise=fetchForwardIndexCurl(url,{timeoutMs:50,maxBytes:100});
 expect(jest.mocked(spawn).mock.calls[0][1]).toEqual(['-q','--ipv4','--silent','--show-error','--proto','=https','--max-redirs','0','--max-time','0.05','--max-filesize','100','--write-out','\n%{http_code}',url]);
 child.stdout.write('DATE,SP500\n2026-11-06,6000\n200');child.emit('close',0);
 expect(await promise).toEqual({status:200,text:'DATE,SP500\n2026-11-06,6000'});
});
test('nonallowlisted URL cannot spawn curl',()=>{expect(()=>fetchForwardIndexCurl('https://evil.test/',{timeoutMs:1,maxBytes:10})).toThrow('forward_source_url_invalid');expect(spawn).not.toHaveBeenCalled();});
test('oversized streaming data kills curl and rejects before retaining an unbounded response',async()=>{
 const child=processFixture(),promise=fetchForwardIndexCurl(url,{timeoutMs:50,maxBytes:10});
 child.stdout.write('x'.repeat(15));await expect(promise).rejects.toThrow('forward_source_response_budget');expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});
test('deadline kills the child, and a late close cannot turn timeout into success',async()=>{
 jest.useFakeTimers();const child=processFixture(),promise=fetchForwardIndexCurl(url,{timeoutMs:50,maxBytes:100});
 jest.advanceTimersByTime(50);child.emit('close',0);await expect(promise).rejects.toThrow('forward_source_timeout');expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});
