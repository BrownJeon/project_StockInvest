import {brkCaRequest,validateBrkCaPages,BRK_EVENT_LIMITATION} from '../forward-stock-events';
import {stockEvidenceSha,type BrkEvidencePage} from '../forward-stock-contract';
const at='2026-11-11T08:18:25.378Z',date='2026-11-11',close='2026-11-10T21:00:00Z';
function page(body:unknown,token?:string):BrkEvidencePage{const rawJson=JSON.stringify(body);return {request:brkCaRequest(date),http:200,observedAt:at,rawJson,sha256:stockEvidenceSha(rawJson),requestTokenSha256:token?stockEvidenceSha(token):null};}
const check=(p:BrkEvidencePage[])=>validateBrkCaPages(p,date,close,at);
test('empty complete all-types/all-quality query is finite evidence only',()=>expect(check([page({corporate_actions:{},next_page_token:null})])).toMatchObject({limitation:BRK_EVENT_LIMITATION}));
test.each([{forward_splits:[{symbol:'BRK.B',data_quality:'incomplete'}]},{unknown:[{}]},{cash_dividends:[{symbol:'OTHER'}]},{reverse_splits:'not-array'}])('nonempty/unknown/incomplete actions are never silently discarded',corporate_actions=>expect(()=>check([page({corporate_actions,next_page_token:null})])).toThrow());
test('all pages must finish with the exact token hash chain',()=>{const p1=page({corporate_actions:{},next_page_token:'token'}),p2=page({corporate_actions:{},next_page_token:null},'token');expect(()=>check([p1,p2])).not.toThrow();expect(()=>check([p1])).toThrow();p2.requestTokenSha256='a'.repeat(64);expect(()=>check([p1,p2])).toThrow();});
test('default quality, stale process window and before-close evidence fail closed',()=>{const p=page({corporate_actions:{},next_page_token:null});p.request.data_quality='provisional';expect(()=>check([p])).toThrow();const q=page({corporate_actions:{},next_page_token:null});q.observedAt='2026-11-10T20:00:00Z';expect(()=>check([q])).toThrow();});
import {validateBrkSecSnapshot,BRK_MATERIAL_REVIEW} from '../forward-stock-events';
import {brkFixture} from './forward-stock-fixtures';
test('fresh official SEC snapshot binds identity and the finite known-material review',()=>{const f=brkFixture();expect(()=>validateBrkSecSnapshot(f.envelope.events.sec!,f.envelope.events.queryDate,close,f.options.now)).not.toThrow();expect(BRK_MATERIAL_REVIEW.materials.find(m=>m.form==='10-Q')).toMatchObject({evidenceKind:'official_web_parsed_targeted',rawBodySha256:null});expect(BRK_MATERIAL_REVIEW.completeHistoryGuaranteed).toBe(false);});
test.each(['newMaterial','unaligned','futureAcceptance','wrongCIK'])('SEC %s does not silently become no-conflict evidence',kind=>{const f=brkFixture(),p=f.envelope.events.sec!,body=JSON.parse(p.rawJson);if(kind==='newMaterial')body.filings.recent.form[0]='S-3';if(kind==='unaligned')body.filings.recent.items.pop();if(kind==='futureAcceptance')body.filings.recent.acceptanceDateTime[0]='2030-01-01T00:00:00Z';if(kind==='wrongCIK')body.cik='0000000001';p.rawJson=JSON.stringify(body);p.sha256=stockEvidenceSha(p.rawJson);expect(()=>validateBrkSecSnapshot(p,f.envelope.events.queryDate,close,f.options.now)).toThrow();});
test('NY day freshness does not use UTC midnight and cannot carry Friday evidence into a weekend day',()=>{const p=page({corporate_actions:{},next_page_token:null});expect(()=>validateBrkCaPages([p],date,close,'2026-11-12T00:30:00Z')).not.toThrow();expect(()=>validateBrkCaPages([p],date,close,'2026-11-12T05:00:00Z')).toThrow('clock_invalid');const friday=page({corporate_actions:{},next_page_token:null});friday.observedAt='2026-11-13T23:00:00Z';friday.request=brkCaRequest('2026-11-13');expect(()=>validateBrkCaPages([friday],'2026-11-13','2026-11-13T21:00:00Z','2026-11-14T06:00:00Z')).toThrow('clock_invalid');});

// ---- T-178: form-class pass set (analyst v1 rule, T1~T10). Network-free; validateBrkSecSnapshot only. ----
import {BRK_SEC_FORM_PASS,brkMaterialReviewSha} from '../forward-stock-events';
import {BRK_SEC_REAL_ROWS_20261119 as REAL,BRK_SEC_REAL_CLOCK as CLOCK,brkSecPage,type BrkSecRow} from './forward-stock-sec-fixtures';
/**
 * One line per pass-set group, listed here independently of the constant.
 * Dropping a group (user decision) = delete its line in BRK_SEC_FORM_PASS.groups + set `pass:false` on the same line here; every T-178 assertion follows.
 */
const GROUPS:readonly {group:string;pass:boolean;forms:readonly string[]}[]=[
 {group:'insiderOwnership',pass:true,forms:['3','3/A','4','4/A','5','5/A','144']},
 {group:'institutionalHoldings',pass:true,forms:['13F-HR','13F-HR/A','13F-NT','13F-NT/A']},
 {group:'passiveBeneficialOwnership',pass:true,forms:['SCHEDULE 13G','SCHEDULE 13G/A']},
 {group:'activeBeneficialOwnership',pass:true,forms:['SCHEDULE 13D','SCHEDULE 13D/A']}, // kept by user decision 2026-11-20 (C1 Codex medium not adopted)
 {group:'registeredOffering',pass:true,forms:['FWP','424B2','424B5']}, // kept by user decision 2026-11-20 (C1 Codex high not adopted)
];
const UNREVIEWED='forward_pair_events_unreviewed_material_filing';
const groupOf=(form:unknown)=>GROUPS.find(g=>g.forms.includes(form as string));
const isReviewed=(r:BrkSecRow)=>BRK_MATERIAL_REVIEW.materials.some(m=>m.accession===r.accessionNumber);
const reviewedRows=REAL.filter(isReviewed),coverage=REAL.find(r=>r.accessionNumber==='0001193125-26-445930')!; // real Form 4 filed 2026-11-03, just before the window
let seq=0;const row=(form:unknown,o:Partial<BrkSecRow>={}):BrkSecRow=>({accessionNumber:`0009999999-26-${String(++seq).padStart(6,'0')}`,filingDate:'2026-11-17',acceptanceDateTime:'2026-11-17T16:00:00.000Z',form,primaryDocument:'doc.htm',items:'',...o});
const run=(rows:readonly BrkSecRow[])=>()=>validateBrkSecSnapshot(brkSecPage(rows),CLOCK.queryDate,CLOCK.asOfClose,CLOCK.now);
const withBase=(...rows:BrkSecRow[])=>run([...rows,...reviewedRows,coverage]);
const expectVerdict=(check:()=>unknown,pass:boolean)=>{if(pass)expect(check()).toMatchObject({reviewManifestSha256:brkMaterialReviewSha()});else expect(check).toThrow(UNREVIEWED);};

describe('T-178 T1 real 2026-11-19 snapshot (archived metadata of the blocked cycle)',()=>{
 const inWindow=REAL.filter(r=>(r.filingDate as string)>=CLOCK.windowStart),outside=inWindow.filter(r=>!isReviewed(r));
 test('fixture holds the 9 unreviewed filings, 3 in-window Form 4s and the 3 reviewed filings',()=>{
  const count=(rows:readonly BrkSecRow[])=>rows.reduce<Record<string,number>>((a,r)=>({...a,[r.form as string]:(a[r.form as string]??0)+1}),{});
  expect(REAL).toHaveLength(18);expect(reviewedRows.map(r=>r.accessionNumber).sort()).toEqual(BRK_MATERIAL_REVIEW.materials.map(m=>m.accession).sort());
  expect(count(outside)).toEqual({'SCHEDULE 13D/A':1,'4':3,'424B5':1,'SCHEDULE 13G/A':4,'SCHEDULE 13G':1,'13F-HR':1,FWP:1});
 });
 test('whole snapshot passes iff every unreviewed in-window filing belongs to a passing group',()=>expectVerdict(run(REAL),outside.every(r=>groupOf(r.form)?.pass===true)));
 test.each(REAL.filter(r=>!isReviewed(r)&&(r.filingDate as string)>=CLOCK.windowStart).map(r=>[r.form,r.accessionNumber,r]))('real %s %s alone follows its group',(_f,_a,r)=>expectVerdict(withBase(r as BrkSecRow),groupOf((r as BrkSecRow).form)?.pass===true));
});

describe('T-178 T2 pass-set groups (each group asserted independently)',()=>{
 test('constant holds exactly the passing groups and forms of the table above',()=>{
  const groups=BRK_SEC_FORM_PASS.groups as unknown as Record<string,readonly string[]>;
  expect(Object.keys(groups).sort()).toEqual(GROUPS.filter(g=>g.pass).map(g=>g.group).sort());
  for(const g of GROUPS.filter(g=>g.pass))expect([...groups[g.group]]).toEqual([...g.forms]);
 });
 test.each(GROUPS.flatMap(g=>g.forms.map(form=>[g.group,form,g.pass] as const)))('%s %s → pass=%s',(_g,form,pass)=>expectVerdict(withBase(row(form)),pass));
});

describe('T-178 T3~T8 closed by default',()=>{
 test.each([['8-K','8.01'],['8-K','3.03,5.03'],['8-K','2.02,9.01'],['8-K',''],['8-K/A',''],['10-K',''],['10-K/A',''],['10-Q',''],['DEF 14A',''],['DEFA14A',''],['S-3',''],['S-3ASR',''],['S-4',''],['424B1',''],['424B3',''],['424B4',''],['424B7',''],['425',''],['25',''],['11-K',''],['S-8 POS',''],['SD',''],['SC 13G',''],['SC 13D/A',''],['XYZ-NEW','']])('T3 %s items=%j outside the finite review → unreviewed',(form,items)=>expect(withBase(row(form,{items}))).toThrow(UNREVIEWED));
 test.each(['schedule 13g/a',' FWP','FWP ','13f-hr','SCHEDULE  13G','424b5','4 ','SCHEDULE 13G',''])('T4 form %j is never normalized → unreviewed',form=>expect(withBase(row(form))).toThrow(UNREVIEWED));
 test.each(['4','13F-HR'])('T5 passing form %s still needs empty items and a named primary document',form=>{
  expect(withBase(row(form))).not.toThrow();
  for(const o of [{items:'1.01'},{items:null},{items:' '},{primaryDocument:''},{primaryDocument:7},{primaryDocument:null}])expect(withBase(row(form,o))).toThrow(UNREVIEWED);
 });
 test.each([4,null])('T5 non-string form %j → unreviewed',form=>expect(withBase(row(form))).toThrow(UNREVIEWED));
 test.each(BRK_MATERIAL_REVIEW.materials.map(m=>[m.form,m.accession]))('T6 reviewed %s %s is checked before the form-class rule',(_f,accession)=>{
  for(const form of ['13F-HR','4','FWP']){const rows=reviewedRows.map(r=>r.accessionNumber===accession?{...r,form}:r);expect(run([...rows,coverage])).toThrow(UNREVIEWED);}
  const rows=reviewedRows.map(r=>r.accessionNumber===accession?{...r,acceptanceDateTime:'2026-11-09T12:00:00.000Z'}:r);expect(run([...rows,coverage])).toThrow(UNREVIEWED);
 });
 test('T7 pre-T-178 Form 4 exception keeps its behavior',()=>{expect(withBase(row('4',{primaryDocument:'xslF345X06/ownership.xml'}))).not.toThrow();expect(withBase(row('4',{items:'5.02'}))).toThrow(UNREVIEWED);});
 test('T8 14-day window edge: the day before the window start is skipped, the start day is checked',()=>{
  expect(withBase(row('8-K',{items:'8.01',filingDate:'2026-11-04',acceptanceDateTime:'2026-11-04T16:00:00.000Z'}))).not.toThrow();
  expect(withBase(row('8-K',{items:'8.01',filingDate:CLOCK.windowStart,acceptanceDateTime:'2026-11-05T16:00:00.000Z'}))).toThrow(UNREVIEWED);
 });
});

describe('T-178 T9 invariants',()=>{
 test('finite review manifest and its envelope hash are byte-identical to base b85a557',()=>{expect(brkMaterialReviewSha()).toBe('e226bd65924f91664f9434d0cf9865bc70fd0df57f6d271f67b85407a4f1a79f');expect(BRK_MATERIAL_REVIEW.version).toBe('brkb_finite_material_review_20261111_v1');expect(BRK_MATERIAL_REVIEW.materials).toHaveLength(3);});
 test('pass set is deeply frozen and versioned',()=>{
  expect(BRK_SEC_FORM_PASS.version).toMatch(/^brkb_sec_form_class_\d{8}_v\d+$/);expect(Object.isFrozen(BRK_SEC_FORM_PASS)).toBe(true);expect(Object.isFrozen(BRK_SEC_FORM_PASS.groups)).toBe(true);
  for(const forms of Object.values(BRK_SEC_FORM_PASS.groups))expect(Object.isFrozen(forms)).toBe(true);
  expect(()=>{(Object.values(BRK_SEC_FORM_PASS.groups)[0] as unknown as string[]).push('8-K');}).toThrow(TypeError);expect(withBase(row('8-K'))).toThrow(UNREVIEWED);
 });
 test('T10 a dropped group is a table flip: forms of non-passing groups are blocked (vacuous while all groups pass)',()=>{for(const g of GROUPS.filter(g=>!g.pass))for(const form of g.forms)expect(withBase(row(form))).toThrow(UNREVIEWED);});
});
