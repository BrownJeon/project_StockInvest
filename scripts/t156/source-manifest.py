"""Run on the source host. Only exports public research-table metadata."""
import subprocess,json,sys,datetime
CONTAINER='stockinvest-t156-research-20261106-a22'
DB='t156_research_20261106'
def sql(q):
    p=subprocess.run(['docker','exec','-i',CONTAINER,'mariadb','--protocol=SOCKET','-uroot','-N','-B','--raw',DB],input=q,text=True,capture_output=True,check=True)
    return p.stdout.strip()
tables=sql('SHOW TABLES;').splitlines()
assert all(t.replace('_','').isalnum() for t in tables)
result=[]
for t in tables:
    n=int(sql(f'SELECT COUNT(*) FROM `{t}`;'))
    checksum=sql(f'CHECKSUM TABLE `{t}` EXTENDED;').split('\t')[-1]
    assert checksum.isdigit(), 'source checksum unavailable'
    result.append({'table':t,'rows':n,'checksum':checksum})
json.dump({'sourceDatabase':DB,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tables':result},sys.stdout,indent=2)
