from PIL import Image, ImageFilter
import numpy as np, sys
from collections import deque
names=['base.jpg','blink.jpg','talk.jpg','wave.jpg','point.jpg','worried.jpg','thinking.jpg','celebrate.jpg']
S=640; TOL=int(sys.argv[1]) if len(sys.argv)>1 else 13
out=[]
for n in names:
    im=Image.open(n).convert('RGB').resize((S,S),Image.LANCZOS)
    a=np.asarray(im).astype(int)
    bg=(a[:, :6].mean(1)+a[:, -6:].mean(1))/2
    d=np.abs(a-bg[:,None,:]).max(2)
    cand=d<TOL
    luma=a.mean(2)
    # ظل الأرضية: أسفل الحذاء أي بكسل فاتح يُعد خلفية
    low=np.zeros((S,S),bool); low[int(S*0.845):]=True
    cand|=(low&(luma>150))
    seen=np.zeros((S,S),bool); q=deque()
    for i in range(S):
        for p in ((0,i),(S-1,i),(i,0),(i,S-1)):
            if cand[p] and not seen[p]: seen[p]=True;q.append(p)
    while q:
        y,x=q.popleft()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            yy,xx=y+dy,x+dx
            if 0<=yy<S and 0<=xx<S and cand[yy,xx] and not seen[yy,xx]:
                seen[yy,xx]=True;q.append((yy,xx))
    fg=~seen
    hy,hx=np.where(fg[int(S*0.1):int(S*0.4)])
    cx=(hx.min()+hx.max())/2
    for y in range(int(S*0.768),int(S*0.835)):      # التنورة الكريمية بلون الخلفية: نملؤها بالتناظر
        xs=np.where(fg[y])[0]
        if len(xs)==0: continue
        l=xs.min(); r=max(xs.max(),int(round(2*cx-l)))
        l=min(l,int(round(2*cx-xs.max())))
        cap=int(S*0.152); l=max(l,int(cx-cap)); r=min(r,int(cx+cap))
        fg[y,l:r+1]=True
    al=Image.fromarray((fg*255).astype('uint8'))
    al=al.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))   # سدّ الثقوب
    al=al.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.0))
    rgba=im.convert('RGBA'); rgba.putalpha(al)
    out.append((n.split('.')[0],rgba))
box=None
for _,i in out:
    b=i.getchannel('A').point(lambda v:255 if v>20 else 0).getbbox()
    box=b if box is None else (min(box[0],b[0]),min(box[1],b[1]),max(box[2],b[2]),max(box[3],b[3]))
box=(max(0,box[0]-6),max(0,box[1]-6),min(S,box[2]+6),min(S,box[3]+6))
print('crop',box)
import os
for name,i in out:
    c=i.crop(box); c.thumbnail((360,360),Image.LANCZOS)
    c.save('../'+('idle' if name=='base' else name)+'.webp',quality=86,method=6)
    print(name,c.size,os.path.getsize('../'+('idle' if name=='base' else name)+'.webp'))
sheet=Image.new('RGB',(4*400,2*400),(40,70,120))
for k,(_,i) in enumerate(out):
    t=i.resize((400,400)); sheet.paste(t,((k%4)*400,(k//4)*400),t)
if len(sys.argv)>2: sheet.save(sys.argv[2],quality=85)
# أفاتار دائري لرأس المحادثة
av=Image.open('base.jpg').convert('RGB'); w=av.size[0]
av=av.crop((int(w*.26),int(w*.07),int(w*.74),int(w*.55))).resize((128,128),Image.LANCZOS); av.save('../avatar.webp',quality=88)
