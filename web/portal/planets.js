/* Pre-rendered Planet study V3 surfaces. Maps: Solar System Scope / INOVE,
 * CC BY 4.0. Sources and adaptation notes: /assets/textures/README.md.
 * The full pixel renderer lives in scripts/planet-surface-renderer.js and runs
 * only when regenerating assets, never on a visitor's main thread.
 */
window.mountPlanetSurfaces = (() => {
  // Keep decoded pixels independently of the short-lived ImageBitmaps and DOM
  // mounts. There are only thirty allowed surfaces (at most 7.5 MiB of RGBA pixels).
  const surfaces = new Map();
  const tones=Object.fromEntries(window.portalPlanetStyles.map(style=>[style.id,style.tone]));
  return root => {
    const events = new AbortController();
    root.querySelectorAll('.planet-surface').forEach(canvas => {
      const name = canvas.dataset.surface;
      const tone = tones[name], context = canvas.getContext('2d');
      if (!Object.hasOwn(tones, name) || !context) return;
      canvas.width = canvas.height = 256;
      const paint = surface => {
        context.clearRect(0, 0, 256, 256);
        context.drawImage(surface, 0, 0);
        canvas.dataset.material = 'photo-v3-soft';
      };
      if (surfaces.has(name)) {
        paint(surfaces.get(name));
        return;
      }
      // A cheap shaded disk is visible immediately and remains usable if a PNG
      // fails. It replaces the expensive procedural fallback rendered before.
      const shade = context.createRadialGradient(80, 64, 0, 128, 128, 128);
      shade.addColorStop(0, tone);
      shade.addColorStop(.55, tone);
      shade.addColorStop(1, '#070a12');
      context.fillStyle = shade;
      context.beginPath(); context.arc(128, 128, 127.25, 0, Math.PI * 2); context.fill();
      canvas.dataset.material = 'shaded-fallback';
      fetch(`/assets/textures/surfaces/${name}.png`, {signal: events.signal})
        .then(response => {
          if (!response.ok) throw Error('Surface unavailable');
          return response.blob();
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          try {
            if (events.signal.aborted || !canvas.isConnected) return;
            let surface = surfaces.get(name);
            if (!surface) {
              surface = document.createElement('canvas');
              surface.width = surface.height = 256;
              const cachedContext = surface.getContext('2d');
              if (!cachedContext) { paint(bitmap); return; }
              cachedContext.drawImage(bitmap, 0, 0);
              surfaces.set(name, surface);
            }
            paint(surface);
          } finally { bitmap.close(); }
        })
        .catch(() => {}); // The shaded disk and original hover icon remain available.
    });
    return () => events.abort();
  };
})();
