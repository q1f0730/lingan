import json,re,struct,hashlib,numpy as np
t=json.load(open('tokenizer.json')); V=t['model']['vocab']
f=open('model.safetensors','rb'); n=struct.unpack('<Q',f.read(8))[0]; json.loads(f.read(n))
E_=np.memmap('model.safetensors',dtype='<f4',mode='r',offset=8+n,shape=(500353,256))
cjk=re.compile(r'^▁?[\u3400-\u9fff]+$'); asc=re.compile(r'^▁?[A-Za-z0-9]+$'); pun=re.compile(r'^▁?[^\w\s]+$')
A=[];B=[];C=[]
for i,(s,sc) in enumerate(V):
  if i<2: continue
  if cjk.match(s): A.append(i)
  elif asc.match(s): B.append((sc,i))
  elif pun.match(s) and len(s)<=3: C.append((sc,i))
B=[i for _,i in sorted(B,reverse=True)[:12000]]; C=[i for _,i in sorted(C,reverse=True)[:1500]]
keep=sorted(set(A+B+C+[4]))
assert all('\n' not in V[i][0] for i in keep)
sub=np.asarray(E_[keep],dtype=np.float32); sc=(np.abs(sub).max(1)/127).astype('<f4'); sc[sc==0]=1e-9
q=np.round(sub/sc[:,None]).clip(-127,127).astype(np.int8)
voc='\n'.join(V[i][0] for i in keep).encode('utf-8'); pad=(-len(voc))%4
scores=np.array([V[i][1] for i in keep],dtype='<f4')
out=b'GM1\0'+struct.pack('<III',len(keep),256,len(voc))+voc+b'\0'*pad+scores.tobytes()+sc.tobytes()+q.tobytes()
open('mini-zh-v1.bin','wb').write(out)
print(len(keep),len(out),hashlib.sha256(out).hexdigest())
# reference vectors for tests
import unicodedata
voc_d={V[i][0]:(V[i][1],k) for k,i in enumerate(keep)}
ML=max(len(V[i][0]) for i in keep)
def tok(text):
  s='▁'+unicodedata.normalize('NFKC',text).replace(' ','▁'); N=len(s)
  best=[-1e18]*(N+1); back=[None]*(N+1); best[0]=0
  for j in range(1,N+1):
    for i in range(max(0,j-ML),j):
      if best[i]<-1e17: continue
      r=voc_d.get(s[i:j])
      if r: v=best[i]+r[0]
      elif j-i==1: v=best[i]-30; r=None
      else: continue
      if v>best[j]: best[j]=v; back[j]=(i,r[1] if r else None)
  o=[];j=N
  while j>0: i,k=back[j]; o.append(k); j=i
  return [k for k in o[::-1] if k is not None]
ref={}
for s in ['孤独','一个人坐末班车','雨夜霓虹','Lonely night']:
  ids=tok(s); v=np.mean([q[k].astype(np.float32)*sc[k] for k in ids],0); v/=np.linalg.norm(v)
  ref[s]={'ids':ids,'v8':[round(float(x),5) for x in v[:8]]}
json.dump({'maxlen':ML,'ref':ref},open('ref.json','w'),ensure_ascii=False)
print(ML, ref['孤独'])
