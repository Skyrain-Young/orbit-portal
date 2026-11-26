"""Exercise the actual canvas scripts with deterministic frames and attention changes."""
import subprocess
import unittest
from pathlib import Path


class StarfallFrontendTest(unittest.TestCase):
    def test_background_visibility_and_focus(self):
        subprocess.run(['node', str(Path(__file__).with_name('starfall_frontend.cjs'))], check=True)

    def test_galaxy_motion_and_sprite_budget(self):
        subprocess.run(['node', str(Path(__file__).with_name('galaxy_frontend.cjs'))], check=True)

    def test_galaxy_vortex_lifecycle(self):
        subprocess.run(['node', str(Path(__file__).with_name('vortex_frontend.cjs'))], check=True)

    def test_orbit_rendering_and_interactions(self):
        subprocess.run(['node', str(Path(__file__).with_name('orbit_frontend.cjs'))], check=True)

    def test_planet_surface_loading(self):
        subprocess.run(['node', str(Path(__file__).with_name('planets_frontend.cjs'))], check=True)

    def test_unchanged_statistics_rendering(self):
        subprocess.run(['node', str(Path(__file__).with_name('stats_frontend.cjs'))], check=True)

    def test_startup_arrival_bootstrap(self):
        subprocess.run(['node', str(Path(__file__).with_name('arrival_frontend.cjs'))], check=True)
