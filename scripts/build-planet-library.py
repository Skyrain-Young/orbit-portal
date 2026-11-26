"""Deterministic, original astronomy-inspired UI spheres. Offline: numpy + Pillow."""
import json
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'web/portal/textures'
base=[('core','地球','Earth','蓝色海洋与云层'),('git','火星','Mars','铁锈色荒漠'),('doc','月球','Moon','月海与撞击坑'),('week','木星','Jupiter','多层云带'),('flow','土星','Saturn','淡金云层'),('gpu','天王星','Uranus','青色大气'),('bi','海王星','Neptune','深蓝大气'),('seek','金星地表','Venus surface','雷达地形的暖色表达')]
extra=[
('mercury','水星','Mercury','crater','#a59a88','密集撞击坑与射纹'),
('venus-cloud','金星云顶','Venus clouds','cloud','#e9d6a1','遮蔽地表的浓厚云层'),
('io','木卫一','Io','volcano','#dac465','硫磺平原与暗色火山口'),
('europa','木卫二','Europa','cracks','#e5dcc4','浅色冰壳与红褐裂纹'),
('ganymede','木卫三','Ganymede','grooves','#aaa697','深浅相间的沟槽地形'),
('callisto','木卫四','Callisto','pepper','#665f53','暗色古老地表与亮色撞击坑'),
('titan','土卫六','Titan','haze','#d69943','橙金色有机霾'),
('enceladus','土卫二','Enceladus','tiger','#dbe7ed','明亮冰壳与南极虎纹'),
('triton','海卫一','Triton','plume','#d2bcb9','粉色氮冰与暗色喷流沉积'),
('pluto','冥王星','Pluto','heart','#b88c70','红褐地形与浅色心形冰原'),
('charon','冥卫一','Charon','cap','#a9a6a1','灰色地表与红褐极区'),
('ceres','谷神星','Ceres','salt','#818b96','深灰地表与盐类亮斑'),
('vesta','灶神星','Vesta','basin','#ad9e8d','南部巨大撞击盆地'),
('dione','土卫四','Dione','wisps','#bdc8cf','冰质陡崖的明亮细纹'),
('rhea','土卫五','Rhea','crater','#c1bcad','密集坑群的古老冰面'),
('tethys','土卫三','Tethys','chasm','#d5d6cf','横越表面的巨大峡谷'),
('iapetus','土卫八','Iapetus','dual','#dbd6c7','强烈明暗双面'),
('mimas','土卫一','Mimas','giant','#c2c0bc','显著的赫歇尔撞击坑'),
('oberon','天卫四','Oberon','pepper','#a48d7e','偏红的古老撞击地表'),
('titania','天卫三','Titania','rift','#b1a59c','长距离断层与峡谷'),
('ariel','天卫一','Ariel','grooves','#b2c7ce','明亮地表与交错峡谷'),
('umbriel','天卫二','Umbriel','ring','#6c707b','暗色地表与亮环撞击坑')]
styles=[dict(id=k,name=n,prototype=e,feature=f,tone='#91a9c7',source='https://www.solarsystemscope.com/textures/') for k,n,e,f in base]
N=256
axis=(np.arange(N)+.5-N/2)/(N/2-.75)
x,y=np.meshgrid(axis,-axis);r2=x*x+y*y;z=np.sqrt(np.maximum(0,1-r2));mask=r2<1
lon=np.arctan2(x,z);lat=np.arcsin(np.clip(y,-1,1))
def color(h):return np.array([int(h[i:i+2],16) for i in (1,3,5)])/255
for idx,(key,name,english,kind,tone,feature) in enumerate(extra):
    rng=np.random.default_rng(8400+idx)
    noise=np.zeros_like(x)
    for frequency,amplitude in [(3,.16),(7,.12),(15,.07),(34,.04),(78,.025),(160,.012)]:
        for _ in range(4):
            v=rng.normal(size=3);phase=rng.uniform(0,6.28)
            noise+=np.sin((x*v[0]+y*v[1]+z*v[2])*frequency+phase)*amplitude/4
    albedo=np.clip(color(tone)[None,None,:]*(1+noise[...,None]*1.8),0,1)
    relief=np.ones_like(x)
    def tint(a,c):
        global albedo
        a=np.clip(a,0,1)[...,None];albedo=albedo*(1-a)+color(c)*a
    def crater(cx,cy,size,strong=1):
        global relief
        if cx*cx+cy*cy>=.98:return
        cz=np.sqrt(1-cx*cx-cy*cy)
        d=(np.sqrt((x-cx)**2+(y-cy)**2+(z-cz)**2)+noise*.015)/size
        relief+=strong*(.17*np.exp(-((d-1)/.10)**2)-.20*np.exp(-((d-.72)/.22)**2))
        relief+=strong*.2*(x-cx)/size*np.exp(-((d-.85)/.15)**2)
    if kind not in ('cloud','haze','volcano','heart','tiger','cracks'):
        for _ in range(150 if kind in ('crater','pepper') else 55):
            cx,cy=rng.uniform(-1,1,2);size=rng.uniform(.012,.085)
            crater(cx,cy,size,.65)
            if kind=='pepper':tint(np.exp(-(((x-cx)**2+(y-cy)**2)/(size*.35)**2))*.55,'#e2dac4')
    if kind in ('cracks','tiger','grooves','wisps','rift','chasm'):
        for j in range(12 if kind=='cracks' else 5):
            a=rng.uniform(-1.2,1.2);off=rng.uniform(-.9,.9)
            d=abs(lon*np.cos(a)+lat*np.sin(a)-off+.04*np.sin(lat*12+j)+noise*.3)
            if kind=='tiger':d=abs(lat+.6+ j*.085+.12*np.sin(lon*2.8))
            if kind=='chasm':d=abs(lon*.7+lat*.4+.2+.04*np.sin(lat*6))
            width=.012 if kind=='cracks' else .021
            tint(np.exp(-(d/width)**2)*.68, '#8a5642' if kind=='cracks' else '#536c7d')
            if kind in ('wisps','grooves','rift'):tint(np.exp(-((d-.028)/.012)**2)*.7,'#eff0e2')
    if kind in ('cloud','haze'):
        bands=np.sin(lat*9+np.sin(lon*2)*1.8+noise*13)
        tint((bands*.5+.5)*(.3 if kind=='cloud' else .1),'#f2d995')
        albedo=np.clip(albedo+noise[...,None]*.15,0,1)
    if kind=='volcano':
        tint(np.maximum(noise,0)*3,'#f2e3a3');tint(np.maximum(-noise,0)*3,'#b06027')
        for _ in range(25):
            cx,cy=rng.uniform(-.9,.9,2);d=np.hypot(x-cx,y-cy)+noise*.14;rr=rng.uniform(.02,.09)
            tint(np.exp(-((d-rr)/(rr*.5))**2)*.65,'#a44024');tint(np.exp(-(d/(rr*.55))**2)*.9,'#29241c')
    if kind=='plume':
        tint(np.clip((-lat+.15)*.7,0,.5),'#eee1d8')
        for _ in range(14):
            cx,cy=rng.uniform(-.8,.8,2)
            tint(np.exp(-((x-cx+(y-cy)*.3)/.013)**2-((y-cy)/.14)**2)*.55,'#54484d')
    if kind=='heart':
        hx=(x-.12)*2.6;hy=(y-.03)*2.8
        heart=(hx*hx+hy*hy-1)**3-hx*hx*hy**3+noise*.9
        tint(np.clip(-heart*10,0,.96),'#e8d9be');tint(np.clip(-y-.25,0,.45),'#77452c')
    if kind=='cap':tint(np.clip((lat-.45+noise)*2.7,0,.87),'#734332')
    if kind=='salt':
        for cx,cy,rr in [(-.3,.28,.06),(-.19,.26,.025),(.25,-.2,.018)]:tint(np.exp(-((x-cx)**2+(y-cy)**2)/rr**2)*.96,'#f6eee1')
    if kind=='basin':crater(.1,-.58,.51,1.2)
    if kind=='dual':tint(1/(1+np.exp(-(x+y*.45+noise*2+.15)*18))*.95,'#302b26')
    if kind=='giant':crater(-.28,.25,.38,1.8)
    if kind=='ring':
        d=np.hypot(x+.24,y-.24);tint(np.exp(-((d-.16)/.025)**2)*.9,'#dfdbca')
    albedo=np.clip(albedo*(relief+noise*.35)[...,None],0,1)
    # Same warm upper-left key and soft terminator as the existing portal.
    lightdir=np.array([-.8,.45,.52]);lightdir/=np.linalg.norm(lightdir)
    diffuse=np.maximum(0,x*lightdir[0]+y*lightdir[1]+z*lightdir[2])
    light=.012+.73*diffuse
    rgb=np.clip(albedo**2.2*light[...,None],0,1)**(1/2.2)
    alpha=np.clip((1-np.sqrt(r2))*(N/2-.75),0,1)
    rgba=np.dstack((rgb,alpha));rgba[~mask]=0
    Image.fromarray(np.uint8(np.clip(rgba,0,1)*255)).save(OUT/'surfaces'/f'{key}.png',optimize=True)
    source=('https://science.nasa.gov/jupiter/jupiter-moons/' if key in ('io','europa','ganymede','callisto') else 'https://science.nasa.gov/uranus/moons/' if key in ('ariel','umbriel','titania','oberon') else 'https://science.nasa.gov/saturn/moons/' if key in ('titan','enceladus','dione','rhea','tethys','iapetus','mimas') else 'https://science.nasa.gov/dwarf-planets/pluto/' if key in ('pluto','charon') else 'https://science.nasa.gov/neptune/moons/triton/' if key=='triton' else 'https://science.nasa.gov/solar-system/planets/')
    styles.append(dict(id=key,name=name,prototype=english,feature=feature,tone=tone,source=source))
(OUT/'planet-library.json').write_text(json.dumps(styles,ensure_ascii=False,indent=2)+'\n')
print(f'{len(styles)} styles; PNGs {sum((OUT/"surfaces"/(s["id"]+".png")).stat().st_size for s in styles):,} bytes')

(ROOT/'web/portal/planet-library.js').write_text('/* Generated by scripts/build-planet-library.py */\nwindow.dioPlanetStyles='+json.dumps(styles,ensure_ascii=False,separators=(',',':'))+';\n')
