"""Name-based, registration-free identities and a casual meteor leaderboard."""
import re
import secrets
import sqlite3
from time import time as now_seconds
import unicodedata
from contextlib import closing
from flask import Blueprint, jsonify, request
from itsdangerous import URLSafeTimedSerializer, BadSignature


def missing_player():
    return jsonify(error='请刷新页面以恢复身份'),401


def resolve_player(db,browser_id):
    if browser_id is None:
        return None
    row=db.execute("""
        SELECT id FROM players WHERE id=COALESCE(
            (SELECT player FROM player_aliases WHERE guest=?),?
        )
    """,(browser_id,browser_id)).fetchone()
    return row[0] if row else None


def merge_guest(db,guest,target):
    duplicate_points=db.execute("""
        SELECT COALESCE(SUM(g.points),0)
        FROM meteor_bursts g JOIN meteor_bursts t ON g.event=t.event
        WHERE g.player=? AND t.player=?
    """,(guest,target)).fetchone()[0]
    balance,last_burst,joined=db.execute('SELECT meteors,last_burst,joined FROM players WHERE id=?',
                                        (guest,)).fetchone()
    db.execute("""
        UPDATE players SET meteors=MAX(0,meteors+?),last_burst=MAX(last_burst,?),
            joined=MIN(joined,?),guest=0 WHERE id=?
    """,(balance-duplicate_points,last_burst,joined,target))
    db.execute("""
        INSERT OR IGNORE INTO meteor_bursts(player,event,count,at,critical,points,source)
        SELECT ?,event,count,at,critical,points,source FROM meteor_bursts WHERE player=?
    """,(target,guest))
    db.execute('DELETE FROM meteor_bursts WHERE player=?',(guest,))
    db.execute('UPDATE planet_creations SET player=? WHERE player=?',(target,guest))
    db.execute('UPDATE galaxy_additions SET player=? WHERE player=?',(target,guest))
    db.execute("""
        INSERT INTO player_usage(player,day,app_id,count)
        SELECT ?,day,app_id,count FROM player_usage WHERE player=?
        ON CONFLICT(player,day,app_id) DO UPDATE SET count=count+excluded.count
    """,(target,guest))
    db.execute('DELETE FROM player_usage WHERE player=?',(guest,))
    # In-flight requests and signed bursts may still refer to the temporary ID.
    db.execute('INSERT INTO player_aliases VALUES(?,?)',(guest,target))
    db.execute('DELETE FROM players WHERE id=?',(guest,))


def register_players(app, database, csrf, critical_chance=lambda: 5, background_interval=lambda: 10):
    with closing(sqlite3.connect(database)) as db, db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                meteors INTEGER NOT NULL DEFAULT 0, joined REAL NOT NULL, last_burst REAL NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS player_aliases (
                guest TEXT PRIMARY KEY, player TEXT NOT NULL
            ) WITHOUT ROWID;
            CREATE TABLE IF NOT EXISTS meteor_bursts (
                player TEXT NOT NULL, event TEXT NOT NULL, count INTEGER NOT NULL, at REAL NOT NULL,
                critical INTEGER NOT NULL DEFAULT 0, points INTEGER,
                PRIMARY KEY(player,event)
            ) WITHOUT ROWID;
        ''')
        db.execute('BEGIN IMMEDIATE')
        if 'guest' not in {row[1] for row in db.execute('PRAGMA table_info(players)')}:
            # Old rows have no reliable marker for a user-selected name.
            db.execute('ALTER TABLE players ADD COLUMN guest INTEGER NOT NULL DEFAULT 0')
        # Preserve the historic one-point-per-star scores when upgrading an existing database.
        columns={row[1] for row in db.execute('PRAGMA table_info(meteor_bursts)')}
        if 'critical' not in columns:
            db.execute('ALTER TABLE meteor_bursts ADD COLUMN critical INTEGER NOT NULL DEFAULT 0')
        if 'points' not in columns:
            db.execute('ALTER TABLE meteor_bursts ADD COLUMN points INTEGER')
        if 'source' not in columns:
            db.execute("ALTER TABLE meteor_bursts ADD COLUMN source TEXT NOT NULL DEFAULT 'hover'")
        db.execute('UPDATE meteor_bursts SET points=count WHERE points IS NULL')
        db.execute('CREATE INDEX IF NOT EXISTS meteor_source_time ON meteor_bursts(player,source,at)')
    api=Blueprint('players',__name__)
    signer=URLSafeTimedSerializer(app.secret_key,salt='orbit-browser-player-v1')
    burst_signer=URLSafeTimedSerializer(app.secret_key,salt='orbit-starfall-burst-v1')

    player_cookie='orbit_player'
    previous_cookie='dio_player'
    # Accept existing browser identities and signed events during the rename.
    previous_signer=URLSafeTimedSerializer(app.secret_key,salt='dio-browser-player-v1')
    previous_burst_signer=URLSafeTimedSerializer(app.secret_key,salt='dio-starfall-burst-v1')
    cookie_lifetime=365*86400

    def browser_player():
        cookie=request.cookies.get(player_cookie)
        reader=signer
        if cookie is None:
            cookie=request.cookies.get(previous_cookie,'')
            reader=previous_signer
        try:
            pid=reader.loads(cookie,max_age=cookie_lifetime)
        except BadSignature:
            return None
        return pid if isinstance(pid,str) else None

    def current(db):
        return resolve_player(db,browser_player())

    def player_response(pid,result,**fields):
        response=jsonify(**result,**fields)
        secure=app.config['SESSION_COOKIE_SECURE']
        response.set_cookie(player_cookie,signer.dumps(pid),max_age=cookie_lifetime,
                            httponly=True,secure=secure,samesite='Strict')
        if previous_cookie in request.cookies:
            response.delete_cookie(previous_cookie,httponly=True,secure=secure,samesite='Strict')
        return response

    def profile(db,pid):
        name,count=db.execute('SELECT name,meteors FROM players WHERE id=?',(pid,)).fetchone()
        rank=1+db.execute('SELECT COUNT(*) FROM players WHERE meteors>?',(count,)).fetchone()[0] if count else None
        distance=db.execute("SELECT COUNT(*) FROM meteor_bursts WHERE player=? AND source='warp'",(pid,)).fetchone()[0]
        warp_rank=1+db.execute("SELECT COUNT(*) FROM (SELECT b.player FROM meteor_bursts b JOIN players p ON p.id=b.player WHERE b.source='warp' GROUP BY b.player HAVING COUNT(*)>?)",(distance,)).fetchone()[0] if distance else None
        planets=db.execute('SELECT COUNT(*) FROM planet_creations WHERE player=?',(pid,)).fetchone()[0]
        planet_rank=1+db.execute('SELECT COUNT(*) FROM (SELECT player FROM planet_creations GROUP BY player HAVING COUNT(*)>?)',(planets,)).fetchone()[0] if planets else None
        return {'name':name,'meteors':count,'rank':rank,'warpDistance':distance,'warpRank':warp_rank,'planetCount':planets,'planetRank':planet_rank}

    def authorized():
        pid=browser_player()
        if not pid: return None,(jsonify(error='请刷新页面以恢复身份'),401)
        if not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),csrf()):
            return None,(jsonify(error='身份会话已更新，请重试'),403)
        return pid,None

    @api.get('/api/player')
    def get_player():
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('BEGIN')
            pid=current(db)
            if pid:
                result=profile(db,pid)
                if player_cookie not in request.cookies:
                    return player_response(pid,result,csrf=csrf())
                return jsonify(**result,csrf=csrf())

        with closing(sqlite3.connect(database)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            pid=secrets.token_hex(16)
            while True:
                name=''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8))
                created=db.execute('INSERT INTO players(id,name,joined,guest) VALUES(?,?,?,1) ON CONFLICT(name) DO NOTHING',
                                   (pid,name,now_seconds()))
                if created.rowcount: break
            result=profile(db,pid)
        return player_response(pid,result,csrf=csrf())

    @api.patch('/api/player')
    def rename():
        pid,error=authorized()
        if error: return error
        data=request.get_json()
        name=data.get('name') if isinstance(data,dict) else None
        if not isinstance(name,str): return jsonify(error='请输入昵称'),400
        name=unicodedata.normalize('NFKC',name).strip()
        if not 2<=len(name)<=24 or not all(c.isalnum() or c in ' _-' for c in name):
            return jsonify(error='昵称为 2–24 个字，可用中英文、数字、空格、下划线或短横线'),400
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            pid=resolve_player(db,pid)
            if not pid: return missing_player()
            guest=db.execute('SELECT guest FROM players WHERE id=?',(pid,)).fetchone()[0]
            existing=db.execute('SELECT id FROM players WHERE name=?',(name,)).fetchone()
            if guest:
                if existing and existing[0]!=pid:
                    target=existing[0]
                    merge_guest(db,pid,target)
                    pid=target
                else:
                    db.execute('UPDATE players SET name=?,guest=0 WHERE id=?',(name,pid))
            elif existing:
                pid=existing[0]
                db.execute('UPDATE players SET guest=0 WHERE id=? AND guest=1',(pid,))
            else:
                pid=secrets.token_hex(16)
                db.execute('INSERT INTO players(id,name,joined) VALUES(?,?,?)',(pid,name,now_seconds()))
            result=profile(db,pid)
        return player_response(pid,result,retainedProgress=bool(guest))

    @api.post('/api/player/meteors/prepare')
    def prepare_meteors():
        pid,error=authorized()
        if error: return error
        data=request.get_json()
        count=data.get('count') if isinstance(data,dict) else None
        if type(count) is not int or not 2<=count<=5:
            return jsonify(error='流星事件无效'),400
        with closing(sqlite3.connect(database)) as db:
            pid=resolve_player(db,pid)
        if not pid: return missing_player()
        critical=secrets.randbelow(1_000_000)<critical_chance()*10_000
        event=secrets.token_hex(16)
        token=burst_signer.dumps({'player':pid,'count':count,'event':event,'critical':critical})
        return jsonify(count=count,event=event,critical=critical,points=count*(20 if critical else 1),token=token)

    @api.post('/api/player/meteors')
    def meteors():
        pid,error=authorized()
        if error: return error
        data=request.get_json()
        count=data.get('count') if isinstance(data,dict) else None
        event=data.get('event') if isinstance(data,dict) else None
        if type(count) is not int or not 2<=count<=5 or not isinstance(event,str) or not re.fullmatch('[a-f0-9]{32}',event):
            return jsonify(error='流星事件无效'),400
        critical=False
        claim=None
        if 'token' in data:
            token=data['token']
            if not isinstance(token,str) or len(token)>2048:
                return jsonify(error='星链凭证无效，请重新蓄光'),400
            for token_signer in (burst_signer,previous_burst_signer):
                try:
                    claim=token_signer.loads(token,max_age=86400)
                except BadSignature:
                    continue
                break
            else:
                return jsonify(error='星链凭证已失效，请重新蓄光'),400
            if (not isinstance(claim,dict) or not isinstance(claim.get('player'),str) or
                claim.get('count')!=count or claim.get('event')!=event or type(claim.get('critical')) is not bool):
                return jsonify(error='星链凭证无效，请重新蓄光'),400
            critical=claim['critical']
        points=count*(20 if critical else 1)
        if (('critical' in data and (type(data['critical']) is not bool or data['critical']!=critical)) or
            ('points' in data and (type(data['points']) is not int or data['points']!=points))):
            return jsonify(error='星链分数与凭证不一致'),400
        now=now_seconds()
        with closing(sqlite3.connect(database,timeout=5)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            pid=resolve_player(db,pid)
            if not pid: return missing_player()
            if claim and resolve_player(db,claim['player'])!=pid:
                return jsonify(error='星链凭证无效，请重新蓄光'),400
            previous=db.execute('SELECT count,critical,points,source FROM meteor_bursts WHERE player=? AND event=?',(pid,event)).fetchone()
            if previous:
                old_count,old_critical,old_points,source=previous
                if source!='hover': return jsonify(error='流星事件类型不一致'),400
                return jsonify(**profile(db,pid),burst={'event':event,'count':old_count,'critical':bool(old_critical),'points':old_points,'duplicate':True})
            if now-db.execute('SELECT last_burst FROM players WHERE id=?',(pid,)).fetchone()[0]<3:
                return jsonify(error='星链正在冷却'),429
            db.execute('INSERT INTO meteor_bursts(player,event,count,at,critical,points) VALUES(?,?,?,?,?,?)',(pid,event,count,now,int(critical),points))
            db.execute('UPDATE players SET meteors=meteors+?,last_burst=? WHERE id=?',(points,now,pid))
            result=profile(db,pid)
        return jsonify(**result,burst={'event':event,'count':count,'critical':critical,'points':points,'duplicate':False})

    @api.post('/api/player/meteors/background')
    def background_meteor():
        pid,error=authorized()
        if error: return error
        data=request.get_json()
        event=data.get('event') if isinstance(data,dict) else None
        count=data.get('count') if isinstance(data,dict) else None
        if (type(count) is not int or count != 1 or not isinstance(event,str) or
            not re.fullmatch('[a-f0-9]{32}',event) or 'token' in data or
            data.get('critical',False) is not False or type(data.get('points',1)) is not int or data.get('points',1)!=1):
            return jsonify(error='背景流星事件无效'),400
        now=now_seconds()
        with closing(sqlite3.connect(database,timeout=5)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            pid=resolve_player(db,pid)
            if not pid: return missing_player()
            previous=db.execute('SELECT source FROM meteor_bursts WHERE player=? AND event=?',(pid,event)).fetchone()
            if previous and previous[0]!='background':
                return jsonify(error='流星事件类型不一致'),400
            if not previous:
                # At most two meteors per interval across tabs; allow a little frame/network jitter.
                cutoff=now-max(.5,background_interval()-.5)
                recent=db.execute("SELECT COUNT(*) FROM meteor_bursts WHERE player=? AND source='background' AND at>?",(pid,cutoff)).fetchone()[0]
                if recent>=2: return jsonify(error='请等待下一批背景流星'),429
                db.execute("INSERT INTO meteor_bursts(player,event,count,at,critical,points,source) VALUES(?,?,1,?,0,1,'background')",(pid,event,now))
                db.execute('UPDATE players SET meteors=meteors+1 WHERE id=?',(pid,))
            result=profile(db,pid)
        return jsonify(**result,burst={'event':event,'count':1,'critical':False,'points':1,'duplicate':bool(previous)})

    @api.post('/api/player/warp')
    def warp():
        pid,error=authorized()
        if error: return error
        data=request.get_json(silent=True)
        event=data.get('event') if isinstance(data,dict) else None
        if (not isinstance(data,dict) or set(data)!={'event'} or not isinstance(event,str) or
            not re.fullmatch('[a-f0-9]{32}',event)):
            return jsonify(error='穿梭事件无效'),400
        cost=2
        with closing(sqlite3.connect(database,timeout=5)) as db, db:
            db.execute('BEGIN IMMEDIATE')
            pid=resolve_player(db,pid)
            if not pid: return missing_player()
            previous=db.execute('SELECT source FROM meteor_bursts WHERE player=? AND event=?',(pid,event)).fetchone()
            if previous:
                if previous[0]!='warp': return jsonify(error='流星事件类型不一致'),400
                return jsonify(**profile(db,pid),warp={'event':event,'cost':cost,'duplicate':True})
            debit=db.execute('UPDATE players SET meteors=meteors-? WHERE id=? AND meteors>=?',(cost,pid,cost))
            if debit.rowcount!=1:
                return jsonify(**profile(db,pid),code='insufficient_points',cost=cost,error='积分不足，穿梭需要 2 分'),409
            db.execute("INSERT INTO meteor_bursts(player,event,count,at,critical,points,source) VALUES(?,?,0,?,0,?,'warp')",(pid,event,now_seconds(),-cost))
            result=profile(db,pid)
        return jsonify(**result,warp={'event':event,'cost':cost,'duplicate':False})

    @api.get('/api/leaderboard')
    def leaderboard():
        with closing(sqlite3.connect(database)) as db:
            db.execute('BEGIN')
            pid=current(db)
            rows=db.execute('SELECT name,meteors,RANK() OVER (ORDER BY meteors DESC) FROM players WHERE meteors>0 ORDER BY meteors DESC,joined,id LIMIT 20').fetchall()
            warp_rows=db.execute("SELECT p.name,COUNT(*) AS distance,RANK() OVER (ORDER BY COUNT(*) DESC) FROM players p JOIN meteor_bursts b ON b.player=p.id WHERE b.source='warp' GROUP BY p.id ORDER BY distance DESC,p.joined,p.id LIMIT 20").fetchall()
            planet_rows=db.execute("SELECT p.name,COUNT(*) AS planets,RANK() OVER (ORDER BY COUNT(*) DESC) FROM players p JOIN planet_creations c ON c.player=p.id GROUP BY p.id ORDER BY planets DESC,p.joined,p.id LIMIT 20").fetchall()
            mine=profile(db,pid) if pid else None
        return jsonify(players=[{'name':name,'meteors':count,'rank':rank} for name,count,rank in rows],
                       warpPlayers=[{'name':name,'warpDistance':distance,'rank':rank} for name,distance,rank in warp_rows],planetPlayers=[{'name':name,'planetCount':planets,'rank':rank} for name,planets,rank in planet_rows],me=mine)

    app.register_blueprint(api)
    return current
