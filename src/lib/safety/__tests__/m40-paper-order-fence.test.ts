jest.mock('@/lib/db',()=>({getPool:jest.fn(()=>{throw Error('unexpected_database');})}));
import { submitOrder } from '../dry-run';
import { getPool } from '@/lib/db';
test.each(['buy','sell'] as const)('reserved paper strategy refuses %s before any settings/DB/broker I/O',async side=>{
 const broker=jest.fn();
 await expect(submitOrder({exchange:'kis',symbol:'NAS:TEST',side,type:'market',quantity:1},broker,
  {attribution:{kind:'strategy',strategyId:'m40-paper-v1',signalId:null}})).resolves.toMatchObject({ok:false,blockedBy:'paper_only'});
 expect(broker).not.toHaveBeenCalled();expect(getPool).not.toHaveBeenCalled();
});
test.each(['buy','sell'] as const)('paper client provenance refuses %s even when strategy attribution is absent',async side=>{
 const broker=jest.fn();
 await expect(submitOrder({exchange:'kis',symbol:'NAS:TEST',side,type:'market',clientOrderId:'m40p_test'},broker))
  .resolves.toMatchObject({ok:false,blockedBy:'paper_only'});
 expect(broker).not.toHaveBeenCalled();expect(getPool).not.toHaveBeenCalled();
});
