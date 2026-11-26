# Planet texture credits

Planet maps by **Solar System Scope / INOVE**. Source collection: [Solar System Scope — Solar Textures](https://www.solarsystemscope.com/textures/).

Licensed under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). The collection permits reuse, adaptation and redistribution, including commercial use, with attribution.

These are the original downloaded JPEG files, without pixel edits or re-encoding. Orbit Portal creates adapted displays by mapping the textures onto spheres and adding lighting / atmospheric effects. The current portal uses pre-rendered lossless PNG surfaces; the original browser renderer is retained as an offline generation tool. No endorsement by the texture creators is implied.

The collection describes the maps as equirectangular projections based on NASA elevation and imagery, with some unmapped areas filled by the creators and colors adjusted by the creators.

## Original files

All maps are 2048 × 1024 pixels. Downloaded 2026-11-11.

| File | Bytes | Original source |
| --- | ---: | --- |
| `2k_earth_clouds.jpg` | 965,676 | [Download](https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg) |
| `2k_earth_daymap.jpg` | 463,087 | [Download](https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg) |
| `2k_jupiter.jpg` | 498,976 | [Download](https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg) |
| `2k_mars.jpg` | 750,547 | [Download](https://www.solarsystemscope.com/textures/download/2k_mars.jpg) |
| `2k_moon.jpg` | 1,053,869 | [Download](https://www.solarsystemscope.com/textures/download/2k_moon.jpg) |
| `2k_neptune.jpg` | 241,580 | [Download](https://www.solarsystemscope.com/textures/download/2k_neptune.jpg) |
| `2k_saturn.jpg` | 199,916 | [Download](https://www.solarsystemscope.com/textures/download/2k_saturn.jpg) |
| `2k_uranus.jpg` | 77,751 | [Download](https://www.solarsystemscope.com/textures/download/2k_uranus.jpg) |
| `2k_venus_surface.jpg` | 885,075 | [Download](https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg) |

Total JPEG payload: **5,136,477 bytes**.

## Integrity

```text
fffd7f68d41b37274822150e54a6ef605af1d3ec35624d9f628c3b896bfa42ed  2k_earth_clouds.jpg
767ee1dc6eb3802699bfccf6f264880f8acd0b80de3191cd24984fe279b07b7c  2k_earth_daymap.jpg
b0f04d005350252636b0e3396fc592548cbd9e9126b269d32d5c6abd4b0e4f2b  2k_jupiter.jpg
2d187f3e77a98eaa8cea5f4cc722f633c122ef170b9e94ace6b5fb6cbc3f8e01  2k_mars.jpg
2764ba6535ea0481a062846ee033cc7a909dae05b31a8fd13f3e98f3a7fd92bd  2k_moon.jpg
cb42ea82709741d28b0af44d8b283cbc6dbd0c521a7f0e1e1e010ade00977df6  2k_neptune.jpg
54a900ca9bf7ab62e70f862852759abdf342e6d6436a95a2fe9ebdb6bcd3bbac  2k_saturn.jpg
d15239d46f82d3ea13d2b260b5b29b2a382f42f2916dae0694d0387b1204a09d  2k_uranus.jpg
dbe5db1c794a8ab4cbf7dd6bf193540c400fc833ce1e6cc399318aa68026278b  2k_venus_surface.jpg
```

## Pre-rendered portal surfaces

`surfaces/{core,git,doc,week,flow,gpu,bi,seek}.png` are 256 × 256 lossless adaptations of the maps above, with the same spherical projection, cloud overlay, soft illumination and atmosphere previously calculated by each visitor’s browser. Their combined payload is **762,543 bytes**, 85.2% less than loading all nine source maps. The PNGs retain the source maps’ **CC BY 4.0** attribution and license.

The page fetches only these eight surfaces and displays a lightweight shaded disk while loading or if a file is unavailable. It no longer renders procedural terrain or samples the source maps at runtime. The source JPEGs are included for regeneration.

Regenerate with Node.js, Playwright and its Chrome browser available:

```sh
node scripts/render-planet-surfaces.cjs
node scripts/render-planet-surfaces.cjs --check
```

Use `NODE_PATH` if Playwright is installed outside this checkout. The generator starts a temporary loopback server, runs the preserved `scripts/planet-surface-renderer.js`, exports the eight PNGs, and compares every decoded RGBA channel with the original renderer. `--check` verifies existing assets without modifying them. This tooling is not loaded by the portal or required by production.

## Thirty-style application library (2026-11-13)

`planet-library.json` is the catalogue of 30 appearances: the eight original licensed surfaces above plus 22 original procedural illustrations. `planet-library.js` is its generated browser manifest. The original eight assets are unchanged. New assets were made locally from mathematical terrain, craters, faults, cloud fields and soft spherical lighting, without copying NASA imagery. Their astronomical references are linked per entry. They are stylized UI illustrations, not measured surface maps or spacecraft photographs; relief, color and feature scale are adjusted for legibility.

The additional prototypes are Mercury, Venus's cloud tops, Io, Europa, Ganymede, Callisto, Titan, Enceladus, Triton, Pluto, Charon, Ceres, Vesta, Dione, Rhea, Tethys, Iapetus, Mimas, Oberon, Titania, Ariel and Umbriel. Venus has two distinct appearances: the original surface rendering and a new cloud-top interpretation.

Reference collections: [NASA Jupiter moons](https://science.nasa.gov/jupiter/jupiter-moons/), [Saturn moons](https://science.nasa.gov/saturn/moons/), [Uranus moons](https://science.nasa.gov/uranus/moons/), [Pluto](https://science.nasa.gov/dwarf-planets/pluto/), [Triton](https://science.nasa.gov/neptune/moons/triton/), and [planet overview](https://science.nasa.gov/solar-system/planets/).

Generate the 22 new PNGs and both manifests offline with `python scripts/build-planet-library.py` (NumPy and Pillow). This requires neither network access nor browser automation. The runtime does not depend on those tools. The complete set is about 2.14 MB; surfaces are 256 × 256 and fetched on demand, with at most 30 decoded canvases cached (7.5 MiB). The earlier eight-surface generator continues to verify just the original eight assets.

Preview at `/assets/planet-library.html`. `app_surfaces` stores application-to-style bindings in the existing backed-up SQLite database. The demonstration catalog selects eight appearances explicitly. New applications receive unused styles until all 30 have been assigned, then the least-used style is reused. Reordering, moving, replacing a seat, refreshing and changing galaxies do not change the appearance of an existing application. Removed applications retain their historical binding.
