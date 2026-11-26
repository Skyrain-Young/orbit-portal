import copy
import io
import json
import os
import tempfile
import subprocess
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from server import create_app, backup
from usage import record, CHINA
from datetime import datetime, timedelta

class PortalTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.folder=Path(self.temp.name)
        self.app=create_app(self.folder,password='test-password-long');self.app.testing=True
        self.client=self.app.test_client();self.public=self.app.test_client()
        self.csrf=self.client.get('/api/admin/session').json['csrf']
    def tearDown(self): self.temp.cleanup()
    def login(self):
        r=self.client.post('/api/admin/login',json={'password':'test-password-long'},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(r.status_code,200);self.csrf=r.json['csrf']
    def save(self,payload):return self.client.put('/api/admin/catalog',json=payload,headers={'X-CSRF-Token':self.csrf})

    def test_empty_catalog_initializes_all_seats_without_overwriting_existing_data(self):
        folder = self.folder / 'empty'
        with patch.dict(os.environ, {'DIO_EMPTY_CATALOG': '1'}):
            empty = create_app(folder, password='test-password-long').test_client()
            self.assertEqual(empty.get('/healthz').status_code, 200)
            self.assertEqual(empty.get('/api/catalog').json['apps'], [])
            for layout in empty.get('/api/galaxies').json['layouts'].values():
                self.assertEqual(list(layout.values()), [None] * 10)
            existing = create_app(self.folder).test_client()
            self.assertEqual(existing.get('/api/catalog').json['slots']['core'], 'google')
        restarted = create_app(folder).test_client()
        self.assertEqual(restarted.get('/api/catalog').json['apps'], [])

    def test_authentication_and_csrf(self):
        self.assertEqual(self.client.get('/api/admin/catalog').status_code,401)
        self.assertEqual(self.client.post('/api/admin/login',json={'password':'test-password-long'}).status_code,403)
        self.login()
        self.assertEqual(self.client.put('/api/admin/catalog',json={}).status_code,403)
        self.assertEqual(self.client.get('/api/admin/catalog').status_code,200)
    def test_catalog_hot_reload_conflict_validation_and_history(self):
        self.login();payload=self.client.get('/api/admin/catalog').json;stale=copy.deepcopy(payload)
        payload['catalog']['apps'][0]['name']='Updated'
        self.assertEqual(self.save(payload).status_code,200)
        self.assertEqual(self.public.get('/api/catalog').json['apps'][0]['name'],'Updated')
        self.assertEqual(self.save(stale).status_code,409)
        self.assertEqual(self.client.get('/api/admin/previous').json['catalog']['apps'][0]['name'],'Google')
        bad=self.client.get('/api/admin/catalog').json;bad['catalog']['apps'][0]['url']='javascript:alert(1)'
        self.assertEqual(self.save(bad).status_code,400)
        good=self.client.get('/api/admin/catalog').json;good['catalog']['apps'][0]['enabled']=False
        self.assertEqual(self.save(good).status_code,200)
        self.assertNotIn('google',[a['id'] for a in self.public.get('/api/catalog').json['apps']])

    def test_starfall_chance_defaults_validation_and_saved_settings(self):
        self.assertEqual(self.public.get('/api/catalog').json['site']['starfallCriticalChance'],5)
        path=self.folder/'catalog.json';legacy=json.loads(path.read_text())
        del legacy['site']['starfallCriticalChance'];path.write_text(json.dumps(legacy))
        self.assertEqual(self.public.get('/api/catalog').json['site']['starfallCriticalChance'],5)
        self.login()
        for chance in [True,False,None,'5',-1,100.01,10**400,float('nan'),float('inf'),float('-inf')]:
            with self.subTest(chance=chance):
                payload=self.client.get('/api/admin/catalog').json
                payload['catalog']['site']['starfallCriticalChance']=chance
                self.assertEqual(self.save(payload).status_code,400)
        for chance in [0,.5,5,100]:
            payload=self.client.get('/api/admin/catalog').json
            payload['catalog']['site']['starfallCriticalChance']=chance
            self.assertEqual(self.save(payload).status_code,200)
            self.assertEqual(self.public.get('/api/catalog').json['site']['starfallCriticalChance'],chance)
    def test_meteor_interval_defaults_validation_and_persistence(self):
        site=self.public.get('/api/catalog').json['site']
        self.assertEqual((site['meteorIntervalMin'],site['meteorIntervalMax']),(10,15))
        path=self.folder/'catalog.json';legacy=json.loads(path.read_text())
        del legacy['site']['meteorIntervalMin'];del legacy['site']['meteorIntervalMax']
        path.write_text(json.dumps(legacy))
        site=self.public.get('/api/catalog').json['site']
        self.assertEqual((site['meteorIntervalMin'],site['meteorIntervalMax']),(10,15))
        self.login()
        for minimum,maximum in [(0,15),(10,3601),(20,10),(True,15),(10,False),('10',15),(10,None),(1.5,15),(10,float('inf'))]:
            with self.subTest(minimum=minimum,maximum=maximum):
                payload=self.client.get('/api/admin/catalog').json
                payload['catalog']['site'].update(meteorIntervalMin=minimum,meteorIntervalMax=maximum)
                self.assertEqual(self.save(payload).status_code,400)
                self.assertNotIn('meteorIntervalMin',json.loads(path.read_text())['site'])
        for minimum,maximum in [(1,1),(20,30),(3600,3600)]:
            payload=self.client.get('/api/admin/catalog').json
            payload['catalog']['site'].update(meteorIntervalMin=minimum,meteorIntervalMax=maximum)
            self.assertEqual(self.save(payload).status_code,200)
            site=self.public.get('/api/catalog').json['site']
            self.assertEqual((site['meteorIntervalMin'],site['meteorIntervalMax']),(minimum,maximum))
            self.assertEqual(site['starfallCriticalChance'],5)
            self.assertEqual(json.loads(path.read_text())['site'],site)
        site=create_app(self.folder).test_client().get('/api/catalog').json['site']
        self.assertEqual((site['meteorIntervalMin'],site['meteorIntervalMax']),(3600,3600))

    def test_star_density_defaults_validation_and_persistence(self):
        self.assertEqual(self.public.get('/api/catalog').json['site']['starDensity'],40)
        path=self.folder/'catalog.json';seed=json.loads(path.read_text())
        self.assertEqual(seed['site']['starDensity'],40)
        legacy=copy.deepcopy(seed);del legacy['site']['starDensity']
        path.write_text(json.dumps(legacy));legacy_raw=path.read_bytes()
        self.assertEqual(self.public.get('/api/catalog').json['site']['starDensity'],40)
        self.assertEqual(path.read_bytes(),legacy_raw,'reading old configs must not rewrite them')
        self.login()
        self.assertEqual(self.client.get('/api/admin/catalog').json['catalog']['site']['starDensity'],40)
        self.assertEqual(path.read_bytes(),legacy_raw)
        for density in [True,False,None,'40',9,101,10.5,40.0,float('nan'),float('inf'),-10**400]:
            with self.subTest(density=density):
                payload=self.client.get('/api/admin/catalog').json
                payload['catalog']['site']['starDensity']=density
                self.assertEqual(self.save(payload).status_code,400)
                self.assertEqual(path.read_bytes(),legacy_raw,'invalid density must not change stored config')
        for density in [10,40,63,100]:
            payload=self.client.get('/api/admin/catalog').json
            before=copy.deepcopy(payload['catalog']['site'])
            payload['catalog']['site']['starDensity']=density
            self.assertEqual(self.save(payload).status_code,200)
            site=self.public.get('/api/catalog').json['site']
            self.assertEqual(site,{**before,'starDensity':density})
            self.assertEqual(json.loads(path.read_text())['site'],site)
        restarted=create_app(self.folder).test_client().get('/api/catalog').json['site']
        self.assertEqual(restarted['starDensity'],100)
        self.assertEqual((restarted['meteorIntervalMin'],restarted['meteorIntervalMax']),(10,15))

    def test_anonymous_usage_and_admin_exclusion(self):
        for _ in range(2):self.assertEqual(self.public.post('/api/events',json={'kind':'visit','visitor':'a'*32}).status_code,204)
        self.public.post('/api/events',json={'kind':'click','app':'youtube'})
        self.login();self.client.post('/api/events',json={'kind':'visit','visitor':'b'*32})
        data=self.client.get('/api/admin/usage?days=7').json
        self.assertEqual((data['visits'],data['browsers'],data['clicks']),(2,1,1))
        self.assertEqual(len(data['trend']),7)
        self.assertEqual(self.public.get('/api/admin/usage').status_code,401)
        self.assertEqual(self.client.get('/api/admin/usage?days=9999').status_code,400)
        self.assertEqual(self.client.get('/api/admin/usage.csv?days=7').status_code,200)
    def test_public_usage_is_aggregate_only(self):
        self.public.post('/api/events',json={'kind':'visit','visitor':'a'*32})
        self.public.post('/api/events',json={'kind':'click','app':'youtube'})
        response=self.public.get('/api/usage/summary')
        self.assertEqual(response.status_code,200)
        data=response.json
        self.assertEqual(set(data),{'days','visits','weekVisits','browsers','clicks','trend'})
        self.assertEqual((data['days'],data['visits'],data['browsers'],data['clicks']),(7,1,1,1))
        self.assertEqual(len(data['trend']),7)
        self.assertEqual(data['weekVisits'],1)
        self.assertNotIn('youtube',response.text)
        self.assertNotIn('a'*32,response.text)
        self.assertEqual(self.public.get('/api/admin/usage').status_code,401)

    def test_lifetime_and_weekly_boundaries_are_distinct(self):
        today=datetime.now(CHINA).date()
        database=self.folder/'usage.sqlite3'
        self.public.post('/api/events',json={'kind':'visit','visitor':'a'*32})
        for age,count,visitor in [(10,3,'b'*32),(7,7,'c'*32),(6,2,'a'*32)]:
            for _ in range(count):record(database,(today-timedelta(days=age)).isoformat(),'',visitor)
        record(database,(today-timedelta(days=10)).isoformat(),'youtube','')
        data=self.public.get('/api/usage/summary').json
        self.assertEqual(data['visits'],13)
        self.assertEqual(data['weekVisits'],3)
        self.assertEqual(data['browsers'],3)
        self.assertEqual(data['clicks'],1)
        self.assertEqual(sum(row['count'] for row in data['trend']),3)
        self.assertEqual(data['trend'][0],{'date':(today-timedelta(days=6)).isoformat(),'count':2})

    def test_password_invalidates_other_session(self):
        self.login();other=self.app.test_client();token=other.get('/api/admin/session').json['csrf']
        other.post('/api/admin/login',json={'password':'test-password-long'},headers={'X-CSRF-Token':token})
        r=self.client.post('/api/admin/password',json={'current':'test-password-long','password':'replacement-long-password'},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(r.status_code,200);self.assertEqual(other.get('/api/admin/catalog').status_code,401)
    def test_backup_integrity_and_no_data_exposure(self):
        self.public.post('/api/events',json={'kind':'click','app':'youtube'})
        self.login();r=self.client.get('/api/admin/backup');self.assertEqual(r.status_code,200)
        with zipfile.ZipFile(io.BytesIO(r.data)) as z:
            self.assertEqual(set(z.namelist()),{'catalog.json','usage.sqlite3','auth.json','secret.key'})
            self.assertEqual(json.loads(z.read('catalog.json'))['site']['title'],'DIO-Space')
        for path in ['/data/auth.json','/assets/../../data/auth.json','/assets/../catalog.json']:
            self.assertEqual(self.public.get(path).status_code,404)
        self.assertEqual(self.client.get('/healthz').json['version'],'0.1.0')
    def test_backup_restore_roundtrip(self):
        self.public.post('/api/events',json={'kind':'visit','visitor':'c'*32})
        archive=self.folder/'backup.zip';backup(self.folder,archive)
        restored=self.folder/'restored'
        subprocess.run([sys.executable,'server.py','restore','--data-dir',str(restored),'--file',str(archive)],check=True,capture_output=True)
        client=create_app(restored).test_client();csrf=client.get('/api/admin/session').json['csrf']
        self.assertEqual(client.post('/api/admin/login',json={'password':'test-password-long'},headers={'X-CSRF-Token':csrf}).status_code,200)
        self.assertEqual(client.get('/api/admin/usage?days=1').json['visits'],1)
        self.assertEqual(client.get('/api/catalog').json['site']['title'],'DIO-Space')
    def test_login_throttle(self):
        for _ in range(10):self.client.post('/api/admin/login',json={'password':'wrong'},headers={'X-CSRF-Token':self.csrf})
        self.assertEqual(self.client.post('/api/admin/login',json={'password':'wrong'},headers={'X-CSRF-Token':self.csrf}).status_code,429)

if __name__=='__main__': unittest.main()
