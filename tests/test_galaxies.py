from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from server import create_app


class GalaxiesTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.folder=Path(self.temp.name)
        self.app=create_app(self.folder,password='local-test-password')
        self.client=self.app.test_client()
        self.csrf=self.client.get('/api/player').json['csrf']
        self.headers={'X-CSRF-Token':self.csrf}

    def tearDown(self):
        self.temp.cleanup()

    def post(self,**values):
        return self.client.post('/api/galaxies/applications',json={'event':'a'*32,'galaxy':'main','seat':'extra1',**values},headers=self.headers)

    def fund(self,score):
        with closing(sqlite3.connect(self.folder/'usage.sqlite3')) as db, db: db.execute('UPDATE players SET meteors=?',(score,))

    def test_shared_existing_application_and_conflict(self):
        r=self.post(appId='gutenberg')
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json['cost'],0)
        self.assertEqual(self.client.get('/api/player').json['planetCount'],0)
        other=self.app.test_client()
        self.assertEqual(other.get('/api/galaxies').json['layouts']['main']['extra1'],'gutenberg')
        self.assertEqual(self.post(event='b'*32,appId='python-docs').status_code,409)

    def test_new_link_debit_once_and_admin_visibility(self):
        self.fund(200)
        payload={'name':'Example library','url':'https://library.example.net/','group':'business'}
        first=self.post(**payload)
        self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(first.json['balance'],100)
        self.assertEqual(self.client.get('/api/player').json['planetCount'],1)
        catalog=self.client.get('/api/catalog').json['apps']
        surfaces=[a['surface'] for a in catalog]
        self.assertEqual(len(surfaces),len(set(surfaces)))
        self.assertEqual(next(a['surface'] for a in catalog if a['id']==first.json['app']['id']),first.json['app']['surface'])
        self.assertEqual(self.post(**payload).json,first.json)
        self.assertEqual(self.client.get('/api/player').json['planetCount'],1)
        self.assertEqual(self.client.get('/api/player').json['meteors'],100)
        self.assertIn(first.json['app']['id'],[a['id'] for a in self.client.get('/api/catalog').json['apps']])
        self.assertEqual(self.post(event='b'*32,seat='extra2',**payload).status_code,409)
        self.assertEqual(self.client.get('/api/player').json['meteors'],100)

    def test_selecting_existing_name_transfers_guest_planet_and_receipt(self):
        self.fund(200)
        payload={'name':'Guest planet','url':'https://example.org/guest','group':'business'}
        created=self.post(**payload)
        self.assertEqual(created.status_code,200)
        other=self.app.test_client()
        other_headers={'X-CSRF-Token':other.get('/api/player').json['csrf']}
        self.assertEqual(other.patch('/api/player',json={'name':'星球旅人'},headers=other_headers).status_code,200)
        selected=self.client.patch('/api/player',json={'name':'星球旅人'},headers=self.headers)
        self.assertEqual((selected.status_code,selected.json['planetCount'],selected.json['meteors']),(200,1,100))
        retry=other.post('/api/galaxies/applications',
                         json={'event':'a'*32,'galaxy':'main','seat':'extra1',**payload},headers=other_headers)
        self.assertEqual(retry.json,created.json)
        self.assertEqual(other.get('/api/player').json['planetCount'],1)
        new_planet=other.post('/api/galaxies/applications',json={
            'event':'b'*32,'galaxy':'main','seat':'extra2','name':'Next planet',
            'url':'https://example.org/next','group':'business',
        },headers=other_headers)
        self.assertEqual(new_planet.status_code,200)
        profile=self.client.get('/api/player').json
        self.assertEqual((profile['planetCount'],profile['meteors']),(2,0))

    def test_admin_can_edit_and_remove_created_app(self):
        self.fund(200)
        created=self.post(name='new app',url='https://example.org/',group='business').json['app']['id']
        admin=self.app.test_client()
        token=admin.get('/api/admin/session').json['csrf']
        login=admin.post('/api/admin/login',json={'password':'local-test-password'},headers={'X-CSRF-Token':token})
        headers={'X-CSRF-Token':login.json['csrf']}
        state=admin.get('/api/admin/catalog').json
        item=next(a for a in state['catalog']['apps'] if a['id']==created)
        item['name']='renamed'
        saved=admin.put('/api/admin/catalog',json=state,headers=headers)
        self.assertEqual(saved.status_code,200)
        self.assertEqual(next(a for a in self.client.get('/api/catalog').json['apps'] if a['id']==created)['name'],'renamed')
        state=admin.get('/api/admin/catalog').json
        state['catalog']['apps']=[a for a in state['catalog']['apps'] if a['id']!=created]
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,200)
        self.assertIsNone(self.client.get('/api/galaxies').json['layouts']['main']['extra1'])
        self.assertEqual(self.client.get('/api/player').json['planetCount'],1)

    def admin_session(self):
        admin=self.app.test_client()
        token=admin.get('/api/admin/session').json['csrf']
        login=admin.post('/api/admin/login',json={'password':'local-test-password'},headers={'X-CSRF-Token':token})
        return admin,{'X-CSRF-Token':login.json['csrf']}

    def test_admin_manages_all_seats_and_preserves_frontend_placements(self):
        self.assertEqual(self.post(appId='gutenberg').status_code,200)
        admin,headers=self.admin_session()
        state=admin.get('/api/admin/catalog').json
        self.assertEqual(state['catalog']['galaxies']['main']['extra1'],'gutenberg')
        expected=state['catalog']['galaxies']
        expected['other']['extra2']='python-docs'
        state['catalog']['apps'][0]['surface']='io'
        saved=admin.put('/api/admin/catalog',json=state,headers=headers)
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts'],expected)
        self.assertEqual(self.client.get('/api/catalog').json['apps'][0]['surface'],'io')
        self.assertEqual(saved.json['revision'],admin.get('/api/admin/catalog').json['revision'])
        # A later settings save and a process restart retain the same placements/style.
        state=admin.get('/api/admin/catalog').json
        state['catalog']['site']['title']='Updated title'
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,200)
        restarted=create_app(self.folder).test_client()
        self.assertEqual(restarted.get('/api/galaxies').json['layouts'],expected)
        self.assertEqual(restarted.get('/api/catalog').json['apps'][0]['surface'],'io')

    def test_legacy_import_resets_overrides_and_previous_restores_shared_layout(self):
        self.assertEqual(self.post(appId='gutenberg').status_code,200)
        admin,headers=self.admin_session()
        state=admin.get('/api/admin/catalog').json
        del state['catalog']['galaxies']
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,200)
        self.assertIsNone(self.client.get('/api/galaxies').json['layouts']['main']['extra1'])
        previous=admin.get('/api/admin/previous').json['catalog']
        self.assertEqual(previous['galaxies']['main']['extra1'],'gutenberg')
        state=admin.get('/api/admin/catalog').json
        state['catalog']=previous
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,200)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['main']['extra1'],'gutenberg')

    def test_admin_stale_save_cannot_overwrite_frontend_replacement(self):
        admin,headers=self.admin_session()
        state=admin.get('/api/admin/catalog').json
        self.assertEqual(self.post(appId='gutenberg').status_code,200)
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,409)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['main']['extra1'],'gutenberg')

    def test_admin_rejects_duplicate_seats_and_invalid_styles(self):
        admin,headers=self.admin_session()
        state=admin.get('/api/admin/catalog').json
        state['catalog']['galaxies']['main']['extra1']='google'
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,400)
        state=admin.get('/api/admin/catalog').json
        state['catalog']['apps'][0]['surface']='arbitrary-path'
        self.assertEqual(admin.put('/api/admin/catalog',json=state,headers=headers).status_code,400)

    def test_failure_does_not_create_or_debit(self):
        self.fund(99)
        payload={'name':'test','url':'http://localhost:3001/','group':'business'}
        self.assertEqual(self.post(**payload).status_code,409)
        self.assertIsNone(self.client.get('/api/galaxies').json['layouts']['main']['extra1'])
        self.assertEqual(self.client.get('/api/player').json['meteors'],99)
        self.fund(200)
        self.assertEqual(self.post(**{**payload,'url':'javascript:alert(1)'}).status_code,400)
        self.assertEqual(self.client.get('/api/player').json['meteors'],200)

    def test_second_vacancy_remains_unique_after_reload(self):
        self.fund(200)
        created=self.post(galaxy='dev',seat='extra1',name='new dev app',url='https://example.org/',group='dev').json['app']['id']
        slots=self.client.get('/api/galaxies').json['layouts']['dev']
        self.assertEqual(slots['extra1'],created)
        self.assertEqual(list(slots.values()).count(created),1)

    def test_replace_existing_preserves_other_seats_and_catalog(self):
        before=self.client.get('/api/galaxies').json['layouts']
        old=before['main']['core']
        response=self.post(seat='core',replaceAppId=old,appId='gutenberg')
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['cost'],0)
        self.assertEqual(self.post(seat='core',replaceAppId=old,appId='gutenberg').json,response.json)
        expected={**before['main'],'core':'gutenberg'}
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['main'],expected)
        self.assertIn(old,[a['id'] for a in self.client.get('/api/catalog').json['apps']])
        self.assertEqual(self.post(event='b'*32,seat='core',replaceAppId=old,appId='python-docs').status_code,409)

    def test_theme_replacement_does_not_shift_other_planets(self):
        before=self.client.get('/api/galaxies').json['layouts']['dev']
        response=self.post(galaxy='dev',seat='core',replaceAppId=before['core'],appId='gutenberg')
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['dev'],{**before,'core':'gutenberg'})

    def test_new_replacement_debit_once_and_failed_replacement_keeps_original(self):
        before=self.client.get('/api/galaxies').json['layouts']['main']
        payload={'seat':'core','replaceAppId':before['core'],'name':'New','url':'https://new.example.org/','group':'business'}
        self.fund(99)
        self.assertEqual(self.post(**payload).status_code,409)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['main'],before)
        self.fund(200)
        result=self.post(**payload)
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.post(**payload).json,result.json)
        self.assertEqual(self.client.get('/api/player').json['meteors'],100)
        self.assertEqual(self.client.get('/api/galaxies').json['layouts']['main'],{**before,'core':result.json['app']['id']})
        stale={**payload,'replaceAppId':before['core'],'event':'b'*32,'url':'https://second.example.org/'}
        self.assertEqual(self.post(**stale).status_code,409)
        self.assertEqual(self.client.get('/api/player').json['meteors'],100)

    def test_creation_ranking_history_and_rename(self):
        from galaxies import initialize_galaxies
        other=self.app.test_client()
        other_profile=other.get('/api/player').json
        self.fund(400)
        self.post(name='one',url='https://one.example/',group='business')
        self.post(event='b'*32,seat='extra2',name='two',url='https://two.example/',group='business')
        empty=next(k for k,v in other.get('/api/galaxies').json['layouts']['dev'].items() if not v)
        result=other.post('/api/galaxies/applications',json={'event':'c'*32,'galaxy':'dev','seat':empty,'name':'three','url':'https://three.example/','group':'dev'},headers={'X-CSRF-Token':other_profile['csrf']})
        self.assertEqual(result.status_code,200)
        self.client.patch('/api/player',json={'name':'Creator'},headers=self.headers)
        board=self.client.get('/api/leaderboard').json
        self.assertEqual([(p['name'],p['planetCount'],p['rank']) for p in board['planetPlayers']], [('Creator',2,1),(other_profile['name'],1,2)])
        self.assertEqual((board['me']['planetCount'],board['me']['planetRank']),(2,1))
        self.assertEqual(other.get('/api/player').json['planetRank'],2)
        self.assertEqual(self.app.test_client().get('/api/leaderboard').json['planetPlayers'],board['planetPlayers'])
        # Simulate upgrading a database with only historical creation receipts.
        with closing(sqlite3.connect(self.folder/'usage.sqlite3')) as db,db:
            db.execute('DELETE FROM planet_creations')
        initialize_galaxies(self.folder/'usage.sqlite3')
        initialize_galaxies(self.folder/'usage.sqlite3')
        self.assertEqual(self.client.get('/api/leaderboard').json['planetPlayers'],board['planetPlayers'])

    def test_csrf_and_identity_required(self):
        self.assertEqual(self.client.post('/api/galaxies/applications',json={}).status_code,403)
        self.assertEqual(self.app.test_client().post('/api/galaxies/applications',json={}).status_code,401)

if __name__=='__main__': unittest.main()
