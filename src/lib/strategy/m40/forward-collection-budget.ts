/** Per-cycle DATA transport budget. Authentication is separately bounded, never counted as a data response. */
import { performance } from 'node:perf_hooks';
export const FORWARD_SHARED_LIMITS=Object.freeze({requests:301,deadlineMs:420000,totalBytes:20*1024*1024,responseBytes:512*1024,spacingMs:1000});
export class ForwardCollectionBudget {
 private readonly began:number;private last:number|null=null;private previous:number;private requests=0;private bytes=0;
 constructor(private readonly clock:()=>number=()=>performance.now(),private readonly sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))){this.began=this.previous=clock();}
 remaining():number {const now=this.clock();if(!Number.isFinite(now)||now<this.previous)throw Error('forward_source_deadline');this.previous=now;const left=FORWARD_SHARED_LIMITS.deadlineMs-(now-this.began);if(left<=0)throw Error('forward_source_deadline');return left;}
 /** Call immediately before each physical data request, including a second transport attempt. */
 responseLimit(max=FORWARD_SHARED_LIMITS.responseBytes):number{const left=FORWARD_SHARED_LIMITS.totalBytes-this.bytes;if(left<=0)throw Error('forward_source_response_budget');return Math.min(max,left);}
 async reserve(maxMs=20000):Promise<number>{
  this.remaining();this.responseLimit();
  if(this.requests>=FORWARD_SHARED_LIMITS.requests)throw Error('forward_source_deadline');
  if(this.last!==null){const pause=Math.max(0,FORWARD_SHARED_LIMITS.spacingMs-(this.clock()-this.last));if(pause>=this.remaining())throw Error('forward_source_deadline');if(pause)await this.sleep(pause);}
  const left=this.remaining();this.last=this.clock();this.requests++;return Math.max(1,Math.floor(Math.min(maxMs,left)));
 }
 consume(bytes:number):void {if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('forward_source_response_budget');this.bytes+=bytes;if(this.bytes>FORWARD_SHARED_LIMITS.totalBytes)throw Error('forward_source_response_budget');this.remaining();}
 snapshot(){return {dataRequests:this.requests,bodyBytes:this.bytes,authenticationRequestsIncluded:false};}
}
