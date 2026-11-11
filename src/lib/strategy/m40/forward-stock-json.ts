/** Lossless JSON numbers. Decimal normalization changes representation only, never price or precision. */
export class StockJsonNumber {constructor(readonly text:string){}}
const invalid=():never=>{throw Error('forward_pair_json_invalid');};
export function stockDecimal(raw:string):string {
 const m=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);if(!m||raw.length>300)return invalid();
 const exponent=Number(m[4]??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>100)return invalid();
 let digits=(m[2]+(m[3]??'')).replace(/^0+/,'')||'0',scale=(m[3]?.length??0)-exponent;
 if(scale<0){digits+='0'.repeat(-scale);scale=0;}
 if(scale>=digits.length)digits='0'.repeat(scale-digits.length+1)+digits;
 let text=scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;
 text=text.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 return m[1]&&text!=='0'?'-'+text:text;
}
export function stockNumber(value:unknown):string {if(!(value instanceof StockJsonNumber))return invalid();return stockDecimal(value.text);}
export function parseStockJson(text:string):unknown {
 let at=0,count=0;const whitespace=()=>{while(/[\x20\x09\x0a\x0d]/.test(text[at]??'!'))at++;};
 function value(depth:number):unknown {
  if(depth>32||++count>1000000)return invalid();whitespace();const start=at,c=text[at];
  if(c==='"'){at++;while(at<text.length){if(text[at]==='\\'){at+=2;continue;}if(text[at++]==='"'){try{return JSON.parse(text.slice(start,at));}catch{return invalid();}}}return invalid();}
  if(c==='{'||c==='['){at++;const object=c==='{',end=object?'}':']';const result:Record<string,unknown>|unknown[]=object?Object.create(null):[];whitespace();if(text[at]===end){at++;return result;}
   while(at<text.length){if(object){whitespace();if(text[at]!=='"')return invalid();const key=value(depth+1);if(typeof key!=='string'||Object.hasOwn(result,key))return invalid();whitespace();if(text[at++]!==':')return invalid();(result as Record<string,unknown>)[key]=value(depth+1);}else (result as unknown[]).push(value(depth+1));whitespace();const next=text[at++];if(next===end)return result;if(next!==',')return invalid();}return invalid();}
  const tail=text.slice(at);for(const [literal,result]of [['true',true],['false',false],['null',null]] as const)if(tail.startsWith(literal)){at+=literal.length;return result;}
  const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(tail);if(!number)return invalid();at+=number[0].length;stockDecimal(number[0]);return new StockJsonNumber(number[0]);
 }
 const out=value(0);whitespace();if(at!==text.length)return invalid();return out;
}
