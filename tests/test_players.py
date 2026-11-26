import tempfile
import json
import sqlite3
import time
import unittest
import subprocess
import sys
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from pathlib import Path
from unittest.mock import patch
from itsdangerous import URLSafeTimedSerializer
from server import create_app, backup

class PlayersTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.app=create_app(Path(self.tmp.name),password='test-password-long');self.c=self.app.test_client()
        self.profile=self.c.get('/api/player').json;self.headers={'X-CSRF-Token':self.profile['csrf']}
    def tearDown(self):self.tmp.cleanup()
    def set_chance(self,chance):
        path=Path(self.tmp.name)/'catalog.json'
        catalog=json.loads(path.read_text());catalog['site']['starfallCriticalChance']=chance
        path.write_text(json.dumps(catalog))
    def prepare(self,count=3):
        response=self.c.post('/api/player/meteors/prepare',json={'count':count},headers=self.headers)
        self.assertEqual(response.status_code,200)
        return response.json
    def test_stable_identity_and_name(self):
        self.assertRegex(self.profile['name'],r'^[A-Z2-9]{8}$')
        self.assertEqual((self.profile['warpDistance'],self.profile['warpRank']),(0,None))
        self.assertEqual(self.c.get('/api/player').json['name'],self.profile['name'])
        self.assertEqual(self.c.patch('/api/player',json={'name':'星际旅人7'},headers=self.headers).status_code,200)
        self.assertEqual(self.c.get('/api/player').json['name'],'星际旅人7')
        other=self.app.test_client();token=other.get('/api/player').json['csrf']
        self.assertEqual(other.patch('/api/player',json={'name':' 星际旅人７ '},headers={'X-CSRF-Token':token}).status_code,200)
        self.assertEqual(other.get('/api/player').json['name'],'星际旅人7')
        self.assertEqual(self.c.patch('/api/player',json={'name':'<script>'},headers=self.headers).status_code,400)
    def test_devices_share_balance_history_and_launches_after_name_selection(self):
        other=self.app.test_client()
        headers={'X-CSRF-Token':other.get('/api/player').json['csrf']}
        self.c.patch('/api/player',json={'name':'Navigator'},headers=self.headers)
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':4},headers=self.headers)
        other.post('/api/player/meteors',json={'event':'b'*32,'count':3},headers=headers)
        other.post('/api/player/warp',json={'event':'c'*32},headers=headers)
        other.post('/api/events',json={'kind':'visit','visitor':'b'*32})
        selected=other.patch('/api/player',json={'name':'navigator'},headers=headers)
        self.assertEqual(selected.status_code,200)
        self.assertEqual((selected.json['name'],selected.json['meteors'],selected.json['warpDistance']),
                         ('Navigator',5,1))
        other.post('/api/events',json={'kind':'click','app':'youtube'})
        self.c.post('/api/events',json={'kind':'click','app':'youtube'})
        with closing(sqlite3.connect(Path(self.tmp.name)/'usage.sqlite3')) as db:
            self.assertEqual(db.execute("""
                SELECT app_id,count FROM player_usage JOIN players ON players.id=player
                WHERE name='Navigator' ORDER BY app_id
            """).fetchall(),[('',1),('youtube',2)])

        self.assertEqual(other.patch('/api/player',json={'name':'Different'},headers=headers).json['meteors'],0)
        self.assertEqual(self.c.get('/api/player').json['meteors'],5)
        self.assertEqual(other.patch('/api/player',json={'name':'Navigator'},headers=headers).json['meteors'],5)
        self.assertEqual(other.get('/api/player').json['warpDistance'],1)

    def test_existing_named_account_survives_schema_upgrade(self):
        folder=Path(self.tmp.name)
        with closing(sqlite3.connect(folder/'usage.sqlite3')) as db, db:
            db.execute("UPDATE players SET name='Original', meteors=20")
            db.execute('ALTER TABLE players DROP COLUMN guest')
        upgraded=create_app(folder)
        other=upgraded.test_client()
        token=other.get('/api/player').json['csrf']
        recovered=other.patch('/api/player',json={'name':'Original'},headers={'X-CSRF-Token':token})
        self.assertEqual((recovered.status_code,recovered.json['name'],recovered.json['meteors']),
                         (200,'Original',20))

    def test_dedupe_cooldown_ranking_and_rename(self):
        event={'event':'a'*32,'count':4}
        self.assertEqual(self.c.post('/api/player/meteors',json=event,headers=self.headers).json['meteors'],4)
        self.assertEqual(self.c.post('/api/player/meteors',json=event,headers=self.headers).json['meteors'],4)
        self.assertEqual(self.c.post('/api/player/meteors',json={'event':'b'*32,'count':2},headers=self.headers).status_code,429)
        with patch('players.now_seconds',return_value=time.time()+4):
            self.assertEqual(self.c.post('/api/player/meteors',json={'event':'b'*32,'count':2},headers=self.headers).json['meteors'],6)
        self.c.patch('/api/player',json={'name':'MeteorCaptain'},headers=self.headers)
        board=self.c.get('/api/leaderboard').json
        self.assertEqual(board['players'][0],{'name':'MeteorCaptain','meteors':6,'rank':1})
        self.assertNotIn('csrf',board['players'][0]);self.assertNotIn('id',board['players'][0])
    def test_player_identity_survives_backup_restore(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':3},headers=self.headers)
        folder=Path(self.tmp.name);archive=folder/'players.zip';backup(folder,archive)
        restored=folder/'restored'
        subprocess.run([sys.executable,'server.py','restore','--data-dir',str(restored),'--file',str(archive)],check=True,capture_output=True)
        client=create_app(restored).test_client()
        client.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=client.get('/api/player').json
        self.assertEqual(profile['name'],self.profile['name'])
        self.assertEqual(profile['meteors'],3)

    def test_identity_csrf_and_count_guards(self):
        event={'event':'a'*32,'count':4}
        self.assertEqual(self.app.test_client().post('/api/player/meteors',json=event).status_code,401)
        self.assertEqual(self.c.post('/api/player/meteors',json=event).status_code,403)
        for count in [0,1,6,True,'3']:
            self.assertEqual(self.c.post('/api/player/meteors',json={'event':'a'*32,'count':count},headers=self.headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)
        self.assertEqual(self.c.get('/api/leaderboard').json['players'],[])

    def test_background_one_point_deduplication_and_independent_hover_cooldown(self):
        self.set_chance(100)
        burst=self.prepare(3)
        self.assertEqual(self.c.post('/api/player/meteors',json=burst,headers=self.headers).json['meteors'],60)
        event={'event':'a'*32,'count':1}
        endpoint='/api/player/meteors/background'
        result=self.c.post(endpoint,json=event,headers=self.headers)
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json['meteors'],61)
        self.assertEqual(result.json['burst'],{**event,'critical':False,'points':1,'duplicate':False})
        duplicate=self.c.post(endpoint,json=event,headers=self.headers).json
        self.assertEqual((duplicate['meteors'],duplicate['burst']['duplicate']),(61,True))
        self.assertEqual(self.c.post(endpoint,json={**event,'event':'b'*32},headers=self.headers).json['meteors'],62)
        self.assertEqual(self.c.get('/api/leaderboard').json['players'][0]['meteors'],62)
        with sqlite3.connect(Path(self.tmp.name)/'usage.sqlite3') as db:
            self.assertEqual(db.execute("SELECT count,points,critical,source FROM meteor_bursts WHERE event=?",('a'*32,)).fetchone(),(1,1,0,'background'))

    def test_background_interval_limit_live_configuration_and_hover_independence(self):
        endpoint='/api/player/meteors/background'
        with patch('players.now_seconds',return_value=100):
            for key in ['a','b']:
                self.assertEqual(self.c.post(endpoint,json={'event':key*32,'count':1},headers=self.headers).status_code,200)
            self.assertEqual(self.c.post(endpoint,json={'event':'c'*32,'count':1},headers=self.headers).status_code,429)
            self.assertEqual(self.c.post('/api/player/meteors',json={'event':'d'*32,'count':2},headers=self.headers).json['meteors'],4)
        path=Path(self.tmp.name)/'catalog.json';catalog=json.loads(path.read_text())
        catalog['site'].update(meteorIntervalMin=20,meteorIntervalMax=25);path.write_text(json.dumps(catalog))
        with patch('players.now_seconds',return_value=110):
            self.assertEqual(self.c.post(endpoint,json={'event':'c'*32,'count':1},headers=self.headers).status_code,429)
        with patch('players.now_seconds',return_value=120):
            self.assertEqual(self.c.post(endpoint,json={'event':'c'*32,'count':1},headers=self.headers).json['meteors'],5)

    def test_background_guards_and_cross_source_replay(self):
        endpoint='/api/player/meteors/background';event={'event':'a'*32,'count':1}
        self.assertEqual(self.app.test_client().post(endpoint,json=event).status_code,401)
        self.assertEqual(self.c.post(endpoint,json=event).status_code,403)
        for altered in [None,[],{}, {**event,'count':True},{**event,'count':2},{**event,'count':1.0},{**event,'event':'bad'},
                        {**event,'critical':True},{**event,'points':20},{**event,'points':True},{**event,'token':'bad'}]:
            self.assertEqual(self.c.post(endpoint,data=json.dumps(altered),content_type='application/json',headers=self.headers).status_code,400)
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':2},headers=self.headers)
        self.assertEqual(self.c.post(endpoint,json=event,headers=self.headers).status_code,400)
        self.c.post(endpoint,json={**event,'event':'b'*32},headers=self.headers)
        self.assertEqual(self.c.post('/api/player/meteors',json={'event':'b'*32,'count':2},headers=self.headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],3)

    def test_background_score_survives_backup_restore(self):
        event={'event':'a'*32,'count':1};endpoint='/api/player/meteors/background'
        self.c.post(endpoint,json=event,headers=self.headers)
        folder=Path(self.tmp.name);archive=folder/'background.zip';backup(folder,archive)
        restored=folder/'restored'
        subprocess.run([sys.executable,'server.py','restore','--data-dir',str(restored),'--file',str(archive)],check=True,capture_output=True)
        client=create_app(restored).test_client();client.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=client.get('/api/player').json
        self.assertEqual(profile['meteors'],1)
        replay=client.post(endpoint,json=event,headers={'X-CSRF-Token':profile['csrf']}).json
        self.assertEqual((replay['meteors'],replay['burst']['duplicate']),(1,True))

    def test_warp_fixed_cost_deduplication_and_leaderboard(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':5},headers=self.headers)
        event={'event':'b'*32};endpoint='/api/player/warp'
        first=self.c.post(endpoint,json=event,headers=self.headers)
        self.assertEqual(first.status_code,200)
        self.assertEqual(first.json['meteors'],3)
        self.assertEqual((first.json['warpDistance'],first.json['warpRank']),(1,1))
        self.assertEqual(first.json['warp'],{**event,'cost':2,'duplicate':False})
        duplicate=self.c.post(endpoint,json=event,headers=self.headers)
        self.assertEqual(duplicate.status_code,200)
        self.assertEqual((duplicate.json['meteors'],duplicate.json['warp']['duplicate']),(3,True))
        self.assertEqual(duplicate.json['warpDistance'],1)
        self.assertEqual(self.c.get('/api/leaderboard').json['players'][0]['meteors'],3)
        with sqlite3.connect(Path(self.tmp.name)/'usage.sqlite3') as db:
            self.assertEqual(db.execute("SELECT count,points,critical,source FROM meteor_bursts WHERE event=?",('b'*32,)).fetchone(),(0,-2,0,'warp'))

    def test_warp_insufficient_points_do_not_debit_or_reserve_an_event(self):
        endpoint='/api/player/warp';event={'event':'b'*32}
        for expected in [0,1]:
            response=self.c.post(endpoint,json=event,headers=self.headers)
            self.assertEqual(response.status_code,409)
            self.assertEqual((response.json['meteors'],response.json['code'],response.json['cost']),(expected,'insufficient_points',2))
            self.assertEqual((response.json['warpDistance'],response.json['warpRank']),(0,None))
            with sqlite3.connect(Path(self.tmp.name)/'usage.sqlite3') as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM meteor_bursts WHERE source='warp'").fetchone()[0],0)
            self.c.post('/api/player/meteors/background',json={'event':str(expected)*32,'count':1},headers=self.headers)
        exact=self.c.post(endpoint,json=event,headers=self.headers)
        self.assertEqual(exact.status_code,200)
        self.assertEqual(exact.json['meteors'],0)
        self.assertEqual((exact.json['warpDistance'],exact.json['warpRank']),(1,1))
        self.assertIsNone(exact.json['rank'])
        self.assertEqual(self.c.get('/api/leaderboard').json['players'],[])
        self.assertEqual(self.c.post(endpoint,json={'event':'c'*32},headers=self.headers).status_code,409)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)

    def test_warp_identity_csrf_and_fixed_price_input_guards(self):
        endpoint='/api/player/warp';event={'event':'a'*32}
        self.assertEqual(self.app.test_client().post(endpoint,json=event).status_code,401)
        self.assertEqual(self.c.post(endpoint,json=event).status_code,403)
        for altered in [None,[],{}, {'event':True},{'event':12},{'event':'a'*31},{'event':'A'*32},
                        {**event,'cost':0},{**event,'cost':2},{**event,'points':-2},
                        {**event,'count':0},{**event,'token':'bad'},{**event,'player':'other'}]:
            self.assertEqual(self.c.post(endpoint,data=json.dumps(altered),content_type='application/json',headers=self.headers).status_code,400)
        self.assertEqual(self.c.post(endpoint,data='{bad',content_type='application/json',headers=self.headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)

    def test_warp_distance_cannot_be_set_by_the_client(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':3},headers=self.headers)
        for payload in [{'event':'b'*32,'warpDistance':1000},{'event':'b'*32,'distance':1}]:
            self.assertEqual(self.c.post('/api/player/warp',json=payload,headers=self.headers).status_code,400)
        renamed=self.c.patch('/api/player',json={'name':'Voyager','warpDistance':1000},headers=self.headers)
        self.assertEqual(renamed.status_code,200)
        self.assertEqual((renamed.json['meteors'],renamed.json['warpDistance']),(3,0))

    def test_warp_and_meteor_events_cannot_be_replayed_as_each_other(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':5},headers=self.headers)
        self.c.post('/api/player/meteors/background',json={'event':'b'*32,'count':1},headers=self.headers)
        endpoint='/api/player/warp'
        for event in ['a'*32,'b'*32]:
            self.assertEqual(self.c.post(endpoint,json={'event':event},headers=self.headers).status_code,400)
        self.assertEqual(self.c.post(endpoint,json={'event':'c'*32},headers=self.headers).json['meteors'],4)
        self.assertEqual(self.c.post('/api/player/meteors',json={'event':'c'*32,'count':2},headers=self.headers).status_code,400)
        self.assertEqual(self.c.post('/api/player/meteors/background',json={'event':'c'*32,'count':1},headers=self.headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],4)
        other=self.app.test_client();headers={'X-CSRF-Token':other.get('/api/player').json['csrf']}
        other.post('/api/player/meteors',json={'event':'a'*32,'count':2},headers=headers)
        self.assertEqual(other.post(endpoint,json={'event':'c'*32},headers=headers).json['meteors'],0)

    def test_concurrent_warps_cannot_overdraw_the_last_two_points(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':2},headers=self.headers)
        cookie=self.c.get_cookie('dio_player').value
        barrier=Barrier(2)
        def attempt(event):
            client=self.app.test_client();client.set_cookie('dio_player',cookie)
            headers={'X-CSRF-Token':client.get('/api/player').json['csrf']}
            barrier.wait(timeout=5)
            response=client.post('/api/player/warp',json={'event':event},headers=headers)
            return response.status_code,response.json['meteors']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(attempt,['b'*32,'c'*32]))
        self.assertEqual(sorted(status for status,balance in results),[200,409])
        self.assertTrue(all(balance==0 for status,balance in results))
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)
        self.assertEqual(self.c.get('/api/player').json['warpDistance'],1)
        with sqlite3.connect(Path(self.tmp.name)/'usage.sqlite3') as db:
            self.assertEqual(db.execute("SELECT COUNT(*),SUM(points) FROM meteor_bursts WHERE source='warp'").fetchone(),(1,-2))

    def test_warp_debit_and_deduplication_survive_backup_restore(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':5},headers=self.headers)
        event={'event':'b'*32};endpoint='/api/player/warp'
        self.assertEqual(self.c.post(endpoint,json=event,headers=self.headers).json['meteors'],3)
        folder=Path(self.tmp.name);archive=folder/'warp.zip';backup(folder,archive)
        restored=folder/'restored'
        subprocess.run([sys.executable,'server.py','restore','--data-dir',str(restored),'--file',str(archive)],check=True,capture_output=True)
        client=create_app(restored).test_client();client.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=client.get('/api/player').json
        self.assertEqual(profile['meteors'],3)
        self.assertEqual((profile['warpDistance'],profile['warpRank']),(1,1))
        replay=client.post(endpoint,json=event,headers={'X-CSRF-Token':profile['csrf']})
        self.assertEqual(replay.status_code,200)
        self.assertEqual((replay.json['meteors'],replay.json['warp']['duplicate']),(3,True))
        self.assertEqual(replay.json['warpDistance'],1)
        self.assertEqual(client.get('/api/leaderboard').json['warpPlayers'],[
            {'name':self.profile['name'],'warpDistance':1,'rank':1}])

    def test_warp_distance_ranking_is_independent_of_available_points(self):
        self.c.patch('/api/player',json={'name':'Voyager'},headers=self.headers)
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':5},headers=self.headers)
        for event in ['b'*32,'c'*32]:
            self.assertEqual(self.c.post('/api/player/warp',json={'event':event},headers=self.headers).status_code,200)
        def player(name,joined,points,warps):
            client=self.app.test_client()
            with patch('players.now_seconds',return_value=joined):
                headers={'X-CSRF-Token':client.get('/api/player').json['csrf']}
            client.patch('/api/player',json={'name':name},headers=headers)
            client.post('/api/player/meteors',json={'event':'a'*32,'count':points},headers=headers)
            for index in range(warps):
                response=client.post('/api/player/warp',json={'event':f'{index+1:032x}'},headers=headers)
                self.assertEqual(response.status_code,200)
            return client
        pilot=player('Pilot',200,2,1)
        collector=player('Collector',250,5,0)
        explorer=player('Explorer',300,3,1)
        board=self.c.get('/api/leaderboard').json
        self.assertEqual(board['warpPlayers'],[
            {'name':'Voyager','warpDistance':2,'rank':1},
            {'name':'Pilot','warpDistance':1,'rank':2},
            {'name':'Explorer','warpDistance':1,'rank':2}])
        self.assertEqual(board['players'][0],{'name':'Collector','meteors':5,'rank':1})
        self.assertEqual((board['me']['meteors'],board['me']['warpDistance'],board['me']['warpRank']),(1,2,1))
        self.assertEqual((pilot.get('/api/player').json['meteors'],pilot.get('/api/player').json['warpRank']),(0,2))
        self.assertEqual(collector.get('/api/player').json['warpRank'],None)
        self.assertEqual(explorer.get('/api/player').json['warpRank'],2)
        public=self.app.test_client().get('/api/leaderboard').json
        self.assertIsNone(public['me'])
        self.assertEqual(public['warpPlayers'],board['warpPlayers'])

    def test_existing_paid_warp_history_supplies_distance_without_a_counter_migration(self):
        self.c.post('/api/player/meteors',json={'event':'a'*32,'count':5},headers=self.headers)
        self.c.post('/api/player/warp',json={'event':'b'*32},headers=self.headers)
        self.c.post('/api/player/warp',json={'event':'c'*32},headers=self.headers)
        database=Path(self.tmp.name)/'usage.sqlite3'
        with sqlite3.connect(database) as db:
            self.assertNotIn('warpDistance',[row[1] for row in db.execute('PRAGMA table_info(players)')])
            ledger=db.execute('SELECT player,event,count,at,critical,points,source FROM meteor_bursts ORDER BY event').fetchall()
        restarted=create_app(Path(self.tmp.name)).test_client()
        restarted.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=restarted.get('/api/player').json
        self.assertEqual((profile['meteors'],profile['warpDistance'],profile['warpRank']),(1,2,1))
        restarted.patch('/api/player',json={'name':'Voyager'},headers={'X-CSRF-Token':profile['csrf']})
        self.assertEqual(restarted.get('/api/leaderboard').json['warpPlayers'],[
            {'name':'Voyager','warpDistance':2,'rank':1}])
        with sqlite3.connect(database) as db:
            self.assertEqual(db.execute('SELECT player,event,count,at,critical,points,source FROM meteor_bursts ORDER BY event').fetchall(),ledger)

    def test_prepare_does_not_score_and_critical_awards_twenty_per_star(self):
        self.set_chance(100)
        burst=self.prepare(3)
        self.assertEqual((burst['critical'],burst['points']),(True,60))
        self.assertRegex(burst['event'],r'^[a-f0-9]{32}$')
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)
        response=self.c.post('/api/player/meteors',json=burst,headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['meteors'],60)
        expected={'event':burst['event'],'count':3,'critical':True,'points':60,'duplicate':False}
        self.assertEqual(response.json['burst'],expected)
        duplicate=self.c.post('/api/player/meteors',json=burst,headers=self.headers).json
        self.assertEqual(duplicate['meteors'],60)
        self.assertEqual(duplicate['burst'],{**expected,'duplicate':True})
        self.assertEqual(self.c.get('/api/leaderboard').json['players'][0]['meteors'],60)
        second=self.prepare(2)
        self.assertEqual(self.c.post('/api/player/meteors',json=second,headers=self.headers).status_code,429)
        with patch('players.now_seconds',return_value=time.time()+4):
            self.assertEqual(self.c.post('/api/player/meteors',json=second,headers=self.headers).json['meteors'],100)

    def test_critical_probability_boundaries_and_live_settings(self):
        # Each preparation reads the current setting; no application restart is required.
        for chance,roll,critical in [(0,0,False),(100,999999,True),(5,49999,True),(5,50000,False),(.5,4999,True),(.5,5000,False)]:
            with self.subTest(chance=chance,roll=roll):
                self.set_chance(chance)
                with patch('players.secrets.randbelow',return_value=roll):
                    burst=self.prepare(5)
                self.assertIs(burst['critical'],critical)
                self.assertEqual(burst['points'],100 if critical else 5)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)

    def test_prepare_identity_csrf_and_count_guards(self):
        endpoint='/api/player/meteors/prepare'
        self.assertEqual(self.app.test_client().post(endpoint,json={'count':3}).status_code,401)
        self.assertEqual(self.c.post(endpoint,json={'count':3}).status_code,403)
        for count in [None,0,1,6,True,'3',3.0]:
            self.assertEqual(self.c.post(endpoint,json={'count':count},headers=self.headers).status_code,400)

    def test_signed_burst_rejects_tampering_and_cross_player_reuse(self):
        self.set_chance(100)
        burst=self.prepare()
        for altered in [
            {**burst,'token':burst['token']+'bad'},
            {**burst,'token':None},
            {**burst,'count':5},
            {**burst,'event':'b'*32},
            {**burst,'critical':False},
            {**burst,'points':1000},
            {key:value for key,value in burst.items() if key!='token'},
            {'count':3,'event':'c'*32,'critical':True},
        ]:
            self.assertEqual(self.c.post('/api/player/meteors',json=altered,headers=self.headers).status_code,400)
        other=self.app.test_client();headers={'X-CSRF-Token':other.get('/api/player').json['csrf']}
        self.assertEqual(other.post('/api/player/meteors',json=burst,headers=headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)
        self.assertEqual(other.get('/api/player').json['meteors'],0)
        self.assertEqual(self.c.post('/api/player/meteors',json=burst,headers=self.headers).json['meteors'],60)

    def test_expired_burst_does_not_score(self):
        burst=self.prepare()
        signer=URLSafeTimedSerializer(self.app.secret_key,salt='dio-starfall-burst-v1')
        claim=signer.loads(burst['token'])
        with patch('itsdangerous.timed.TimestampSigner.get_timestamp',return_value=int(time.time())-90000):
            burst['token']=signer.dumps(claim)
        self.assertEqual(self.c.post('/api/player/meteors',json=burst,headers=self.headers).status_code,400)
        self.assertEqual(self.c.get('/api/player').json['meteors'],0)

    def test_existing_bursts_migrate_without_changing_historic_scores(self):
        database=Path(self.tmp.name)/'usage.sqlite3'
        with sqlite3.connect(database) as db:
            pid=db.execute('SELECT id FROM players').fetchone()[0]
            db.execute('DROP TABLE meteor_bursts')
            db.execute('CREATE TABLE meteor_bursts (player TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL,at REAL NOT NULL,PRIMARY KEY(player,event)) WITHOUT ROWID')
            db.execute('INSERT INTO meteor_bursts VALUES(?,?,?,?)',(pid,'a'*32,4,time.time()-5))
            db.execute('UPDATE players SET meteors=4 WHERE id=?',(pid,))
        # Repeated startup also verifies the migration is idempotent.
        app=create_app(Path(self.tmp.name));create_app(Path(self.tmp.name))
        client=app.test_client();client.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=client.get('/api/player').json
        self.assertEqual(profile['meteors'],4)
        duplicate=client.post('/api/player/meteors',json={'count':4,'event':'a'*32},headers={'X-CSRF-Token':profile['csrf']}).json
        self.assertEqual(duplicate['meteors'],4)
        self.assertEqual(duplicate['burst'],{'event':'a'*32,'count':4,'critical':False,'points':4,'duplicate':True})

    def test_critical_score_survives_backup_restore(self):
        self.set_chance(100)
        burst=self.prepare()
        self.c.post('/api/player/meteors',json=burst,headers=self.headers)
        folder=Path(self.tmp.name);archive=folder/'critical.zip';backup(folder,archive)
        restored=folder/'restored'
        subprocess.run([sys.executable,'server.py','restore','--data-dir',str(restored),'--file',str(archive)],check=True,capture_output=True)
        client=create_app(restored).test_client();client.set_cookie('dio_player',self.c.get_cookie('dio_player').value)
        profile=client.get('/api/player').json
        self.assertEqual(profile['meteors'],60)
        replay=client.post('/api/player/meteors',json=burst,headers={'X-CSRF-Token':profile['csrf']}).json
        self.assertEqual((replay['meteors'],replay['burst']['points'],replay['burst']['duplicate']),(60,60,True))

if __name__=='__main__':unittest.main()
