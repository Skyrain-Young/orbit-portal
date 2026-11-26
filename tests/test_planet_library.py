import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from galaxies import assign_surfaces, initialize_galaxies, STYLE_IDS

ROOT=Path(__file__).resolve().parents[1]

class PlanetLibraryTest(unittest.TestCase):
    def test_thirty_distinct_transparent_pngs_and_sources(self):
        styles=json.loads((ROOT/'web/portal/textures/planet-library.json').read_text())
        self.assertEqual(len(styles),30)
        self.assertEqual(len(set(STYLE_IDS)),30)
        hashes=set()
        for style in styles:
            self.assertTrue(style['prototype'] and style['feature'] and style['source'].startswith('https://'))
            png=(ROOT/'web/portal/textures/surfaces'/f'{style["id"]}.png').read_bytes()
            self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n')
            self.assertEqual(int.from_bytes(png[16:20],'big'),256)
            self.assertEqual(int.from_bytes(png[20:24],'big'),256)
            self.assertEqual(png[25],6)
            hashes.add(hashlib.sha256(png).hexdigest())
        self.assertEqual(len(hashes),30)

    def test_assignments_unique_stable_and_bounded_after_thirty(self):
        with tempfile.TemporaryDirectory() as temp:
            database=Path(temp)/'data.sqlite';initialize_galaxies(database)
            with sqlite3.connect(database) as db:
                apps = [{'id': f'app-{i}'} for i in range(29)]
                apps.append({'id': 'sample', 'surface': 'core'})
                assign_surfaces(apps,db)
                before={a['id']:a['surface'] for a in apps}
                self.assertEqual(len(set(before.values())),30)
                self.assertEqual(before['sample'], 'core')
                reversed_apps=[{'id':a['id']} for a in reversed(apps)]
                assign_surfaces(reversed_apps,db)
                self.assertEqual({a['id']:a['surface'] for a in reversed_apps},before)
                extra=[{'id':'overflow'}];assign_surfaces(extra,db)
                self.assertIn(extra[0]['surface'],STYLE_IDS)
            with sqlite3.connect(database) as db:
                restored=[{'id':a['id']} for a in apps];assign_surfaces(restored,db)
                self.assertEqual({a['id']:a['surface'] for a in restored},before)
