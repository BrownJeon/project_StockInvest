import json,subprocess,sys,datetime
m=json.load(open(sys.argv[1]));db=sys.argv[2]
assert db=='t156_transfer_verify_20261108'
r=[]
for t in m['tables']:
 table='t156_research_'+t['table']
 query=f'SELECT COUNT(*) FROM `{table}`; CHECKSUM TABLE `{table}` EXTENDED;'
 p=subprocess.run(['docker','exec','-i','stockinvest-t156-research-20261106-a22','mariadb','--protocol=SOCKET','-uroot','-N','-B',db],input=query,text=True,capture_output=True,check=True)
 lines=p.stdout.strip().splitlines();rows=int(lines[0]);checksum=lines[1].split('\t')[-1]
 match=rows==t['rows'] and checksum==t['checksum'];r.append({'table':t['table'],'rows':rows,'checksum':checksum,'match':match})
 if not match:raise SystemExit('restore mismatch '+t['table'])
json.dump({'kind':'isolated_full_restore','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tables':r,'totalRows':sum(x['rows'] for x in r),'passed':all(x['match'] for x in r)},sys.stdout,indent=2)
