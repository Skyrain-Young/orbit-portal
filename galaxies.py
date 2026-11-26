"""Shared galaxy seats and player-owned application creation."""
import hashlib
import json
import re
import secrets
import sqlite3
from contextlib import closing
from pathlib import Path
from time import time
from urllib.parse import urlsplit, urlunsplit
from flask import jsonify, request

SEATS = ['core','git','doc','week','flow','gpu','bi','seek','extra1','extra2']
STYLE_IDS = [p['id'] for p in json.loads((Path(__file__).parent/'web/portal/textures/planet-library.json').read_text())]
GROUPS = {'main': None, 'business': 'business', 'dev': 'dev', 'other': 'external'}


def initialize_galaxies(database):
    with closing(sqlite3.connect(database)) as db, db:
        db.executescript('''
          CREATE TABLE IF NOT EXISTS planet_creations(app TEXT PRIMARY KEY, player TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS planet_creations_player ON planet_creations(player);
          CREATE TABLE IF NOT EXISTS app_surfaces(app TEXT PRIMARY KEY, surface TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS shared_apps(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS galaxy_seats(galaxy TEXT NOT NULL, seat TEXT NOT NULL, app TEXT NOT NULL, PRIMARY KEY(galaxy,seat));
          CREATE TABLE IF NOT EXISTS galaxy_additions(event TEXT PRIMARY KEY, player TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        ''')
        # Successful paid creation receipts also recover historical counts.
        db.execute("""INSERT OR IGNORE INTO planet_creations(app,player)
                      SELECT json_extract(result,'$.app.id'),player FROM galaxy_additions
                      WHERE json_extract(result,'$.cost')=100 AND json_extract(result,'$.app.id') IS NOT NULL""")


def assign_surfaces(apps, db):
    assigned=dict(db.execute('SELECT app,surface FROM app_surfaces'))
    counts={style:sum(v==style for v in assigned.values()) for style in STYLE_IDS}
    # Assign configured appearances first so automatic choices can avoid them.
    ordered=sorted(apps,key=lambda a:(not a.get('surface'),a['id']))
    for item in ordered:
        key=item['id']
        if key not in assigned:
            preferred=item.get('surface')
            style=preferred if isinstance(preferred,str) and preferred in counts else min(STYLE_IDS,key=lambda s:counts[s])
            db.execute('INSERT INTO app_surfaces VALUES(?,?)',(key,style))
            assigned[key]=style;counts[style]+=1
        item['surface']=assigned[key]


def surface_assignments(database):
    with closing(sqlite3.connect(database)) as db:
        return dict(db.execute('SELECT app,surface FROM app_surfaces'))


def added_apps(database):
    with closing(sqlite3.connect(database)) as db:
        return [json.loads(row[0]) for row in db.execute('SELECT payload FROM shared_apps ORDER BY id')]


def layouts(catalog, db, assigned=None):
    enabled={a['id']:a for a in catalog['apps'] if a.get('enabled',True)}
    result={}
    if assigned is None: assigned=list(db.execute('SELECT galaxy,seat,app FROM galaxy_seats'))
    for galaxy,group in GROUPS.items():
        placed={app for g,seat,app in assigned if g==galaxy}
        values=catalog.get('galaxies',{}).get(galaxy)
        if values is None:
            values=catalog['slots'] if galaxy=='main' else dict(zip(SEATS[:8],[a['id'] for a in enabled.values() if a['group']==group and a['id'] not in placed][:8]))
        result[galaxy]={seat:values.get(seat) if values.get(seat) in enabled else None for seat in SEATS}
    for galaxy,seat,app in assigned:
        if galaxy in result and seat in SEATS:
            result[galaxy][seat]=app if app in enabled else None
    return result


def normalized_url(value):
    if not isinstance(value,str) or len(value)>2048: raise ValueError('请输入有效链接')
    value=value.strip()
    if any(ord(c)<33 for c in value): raise ValueError('链接不能包含空格或控制字符')
    url=urlsplit(value)
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password: raise ValueError('请输入 HTTP 或 HTTPS 链接')
    return urlunsplit((url.scheme,url.netloc.lower(),url.path.rstrip('/') or '/',url.query,url.fragment))


def register_galaxies(app,database,load,csrf,locked,current_player):

    @app.get('/api/galaxies')
    def get_galaxies():
        catalog,_=load()
        with closing(sqlite3.connect(database)) as db:
            return jsonify(layouts=layouts(catalog,db))

    @app.post('/api/galaxies/applications')
    def add_application():
        with closing(sqlite3.connect(database)) as db:
            if not current_player(db): return jsonify(error='请刷新页面以恢复身份'),401
        if not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),csrf()): return jsonify(error='请刷新页面后重试'),403
        data=request.get_json()
        if not isinstance(data,dict): return jsonify(error='请求无效'),400
        galaxy,seat,event=data.get('galaxy'),data.get('seat'),data.get('event')
        if not isinstance(galaxy,str) or galaxy not in GROUPS or not isinstance(seat,str) or seat not in SEATS or not isinstance(event,str) or not re.fullmatch('[a-f0-9]{32}',event): return jsonify(error='位置无效'),400
        fingerprint=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
        with locked(),closing(sqlite3.connect(database,timeout=5)) as db,db:
            db.execute('BEGIN IMMEDIATE')
            pid=current_player(db)
            if not pid: return jsonify(error='请刷新页面以恢复身份'),401
            prior=db.execute('SELECT player,fingerprint,result FROM galaxy_additions WHERE event=?',(event,)).fetchone()
            if prior:
                if prior[:2]!=(pid,fingerprint): return jsonify(error='请求标识已使用'),409
                return jsonify(json.loads(prior[2]))
            catalog,_=load()
            positions=layouts(catalog,db)
            previous=positions[galaxy][seat]
            expected=data.get('replaceAppId')
            if expected is not None:
                if not isinstance(expected,str) or not expected or previous!=expected:
                    return jsonify(error='这个位置已被其他人更新，请刷新页面后重试'),409
            elif previous:
                return jsonify(error='这个位置已被占用，请选择另一个虚位'),409
            app_id=data.get('appId')
            cost=0
            if app_id:
                item=next((a for a in catalog['apps'] if a['id']==app_id and a.get('enabled',True)),None)
                if not item: return jsonify(error='应用不存在'),400
            else:
                try: url=normalized_url(data.get('url'))
                except ValueError as error: return jsonify(error=str(error)),400
                if any(normalized_url(a['url'])==url for a in catalog['apps']): return jsonify(error='链接已存在，请从已有应用中选择'),409
                name=data.get('name','')
                group=data.get('group')
                if not isinstance(name,str) or not 1<=len(name.strip())<=80 or not isinstance(group,str) or group not in catalog['groups']: return jsonify(error='请填写应用名称和分类'),400
                if len(catalog['apps'])>=300: return jsonify(error='应用数量已达上限'),400
                cost=100
                if db.execute('UPDATE players SET meteors=meteors-100 WHERE id=? AND meteors>=100',(pid,)).rowcount!=1: return jsonify(error='积分不足，创建新应用需要 100 Starfall'),409
                app_id='app-'+secrets.token_hex(8)
                item={'id':app_id,'name':name.strip(),'url':url,'group':group,'glyph':'layers','palette':'blue','aliases':'','enabled':True,'test':False}
                db.execute('INSERT INTO shared_apps VALUES(?,?)',(app_id,json.dumps(item,ensure_ascii=False)))
            if app_id in positions[galaxy].values(): return jsonify(error='应用已在这个星系中'),409
            # Freeze this shared layout before changing one seat. Theme defaults
            # must not reflow the other planets when their membership changes.
            db.executemany('INSERT OR IGNORE INTO galaxy_seats VALUES(?,?,?)',
                           [(galaxy,key,value or '') for key,value in positions[galaxy].items()])
            db.execute('INSERT INTO galaxy_seats VALUES(?,?,?) ON CONFLICT(galaxy,seat) DO UPDATE SET app=excluded.app',(galaxy,seat,app_id))
            if cost: db.execute('INSERT INTO planet_creations VALUES(?,?)',(app_id,pid))
            assign_surfaces([item],db)
            balance=db.execute('SELECT meteors FROM players WHERE id=?',(pid,)).fetchone()[0]
            result={'app':item,'galaxy':galaxy,'seat':seat,'cost':cost,'balance':balance}
            db.execute('INSERT INTO galaxy_additions VALUES(?,?,?,?)',(event,pid,fingerprint,json.dumps(result,ensure_ascii=False)))
            return jsonify(result)
