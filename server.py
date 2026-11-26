"""Orbit Portal — a self-hosted application portal."""
import argparse
import csv
import fcntl
import hashlib
import io
import json
import logging
import math
import os
import re
import secrets
import shutil
import sqlite3
import tempfile
import time
import zipfile
from contextlib import contextmanager, closing
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, request, send_file, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.exceptions import HTTPException
from usage import initialize, record, summarize, summarize_home, CHINA, VISITOR_ID
from galaxies import initialize_galaxies, added_apps, register_galaxies, assign_surfaces, surface_assignments, layouts, SEATS, GROUPS, STYLE_IDS
from players import register_players

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
VERSION = '0.1.0'
SLOTS = ['core', 'git', 'doc', 'week', 'flow', 'gpu', 'bi', 'seek']
ICONS = ['cell','chart','crm','doc','heart','report','layers','git','flow','gate','terminal','bell','chip','color','clock','wave']


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('配置必须是 JSON 对象')
    groups, apps = data.get('groups'), data.get('apps')
    if not isinstance(groups, dict) or not 1 <= len(groups) <= 30:
        raise ValueError('需要 1–30 个分类')
    ident = re.compile(r'[a-z0-9][a-z0-9_-]{0,63}')
    for key, label in groups.items():
        if not ident.fullmatch(key) or key == 'all' or not isinstance(label, str) or not 1 <= len(label.strip()) <= 40:
            raise ValueError('分类标识或名称无效')
    if not isinstance(apps, list) or len(apps) > 300:
        raise ValueError('应用数量不能超过 300')
    ids = set()
    for app in apps:
        if not isinstance(app, dict) or not isinstance(app.get('id'), str) or not ident.fullmatch(app['id']) or app['id'] in ids:
            raise ValueError('应用 ID 必须唯一，使用小写字母、数字、下划线或短横线')
        ids.add(app['id'])
        for field, limit in [('name',80),('url',2048),('aliases',500)]:
            value = app.get(field, '')
            if not isinstance(value, str) or len(value) > limit or (field != 'aliases' and not value.strip()):
                raise ValueError(f'应用 {app["id"]} 的 {field} 无效')
        try:
            url = urlsplit(app['url'])
            if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or any(ord(c)<33 for c in app['url']):
                raise ValueError()
        except ValueError:
            raise ValueError('链接必须是有效的 HTTP/HTTPS 地址，不能包含账号密码')
        if app.get('group') not in groups or app.get('glyph') not in ICONS:
            raise ValueError('应用的分类或图标无效')
        if 'surface' in app and app['surface'] not in STYLE_IDS:
            raise ValueError('星球样式无效')
        for field in ['enabled','test']:
            if not isinstance(app.get(field, True if field == 'enabled' else False), bool):
                raise ValueError('启用和测试标记必须为布尔值')
    slots = data.get('slots', {})
    if not isinstance(slots, dict) or set(slots) != set(SLOTS):
        raise ValueError('需要完整的 8 个轨道位置')
    occupied = [v for v in slots.values() if v]
    if any(not isinstance(v,str) or v not in ids for v in occupied) or len(set(occupied)) != len(occupied):
        raise ValueError('轨道应用必须存在且不能重复')
    if 'galaxies' in data:
        galaxies=data['galaxies']
        if not isinstance(galaxies,dict) or set(galaxies)!=set(GROUPS):
            raise ValueError('需要完整的四个星系')
        for seats in galaxies.values():
            if not isinstance(seats,dict) or set(seats)!=set(SEATS):
                raise ValueError('每个星系需要完整的 10 个位置')
            occupied=[]
            for seat,value in seats.items():
                if value is not None and (not isinstance(value,str)):
                    raise ValueError('星系应用无效')
                if value and value in ids: occupied.append(value)
                else: seats[seat]=None
            if len(occupied)!=len(set(occupied)):
                raise ValueError('同一星系的应用不能重复')
    site = data.get('site', {})
    if not isinstance(site, dict) or not isinstance(site.get('title'),str) or not 1 <= len(site['title'].strip()) <= 60 or not isinstance(site.get('motion'),bool):
        raise ValueError('站点名称或动效设置无效')
    if 'logoText' in site:
        logo_text = site['logoText']
        if not isinstance(logo_text, str) or len(logo_text.strip()) > 60:
            raise ValueError('Logo 文字最多 60 个字符')
        site['logoText'] = logo_text.strip()
    chance = site.get('starfallCriticalChance', 5)
    if type(chance) not in (int, float) or not 0 <= chance <= 100 or not math.isfinite(chance):
        raise ValueError('Starfall 暴击率需要为 0–100 之间的数字')
    site['starfallCriticalChance'] = chance
    density = site.get('starDensity', 40)
    if type(density) is not int or not 10 <= density <= 100:
        raise ValueError('背景星星密度需要为 10–100 之间的整数')
    site['starDensity'] = density
    minimum = site.get('meteorIntervalMin', 10)
    maximum = site.get('meteorIntervalMax', 15)
    if type(minimum) is not int or type(maximum) is not int or not 1 <= minimum <= maximum <= 3600:
        raise ValueError('背景流星间隔需要为 1–3600 秒的整数，且最短间隔不能大于最长间隔')
    site.update(meteorIntervalMin=minimum, meteorIntervalMax=maximum)
    return data


def atomic(path, data):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


@contextmanager
def locked(folder):
    with (folder / '.write.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def create_app(data_dir=None, password=None):
    folder = Path(data_dir or os.environ.get('ORBIT_DATA_DIR', ROOT / 'data'))
    folder.mkdir(parents=True, exist_ok=True)
    catalog_path, database = folder / 'catalog.json', folder / 'usage.sqlite3'
    with locked(folder):
        if not catalog_path.exists():
            initial = json.loads((WEB / 'catalog.json').read_text())
            if os.environ.get('ORBIT_EMPTY_CATALOG') == '1':
                initial.update(apps=[], slots=dict.fromkeys(SLOTS))
                initial.pop('galaxies', None)
            validate(initial)
            atomic(catalog_path, json.dumps(initial, ensure_ascii=False, indent=2).encode())
        if not (folder / 'secret.key').exists(): atomic(folder / 'secret.key', secrets.token_bytes(32))
        if not (folder / 'auth.json').exists():
            pw = password or os.environ.get('ORBIT_ADMIN_PASSWORD') or secrets.token_urlsafe(20)
            atomic(folder / 'auth.json', json.dumps({'hash':generate_password_hash(pw)}).encode())
            if not password and not os.environ.get('ORBIT_ADMIN_PASSWORD'):
                atomic(folder / 'initial-admin-password.txt', (pw+'\n').encode())
                logging.warning('管理员初始密码已写入 %s；登录后请修改密码并删除该文件', folder / 'initial-admin-password.txt')
    initialize(database)
    initialize_galaxies(database)
    with locked(folder), closing(sqlite3.connect(database)) as db, db:
        initial_apps=json.loads(catalog_path.read_bytes())['apps']+added_apps(database)
        assign_surfaces(initial_apps,db)
    app = Flask(__name__, static_folder=None)
    app.json.sort_keys = False
    app.secret_key = (folder / 'secret.key').read_bytes()
    app.config.update(MAX_CONTENT_LENGTH=512*1024, SESSION_COOKIE_HTTPONLY=True,
                      SESSION_COOKIE_SAMESITE='Strict', SESSION_COOKIE_SECURE=os.environ.get('ORBIT_COOKIE_SECURE')=='1',
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=8), DATA_DIR=folder)

    def load():
        raw = catalog_path.read_bytes()
        data=json.loads(raw)
        extra=added_apps(database)
        ids={a['id'] for a in data['apps']}
        data['apps'].extend(a for a in extra if a['id'] not in ids)
        surfaces=surface_assignments(database)
        for item in data['apps']: item['surface']=surfaces.get(item['id'],'core')
        with closing(sqlite3.connect(database)) as db:
            positions=list(db.execute('SELECT galaxy,seat,app FROM galaxy_seats ORDER BY galaxy,seat'))
        revision=raw+json.dumps([extra,positions],sort_keys=True).encode()
        return validate(data), hashlib.sha256(revision).hexdigest()

    def auth_hash(): return json.loads((folder / 'auth.json').read_text())['hash']
    def authenticated(): return session.get('admin') == hashlib.sha256(auth_hash().encode()).hexdigest()
    def csrf():
        session.setdefault('csrf', secrets.token_urlsafe(32))
        return session['csrf']
    current_player=register_players(app,database,csrf,lambda: load()[0]['site']['starfallCriticalChance'],
                     lambda: load()[0]['site']['meteorIntervalMin'])

    register_galaxies(app,database,load,csrf,lambda: locked(folder),current_player)

    def protected(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not authenticated(): return jsonify(error='请先登录'),401
            if request.method != 'GET' and not secrets.compare_digest(request.headers.get('X-CSRF-Token',''), csrf()):
                return jsonify(error='会话校验失败，请刷新页面'),403
            return fn(*args, **kwargs)
        return wrapped
    def body():
        data = request.get_json()
        if not isinstance(data,dict): raise ValueError('请求必须为 JSON 对象')
        return data

    @app.errorhandler(Exception)
    def error(exc):
        if isinstance(exc, HTTPException): return jsonify(error=exc.description),exc.code
        if isinstance(exc,(ValueError, KeyError,TypeError)): return jsonify(error=str(exc)),400
        app.logger.exception('请求失败')
        return jsonify(error='服务暂时不可用，请稍后重试'),503

    @app.after_request
    def headers(response):
        response.headers.update({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
            'X-Frame-Options':'DENY','Cache-Control':'no-store' if request.path.startswith('/api') else 'no-cache',
            'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
        return response

    @app.get('/')
    @app.get('/index.html')
    def home(): return send_file(WEB / 'portal/index.html')
    @app.get('/admin')
    @app.get('/admin/')
    def admin(): return send_file(WEB / 'admin/index.html')
    @app.get('/assets/<path:name>')
    def assets(name): return send_from_directory(WEB / 'portal',name)
    @app.get('/admin-assets/<path:name>')
    def admin_assets(name): return send_from_directory(WEB / 'admin',name)
    @app.get('/api/catalog')
    def catalog():
        data, _ = load()
        data['apps'] = [a for a in data['apps'] if a.get('enabled',True)]
        return jsonify(data)
    @app.get('/healthz')
    def health():
        load()
        with closing(sqlite3.connect(database)) as db, db: db.execute('SELECT 1 FROM totals LIMIT 1')
        return jsonify(status='ok',version=VERSION,revision=os.environ.get('ORBIT_REVISION','development'))
    @app.get('/api/admin/session')
    def state(): return jsonify(authenticated=authenticated(),csrf=csrf(),version=VERSION,icons=ICONS)
    @app.post('/api/admin/login')
    def login():
        if not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),csrf()): return jsonify(error='请刷新页面后重试'),403
        # A global, bounded login bucket is sufficient for this single-admin service.
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS login_attempts (at REAL NOT NULL)')
            db.execute('DELETE FROM login_attempts WHERE at < ?', (time.time()-300,))
            if db.execute('SELECT count(*) FROM login_attempts').fetchone()[0] >= 10:
                return jsonify(error='尝试次数过多，五分钟后再试'),429
            db.execute('INSERT INTO login_attempts VALUES (?)',(time.time(),))
        pw = body().get('password','')
        if not isinstance(pw,str) or len(pw)>256 or not check_password_hash(auth_hash(),pw): return jsonify(error='密码不正确'),401
        session.clear(); session.permanent=True
        session['admin']=hashlib.sha256(auth_hash().encode()).hexdigest()
        return jsonify(csrf=csrf())
    @app.post('/api/admin/logout')
    @protected
    def logout(): session.clear(); return jsonify(ok=True)
    @app.post('/api/admin/password')
    @protected
    def change_password():
        data=body(); pw=data.get('password','')
        if not check_password_hash(auth_hash(),data.get('current','')): return jsonify(error='当前密码不正确'),400
        if not isinstance(pw,str) or not 12<=len(pw)<=256: raise ValueError('新密码需要 12–256 个字符')
        with locked(folder): atomic(folder/'auth.json',json.dumps({'hash':generate_password_hash(pw)}).encode())
        (folder/'initial-admin-password.txt').unlink(missing_ok=True)
        session.clear(); return jsonify(ok=True)
    @app.route('/api/admin/catalog',methods=['GET','PUT'])
    @protected
    def edit_catalog():
        if request.method=='GET':
            data, rev=load()
            with closing(sqlite3.connect(database)) as db: data['galaxies']=layouts(data,db)
            return jsonify(catalog=data,revision=rev)
        payload=body(); data=validate(payload.get('catalog'))
        with locked(folder):
            _, rev=load()
            if payload.get('revision')!=rev: return jsonify(error='配置已被其他页面或文件修改，请刷新后重试'),409
            if 'galaxies' not in data:
                with closing(sqlite3.connect(database)) as db: data['galaxies']=layouts(data,db,assigned=[])
            previous,_=load()
            with closing(sqlite3.connect(database)) as db: previous['galaxies']=layouts(previous,db)
            saved=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode()
            atomic(folder/'catalog.previous.json',json.dumps(previous,ensure_ascii=False,indent=2).encode())
            atomic(catalog_path,saved)
            with closing(sqlite3.connect(database)) as db, db:
                chosen={item['id']:item['surface'] for item in data['apps'] if item.get('surface')}
                assign_surfaces(data['apps'],db)
                for item in data['apps']:
                    item['surface']=chosen.get(item['id'],item['surface'])
                    if item.get('surface'): db.execute('UPDATE app_surfaces SET surface=? WHERE app=?',(item['surface'],item['id']))
                db.execute('DELETE FROM shared_apps')
                if 'galaxies' in data: db.execute('DELETE FROM galaxy_seats')
        return jsonify(ok=True,revision=load()[1])
    @app.get('/api/admin/backup')
    @protected
    def download_backup():
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'orbit-backup.zip'
            backup(folder,path)
            payload=path.read_bytes()
        return send_file(io.BytesIO(payload),mimetype='application/zip',as_attachment=True,download_name='orbit-backup.zip')
    @app.get('/api/admin/previous')
    @protected
    def previous():
        p=folder/'catalog.previous.json'
        if not p.exists(): return jsonify(error='还没有上一版配置'),404
        return jsonify(catalog=validate(json.loads(p.read_text())))
    def usage_data():
        days=int(request.args.get('days','30'))
        if not 1<=days<=366: raise ValueError('时间范围为 1–366 天')
        data=summarize(database,datetime.now(CHINA).date(),days)
        cat,_=load(); names={a['id']:a['name'] for a in cat['apps']}
        # Include all applications in the export and ranking, including disabled ones.
        since=(datetime.now(CHINA).date()-timedelta(days=days-1)).isoformat()
        with closing(sqlite3.connect(database)) as db, db:
            data['ranking']=[{'id':i,'name':names.get(i,i),'count':n} for i,n in db.execute("SELECT app_id,SUM(count) FROM totals WHERE day>=? AND app_id!='' GROUP BY app_id ORDER BY SUM(count) DESC",(since,))]
        return data
    @app.get('/api/usage/summary')
    def public_usage():
        return jsonify(summarize_home(database,datetime.now(CHINA).date()))
    @app.get('/api/admin/usage')
    @protected
    def usage(): return jsonify(usage_data())
    @app.get('/api/admin/usage.csv')
    @protected
    def export():
        data=usage_data(); out=io.StringIO(); writer=csv.writer(out)
        writer.writerow(['type','date / app ID','name','count'])
        for row in data['trend']: writer.writerow(['visit',row['date'],'',row['count']])
        for row in data['ranking']:
            name=row['name']; name="'"+name if name[:1] in '=+-@\t\r' else name
            writer.writerow(['click',row['id'],name,row['count']])
        return send_file(io.BytesIO(('\ufeff'+out.getvalue()).encode()),mimetype='text/csv',as_attachment=True,download_name='orbit-usage.csv')
    @app.post('/api/events')
    def events():
        if authenticated(): return '',204
        event=body(); kind=event.get('kind'); visitor=event.get('visitor',''); app_id=event.get('app','')
        if kind=='visit' and app_id=='':
            if not isinstance(visitor,str) or (visitor and not VISITOR_ID.fullmatch(visitor)): raise ValueError('访客标识无效')
        elif kind=='click':
            cat,_=load()
            if app_id not in {a['id'] for a in cat['apps'] if a.get('enabled',True)}: raise ValueError('应用不存在')
            visitor=''
        else: raise ValueError('事件无效')
        record(database,datetime.now(CHINA).date().isoformat(),app_id,visitor,current_player=current_player)
        return '',204
    return app


def backup(folder, destination):
    with locked(folder), tempfile.TemporaryDirectory() as tmp:
        snap=Path(tmp)/'usage.sqlite3'
        with closing(sqlite3.connect(folder/'usage.sqlite3')) as source, closing(sqlite3.connect(snap)) as target: source.backup(target)
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
            for name in ['catalog.json','auth.json','secret.key']:
                archive.write(folder/name,name)
            archive.write(snap,'usage.sqlite3')
    os.chmod(destination,0o600)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',nargs='?',choices=['serve','backup','restore','reset-password'],default='serve')
    parser.add_argument('--data-dir',type=Path,default=Path(os.environ.get('ORBIT_DATA_DIR',ROOT/'data')))
    parser.add_argument('--file',type=Path)
    parser.add_argument('--host',default='127.0.0.1'); parser.add_argument('--port',type=int,default=8080)
    args=parser.parse_args()
    if args.command=='restore':
        if not args.file: parser.error('restore 需要 --file')
        with zipfile.ZipFile(args.file) as z, tempfile.TemporaryDirectory() as tmp:
            content={name:z.read(name) for name in ['catalog.json','auth.json','secret.key','usage.sqlite3']}
            validate(json.loads(content['catalog.json']))
            if not isinstance(json.loads(content['auth.json']).get('hash'),str) or len(content['secret.key'])<32: raise ValueError('无效的认证备份')
            db_path=Path(tmp)/'usage.sqlite3'; db_path.write_bytes(content['usage.sqlite3'])
            with closing(sqlite3.connect(db_path)) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('统计数据库损坏')
                db.execute('SELECT day,app_id,count FROM totals LIMIT 1'); db.execute('SELECT day,visitor FROM browsers LIMIT 1')
            args.data_dir.mkdir(parents=True,exist_ok=True)
            with locked(args.data_dir):
                for suffix in ['-wal','-shm']: (args.data_dir/('usage.sqlite3'+suffix)).unlink(missing_ok=True)
                for name,data in content.items(): atomic(args.data_dir/name,data)
        print('已恢复。请重新启动服务。'); return
    app=create_app(args.data_dir)
    if args.command=='backup':
        if not args.file: parser.error('backup 需要 --file')
        backup(args.data_dir,args.file); print('备份完成'); return
    if args.command=='reset-password':
        import getpass
        pw=getpass.getpass('新管理员密码（至少 12 位）：')
        if len(pw)<12: parser.error('密码过短')
        with locked(args.data_dir): atomic(args.data_dir/'auth.json',json.dumps({'hash':generate_password_hash(pw)}).encode())
        (args.data_dir/'initial-admin-password.txt').unlink(missing_ok=True)
        print('密码已更新，已有会话失效'); return
    from gunicorn.app.base import BaseApplication
    class Service(BaseApplication):
        def load_config(self):
            for key,value in {'bind':f'{args.host}:{args.port}','workers':1,'threads':4,'accesslog':None,'errorlog':'-','timeout':30}.items(): self.cfg.set(key,value)
        def load(self): return app
    Service().run()

if __name__=='__main__': main()
