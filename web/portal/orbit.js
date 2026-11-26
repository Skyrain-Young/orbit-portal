window.dioLayouts ||= {};
window.dioLayouts.orbit = ({root, apps, link, escape, icon, slots, site, onBackgroundPause}) => {
  const planetScale = Number.isFinite(site.planetScale) && site.planetScale > 0 ? site.planetScale : 1;
  const initialSlots=site.galaxies?.main || slots;
  const planets = [
    {position:'core', track:'inner', phase:32, compactPhase:32, mobilePhase:330, tone:'156,232,220'},
    {position:'git', track:'wide', phase:244.1, compactPhase:255.9, mobilePhase:278.6, tone:'239,202,198'},
    {position:'doc', track:'wide', phase:139.9, compactPhase:161.7, mobilePhase:20.4, tone:'177,214,255'},
    {position:'week', track:'wide', phase:93.6, compactPhase:207.6, mobilePhase:201.5, tone:'233,212,176'},
    {position:'flow', track:'inner', phase:196.8, compactPhase:310.1, mobilePhase:239.2, tone:'222,189,236'},
    {position:'gpu', track:'cross', phase:273, compactPhase:55.3, mobilePhase:61.1, tone:'178,207,247'},
    {position:'bi', track:'cross', phase:240.8, compactPhase:24.1, mobilePhase:103.3, tone:'177,214,255'},
    {position:'seek', track:'cross', phase:87.6, compactPhase:293, mobilePhase:21.2, tone:'182,205,255'},
  ].concat(site.galaxies ? [{position:'extra1',track:'wide',phase:25,compactPhase:25,mobilePhase:95,tone:'177,214,255'},{position:'extra2',track:'cross',phase:155,compactPhase:155,mobilePhase:160,tone:'177,214,255'}] : []).map(planet => ({...planet, id:site.galaxies?'seat-'+planet.position:slots[planet.position], appId:initialSlots[planet.position]})).filter(planet => site.galaxies || apps.some(app => app.id === planet.id));
  const trackNames = ['wide', 'cross', 'inner'];
  root.innerHTML = `
    <section class="orbit-layout" aria-label="应用门户" data-view="orbit" data-paused="false">
      <div class="orbit-scene">
        <div class="orbit-atmosphere" aria-hidden="true"></div>
        <svg class="orbit-paths" aria-hidden="true">
          <defs>
            <linearGradient id="orbit-line" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#accdff" stop-opacity=".08"/><stop offset=".4" stop-color="#bbd9ff" stop-opacity=".3"/><stop offset=".75" stop-color="#d6f0ff" stop-opacity=".65"/><stop offset="1" stop-color="#accdff" stop-opacity=".12"/></linearGradient>
          </defs>
          <g class="orbit-world">${trackNames.map(name => `<g data-orbit-ring="${name}">${planets.filter(planet => planet.track === name).map(planet => `<path class="orbit-track orbit-track--${planet.track}" data-orbit-segment="${planet.position}"/>`).join('')}</g>`).join('')}${trackNames.map(name => `<ellipse class="orbit-trail orbit-trail--${name}" data-orbit-trail="${name}" pathLength="100"/>`).join('')}</g>
        </svg>
        <div class="orbit-heading">
          <h1 aria-label="${escape(site.title)}"><button class="orbit-layout-toggle" type="button" aria-label="切换为列表布局" aria-pressed="false"><span class="orbit-dio${site.title !== 'DIO-Space' ? ' orbit-custom-title' : ''}">${site.title === 'DIO-Space' ? 'D<span class="orbit-axis">I</span>O' : escape(site.title)}</span></button>${site.title === 'DIO-Space' ? '<span class="orbit-space">Space</span>' : ''}</h1>
        </div>
        <nav class="orbit-constellation" aria-label="应用入口">${planets.map(planet => {
          const app = apps.find(item => item.id === planet.appId);
          if(!app)return `<div class="orbit-satellite orbit-satellite--${planet.position}" data-planet="${planet.id}"><a class="orbit-app orbit-vacancy" href="#" role="button" data-vacancy="${planet.position}" aria-label="添加应用到轨道虚位"><span class="orbit-lens"><span class="orbit-plus">＋</span></span></a></div>`;
          return `<div class="orbit-satellite orbit-satellite--${planet.position}" data-planet="${planet.id}">${link(app,
            `<span class="orbit-lens"><canvas class="planet-surface" data-surface="${escape(app.surface||planet.position)}" width="224" height="224" aria-hidden="true"></canvas>${icon(app.glyph)}</span><span class="orbit-app-name">${escape(app.name)}</span>`,
            'orbit-app') }</div>`;
        }).join('')}</nav>
      </div>
      <div class="orbit-keyboard-hint" role="img" aria-label="按空格打开全部应用，直接打字搜索应用">
        <div class="orbit-hint-breath" aria-hidden="true">
          <div class="orbit-hint-cycle">
            <span class="orbit-hint-gesture"><kbd class="orbit-hint-space">${icon('space')}</kbd><span class="orbit-hint-arrow">${icon('arrow')}</span>${icon('apps')}</span>
            <span class="orbit-hint-gesture"><kbd class="orbit-hint-type">abc</kbd><span class="orbit-hint-arrow">${icon('arrow')}</span>${icon('search')}</span>
          </div>
        </div>
      </div>
    </section>`;

  const events = new AbortController();
  const {signal} = events;
  const layout = root.querySelector('.orbit-layout');
  const scene = root.querySelector('.orbit-scene');
  let hole, blackHole;
  if(site.blackHole){
    hole = document.createElement('div');
    hole.className = 'orbit-blackhole';
    hole.innerHTML = '<span class="orbit-blackhole-fallback" aria-hidden="true"></span><canvas aria-hidden="true"></canvas><button type="button" aria-label="加速黑洞光晕"></button>';
    scene.append(hole);
    blackHole = window.createPortalBlackHole?.(hole.querySelector('canvas'), {motion:site.motion});
    hole.querySelector('button').addEventListener('click', () => blackHole?.accelerate(), {signal});
  }
  const atmosphere = root.querySelector('.orbit-atmosphere');
  const svg = root.querySelector('.orbit-paths');
  const toggle = root.querySelector('.orbit-layout-toggle');
  const logo = root.querySelector('.orbit-dio');
  const dialog = document.querySelector('.layout-catalog');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const radians = degrees => degrees * Math.PI / 180;
  const mix = (from, to, progress) => from + (to - from) * progress;
  const easeOut = value => value * (2 - value);
  const motionEnabled = () => !reducedMotion.matches && site.motion;
  const camera = {scale:1, x:0, y:0};
  let targetCamera = {...camera};
  const cameraIsMoving = () => camera.scale !== targetCamera.scale || camera.x !== targetCamera.x || camera.y !== targetCamera.y;
  let geometry = {};
  let sceneSize;
  let elapsed = 0;
  let mobile = false;
  let compact = false;
  let hoverPlanet = null;
  let focusPlanet = null;
  let activePlanet = null;
  let previousTime = 0;
  let frame = 0;
  let disposed = false;
  let listTarget = 0;
  let listProgress = 0;
  let transition = null;
  let listGeometry = {};
  let renderedProgress = -1;
  let renderedElapsed = -1;
  const setAttribute = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const setStyle = (node, name, value) => {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  };
  planets.forEach(planet => {
    planet.node = root.querySelector(`[data-planet="${planet.id}"]`);
    planet.anchor = planet.node.querySelector('a');
    if(site.galaxies){
      planet.replace=document.createElement('button');
      planet.replace.type='button';planet.replace.className='orbit-replace';
      planet.replace.dataset.replaceSeat=planet.position;planet.replace.textContent='替换';
      planet.replace.setAttribute('aria-label','替换此位置的应用');
      planet.replace.hidden=!planet.appId;planet.node.append(planet.replace);
      planet.replace.addEventListener('focus',()=>{focusPlanet=planet;setActive();},{signal});
      planet.replace.addEventListener('blur',()=>{if(focusPlanet===planet)focusPlanet=null;setActive();},{signal});
    }
    planet.segment = root.querySelector(`[data-orbit-segment="${planet.position}"]`);
  });
  const tracks = trackNames.map(name => ({
    name,
    ring: root.querySelector(`[data-orbit-ring="${name}"]`),
    trail: root.querySelector(`[data-orbit-trail="${name}"]`),
  }));

  function updateVisibility(){
    if(!site.galaxies)return;
    let vacancies=0;
    for(const planet of planets){
      planet.node.hidden=!planet.appId&&vacancies++>=2;
      planet.segment.style.visibility=planet.node.hidden?'hidden':'';
    }
  }
  updateVisibility();

  const phase = planet => radians(mobile ? planet.mobilePhase : compact ? planet.compactPhase : planet.phase);

  function ringPoint(ring, angle) {
    const x = Math.cos(angle) * ring.rx;
    const y = Math.sin(angle) * ring.ry;
    const rotation = radians(ring.rotation);
    return {
      x:ring.cx + x * Math.cos(rotation) - y * Math.sin(rotation),
      y:ring.cy + x * Math.sin(rotation) + y * Math.cos(rotation),
    };
  }

  function point(planet) {
    const ring = geometry[planet.track];
    return ringPoint(ring, phase(planet) + elapsed / ring.period * tau);
  }

  function syncBackground() {
    // Keep the decorative renderers idle until the camera has returned to the overview.
    const paused = Boolean(activePlanet) || cameraIsMoving();
    if (layout.hasAttribute('data-background-paused') !== paused) {
      layout.toggleAttribute('data-background-paused', paused);
      onBackgroundPause?.(paused);
    }
    blackHole?.setActive(!paused && !transition && !dialog?.open);
  }

  function setActive() {
    const next = transition || layout.dataset.galaxyTravel ? null : hoverPlanet || focusPlanet;
    if (next === activePlanet) return;
    activePlanet = next;
    planets.forEach(planet => {
      if (planet === next) planet.node.dataset.active = 'true';
      else delete planet.node.dataset.active;
    });
    planets.forEach(planet => {
      if (listTarget ? planet === next : next?.track === planet.track) planet.segment.dataset.active = 'true';
      else delete planet.segment.dataset.active;
    });
    if (next && !listTarget) {
      layout.dataset.focused = next.id;
      const p = point(next);
      // Both ends of this camera transition map the hovered planet to this exact pixel.
      // The planet's clickable surface therefore stays beneath the pointer throughout.
      const anchor = {x:p.x * camera.scale + camera.x, y:p.y * camera.scale + camera.y};
      const scale = reducedMotion.matches || !site.motion ? 1 : mobile ? 1.55 : 1.85;
      targetCamera = {scale, x:anchor.x - p.x * scale, y:anchor.y - p.y * scale};
      layout.style.setProperty('--orbit-focus-x', `${anchor.x}px`);
      layout.style.setProperty('--orbit-focus-y', `${anchor.y}px`);
      layout.style.setProperty('--orbit-focus-tone', next.tone);
    } else {
      delete layout.dataset.focused;
      targetCamera = {scale:1, x:0, y:0};
    }
    syncBackground();
    requestFrame();
  }

  function resize() {
    const width = scene.clientWidth;
    const height = scene.clientHeight;
    if (!width || !height) return;
    sceneSize = {width, height};
    mobile = width <= 760;
    compact = !mobile && width <= 1000;
    const left = width * (mobile ? .08 : compact ? .46 : .43);
    const right = width * (mobile ? .92 : .94);
    const gap = mobile ? 22 : Math.min(64, width * .045);
    const columnWidth = (right - left - gap) / 2;
    const rowHeight = mobile ? 98 : Math.min(112, height * .145);
    const visible=planets.filter(planet=>!planet.node.hidden);
    const rows=Math.max(1,Math.ceil(visible.length/2));
    listGeometry = {left, gap, columnWidth, rowHeight, size:(mobile ? 34 : compact ? 42 : 52) * planetScale,
      top:mobile ? Math.max(340, height * .30) : height * .48 - rowHeight * (rows-1)/2};
    const axis = logo.querySelector('.orbit-axis');
    // Letter spacing is negative in the wordmark; exclude its trailing space
    // when locating the visible I, rather than rotating around the whole word.
    logo.style.transformOrigin = axis ? `${axis.offsetLeft + (axis.offsetWidth - parseFloat(getComputedStyle(axis).letterSpacing)) / 2}px 50%` : '50% 50%';
    planets.forEach((planet, index) => {
      const style = getComputedStyle(planet.node);
      planet.size = parseFloat(style.getPropertyValue('--orbit-size')) * planetScale;
      const smallLabels = width <= 360 || (width >= 621 && width <= 760);
      planet.labelSize = planet.position === 'core' ? (smallLabels ? 11 : mobile ? 13 : 15) : (smallLabels ? 9 : mobile ? 10 : 11);
      planet.labelGap = mobile ? 9 : 12;
      const slot=Math.max(0,visible.indexOf(planet));
      const col = Math.floor(slot / rows);
      const row = slot % rows;
      const x = left + col * (columnWidth + gap);
      const y = listGeometry.top + row * rowHeight;
      planet.row = {x:x + listGeometry.size / 2, y, left:x, right:x + columnWidth, lineY:y + rowHeight * .45};
    });
    const cx = width * (mobile ? .5 : width < 1000 ? .63 : .65);
    // Leave a quiet band below the entire orbital system for keyboard hints.
    let cy = height * .48;
    geometry = mobile ? {
      wide:{cx, cy, rx:width * .35, ry:Math.min(height * .15, width * .34), rotation:-20, period:220},
      cross:{cx, cy, rx:width * .29, ry:Math.min(height * .205, width * .47), rotation:28, period:220},
      inner:{cx, cy, rx:width * .23, ry:Math.min(height * .095, width * .23), rotation:-20, period:220},
    } : {
      wide:{cx, cy, rx:Math.min(width * .30, height * .63, width - cx - 64), ry:Math.min(height * .245, width * .14), rotation:-24, period:220},
      cross:{cx, cy, rx:Math.min(width * .255, height * .5, width - cx - 65), ry:Math.min(height * .30, width * .20), rotation:28, period:220},
      inner:{cx, cy, rx:Math.min(width * .17, height * .33), ry:Math.min(height * .15, width * .14), rotation:-24, period:220},
    };
    // Check the whole orbit, including labels, rather than just the current phase.
    const lowerExtent = Math.max(0, ...planets.map(planet => {
      const ring = geometry[planet.track];
      const angle = radians(ring.rotation);
      const below = planet.size / 2 + planet.labelGap + planet.labelSize * 1.4;
      return Math.hypot(ring.rx * Math.sin(angle), ring.ry * Math.cos(angle)) + below;
    }));
    const hint = layout.querySelector('.orbit-keyboard-hint');
    cy = Math.min(cy, hint.offsetTop - 24 - lowerExtent);
    Object.values(geometry).forEach(ring => { ring.cy = cy; });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    tracks.forEach(track => {
      const ring = geometry[track.name];
      for (const attr of ['cx', 'cy', 'rx', 'ry']) track.trail.setAttribute(attr, ring[attr]);
      // Partition each ring at the midpoints between its planets. The same
      // segments unfold into rows, so no replacement layout fades in.
      const members = planets.filter(planet => planet.track === track.name).sort((a, b) => phase(a) - phase(b));
      members.forEach((planet, index) => {
        const angle = phase(planet);
        const before = index ? phase(members[index - 1]) : phase(members.at(-1)) - tau;
        const after = index < members.length - 1 ? phase(members[index + 1]) : phase(members[0]) + tau;
        planet.arc = {start:(before + angle) / 2, end:(angle + after) / 2};
        // One screen-space polyline per resize. Orbital phase is an affine
        // transform of this ellipse, so ordinary frames never rebuild it.
        planet.orbitPath = Array.from({length:65}, (_, step) => {
          const p = ringPoint(ring, mix(planet.arc.start, planet.arc.end, step / 64));
          return `${step ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        }).join(' ');
      });
    });
    renderedProgress = renderedElapsed = -1;
    camera.scale = 1;
    camera.x = camera.y = 0;
    targetCamera = {...camera};
    const next = activePlanet;
    activePlanet = null;
    if (next) setActive();
    render();
    requestFrame();
  }

  function holeGeometry() {
    if (!listTarget) return geometry.wide;
    // Keep the list entry fixed even when a galaxy has fewer occupied rows.
    return {cx:listGeometry.left + (mobile ? 34 : 40),
      cy:mobile ? listGeometry.top - 70 : sceneSize.height * .48 - listGeometry.rowHeight * 2 - 88,
      rx:sceneSize.width - listGeometry.left, ry:listGeometry.rowHeight * 5};
  }

  function render() {
    if (!geometry.wide) return;
    const progress = listProgress;
    const shapeChanged = renderedProgress !== progress;
    const phaseChanged = renderedElapsed !== elapsed;
    const orbit = progress === 0;
    if(hole){
      const hideHole = Boolean(transition || dialog?.open);
      if(hole.hidden !== hideHole)hole.hidden = hideHole;
      if(hideHole&&hole.hasAttribute('data-menu-open'))hole.removeAttribute('data-menu-open');
      const center = holeGeometry();
      setStyle(hole, 'transform', `translate3d(${center.cx * camera.scale + camera.x}px, ${center.cy * camera.scale + camera.y}px, 0) translate(-50%, -50%)`);
    }
    const {columnWidth, size:listSize} = listGeometry;
    const cameraMatrix = `matrix(${camera.scale} 0 0 ${camera.scale} ${camera.x} ${camera.y})`;
    // Composite the track layer during orbit zoom without changing its SVG geometry.
    setStyle(svg, 'transform', orbit && camera.scale !== 1 ?
      `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})` : 'none');
    planets.forEach(planet => {
      const p = point(planet);
      const row = planet.row;
      const x = mix(p.x * camera.scale + camera.x, row.x, progress);
      const y = mix(p.y * camera.scale + camera.y, row.y, progress);
      setStyle(planet.node, 'transform', `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0)`);
      if(planet.replace)setAttribute(planet.replace,'data-side',x>sceneSize.width-100?'left':'right');
      if (shapeChanged) {
        const size = mix(planet.size, listSize, progress);
        planet.node.style.setProperty('--planet-size', `${size}px`);
        planet.node.style.setProperty('--app-width', `${mix(planet.size, columnWidth, progress)}px`);
        planet.node.style.setProperty('--app-height', `${mix(planet.size + planet.labelGap + planet.labelSize * 1.4, listSize, progress)}px`);
        planet.node.style.setProperty('--label-x', `${mix(size / 2, size + (mobile ? 10 : 18), progress)}px`);
        planet.node.style.setProperty('--label-y', `${mix(size + planet.labelGap, size / 2, progress)}px`);
        planet.node.style.setProperty('--label-size', `${mix(planet.labelSize, mobile ? 12 : compact ? 14 : 16, progress)}px`);
        planet.node.style.setProperty('--label-width', `${mix(Math.max(180, columnWidth), columnWidth - listSize - (mobile ? 10 : 18), progress)}px`);
      }
      if (orbit) {
        if (shapeChanged) planet.segment.setAttribute('d', planet.orbitPath);
      } else if (progress === 1) {
        if (shapeChanged) planet.segment.setAttribute('d', `M${row.left},${row.lineY} L${row.right},${row.lineY}`);
      } else {
        // Only the 600 ms list/orbit morph needs interpolated sampled geometry.
        const ring = geometry[planet.track];
        const phaseOffset = elapsed / ring.period * tau;
        const points = [];
        for (let step = 0; step <= 64; step++) {
          const t = step / 64;
          const p = ringPoint(ring, mix(planet.arc.start, planet.arc.end, t) + phaseOffset);
          const px = mix(p.x * camera.scale + camera.x, mix(row.left, row.right, t), progress);
          const py = mix(p.y * camera.scale + camera.y, row.lineY, progress);
          points.push(`${step ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`);
        }
        planet.segment.setAttribute('d', points.join(' '));
      }
    });
    tracks.forEach((track, index) => {
      const ring = geometry[track.name];
      if (phaseChanged || shapeChanged) {
        // R * S * phase * S^-1 * R^-1 rotates around the elliptical track,
        // without changing its outline or the planet's screen-space hit area.
        const phaseDegrees = elapsed / ring.period * 360;
        setAttribute(track.ring, 'transform', orbit ?
          `translate(${ring.cx} ${ring.cy}) rotate(${ring.rotation}) scale(${ring.rx} ${ring.ry}) rotate(${phaseDegrees}) scale(${1 / ring.rx} ${1 / ring.ry}) rotate(${-ring.rotation}) translate(${-ring.cx} ${-ring.cy})` : '');
        setStyle(track.trail, 'stroke-dashoffset', String(-elapsed / ring.period * 100 - index * 31));
      }
      setAttribute(track.trail, 'transform', `${orbit ? '' : cameraMatrix} rotate(${ring.rotation} ${ring.cx} ${ring.cy})`);
      if (shapeChanged) track.trail.style.opacity = String((1 - progress) * .6);
    });
    // Only the atmosphere consumes camera scale; keep this animated property
    // off the common ancestor of every planet, label and statistics widget.
    setStyle(atmosphere, '--orbit-camera', camera.scale.toFixed(4));
    if (shapeChanged) {
      layout.style.setProperty('--list-progress', progress.toFixed(5));
      logo.style.transform = motionEnabled() ? `perspective(800px) rotateY(${progress * 360}deg)` : 'none';
    }
    renderedProgress = progress;
    renderedElapsed = elapsed;
    syncBackground();
  }

  function switchLayout() {
    if(layout.dataset.galaxyTravel)return;
    listTarget = listTarget ? 0 : 1;
    layout.dataset.view = listTarget ? 'list' : 'orbit';
    toggle.setAttribute('aria-pressed', String(Boolean(listTarget)));
    toggle.setAttribute('aria-label', listTarget ? '切换为轨道布局' : '切换为列表布局');
    hoverPlanet = focusPlanet = null;
    // One clock drives the single logo turn and layout morph. Start at click
    // time with immediate motion, and keep reversals continuous and proportionate.
    transition = motionEnabled() ? {from:listProgress, start:performance.now(), duration:600 * Math.max(.2, Math.abs(listTarget - listProgress))} : null;
    layout.toggleAttribute('data-transitioning', Boolean(transition));
    if (!transition) listProgress = listTarget;
    setActive();
    previousTime = performance.now();
    render();
    requestFrame();
  }

  function tick(time) {
    frame = 0;
    if (disposed || document.hidden) return;
    const dt = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
    previousTime = time;
    const returning = !activePlanet && cameraIsMoving();
    const paused = Boolean(listTarget || listProgress || transition || activePlanet || dialog?.open || (site.galaxies&&document.querySelector('dialog[open]')) || layout.dataset.galaxyTravel || returning || !motionEnabled());
    if (layout.dataset.paused !== String(paused)) layout.dataset.paused = String(paused);
    if (!paused) elapsed += dt;
    const blend = reducedMotion.matches || !site.motion ? 1 : 1 - Math.exp(-dt * 5.7);
    for (const key of ['scale', 'x', 'y']) {
      camera[key] += (targetCamera[key] - camera[key]) * blend;
    }
    // Snap the camera as one unit so rounding never nudges the hovered target.
    if (Math.abs(targetCamera.scale - camera.scale) < .0001 &&
        Math.abs(targetCamera.x - camera.x) < .01 && Math.abs(targetCamera.y - camera.y) < .01) {
      Object.assign(camera, targetCamera);
    }
    if (transition) {
      const timeProgress = Math.max(0, Math.min(1, (time - transition.start) / transition.duration));
      listProgress = mix(transition.from, listTarget, easeOut(timeProgress));
      if (timeProgress === 1) {
        transition = null;
        layout.removeAttribute('data-transitioning');
        setActive();
      }
    }
    render();
    const orbitMoving = !layout.dataset.galaxyTravel && !listTarget && !listProgress && !activePlanet && !dialog?.open && !(site.galaxies&&document.querySelector('dialog[open]'));
    if (motionEnabled() && (transition || cameraIsMoving() || orbitMoving)) requestFrame();
    else previousTime = 0;
  }

  function requestFrame() {
    if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(tick);
  }

  planets.forEach(planet => {
    planet.anchor.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      focusPlanet = null;
      hoverPlanet = planet;
      setActive();
    }, {signal});
    planet.node.addEventListener('pointerleave', event => {
      if (event.pointerType === 'touch') return;
      if (hoverPlanet === planet) hoverPlanet = null;
      setActive();
    }, {signal});
    planet.anchor.addEventListener('focus', () => {
      // A mouse click may focus an anchor too. Only keyboard focus should hold the camera.
      if (!planet.anchor.matches(':focus-visible')) return;
      hoverPlanet = null;
      focusPlanet = planet;
      const rect = planet.anchor.getBoundingClientRect();
      const bounds = scene.getBoundingClientRect();
      // A closer view can move the next Tab target offscreen. Restore that target
      // to the overview before approaching it; pointer hover keeps its exact anchor.
      if (rect.left < bounds.left + 16 || rect.right > bounds.right - 16 ||
          rect.top < bounds.top + 16 || rect.bottom > bounds.bottom - 16) {
        camera.scale = 1;
        camera.x = camera.y = 0;
        targetCamera = {...camera};
        activePlanet = null;
        render();
      }
      setActive();
    }, {signal});
    planet.anchor.addEventListener('blur', () => {
      if (focusPlanet === planet) focusPlanet = null;
      setActive();
    }, {signal});
  });
  toggle.addEventListener('click', switchLayout, {signal});
  window.addEventListener('blur', () => {
    hoverPlanet = null;
    setActive();
  }, {signal});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      previousTime = 0;
      requestFrame();
    }
  }, {signal});
  reducedMotion.addEventListener('change', () => {
    transition = null;
    listProgress = listTarget;
    layout.removeAttribute('data-transitioning');
    camera.scale = 1;
    camera.x = camera.y = 0;
    targetCamera = {...camera};
    activePlanet = null;
    setActive();
    previousTime = 0;
    renderedProgress = -1;
    render();
    requestFrame();
  }, {signal});
  const observer = new ResizeObserver(resize);
  observer.observe(scene);
  const dialogObserver = new MutationObserver(() => {
    if (dialog.open) {
      hoverPlanet = null;
      focusPlanet = null;
      setActive();
    }
    requestFrame();
  });
  if (dialog) dialogObserver.observe(dialog, {attributes:true, attributeFilter:['open']});
  let galaxyControls;
  if(site.galaxies&&window.mountGalaxyNavigation){
    const prepareTravel = () => {
      hoverPlanet=focusPlanet=null;
      setActive();
      Object.assign(camera,{scale:1,x:0,y:0});
      targetCamera={...camera};
      previousTime=0;
      render();
    };
    const apply = nextSlots => {
      hoverPlanet=focusPlanet=null;setActive();
      for(const planet of planets){
        const app=apps.find(a=>a.id===nextSlots[planet.position]);
        planet.appId=app?.id;
        if(planet.replace)planet.replace.hidden=!app;
        const anchor=planet.anchor;
        if(app){
          anchor.classList.remove('orbit-vacancy');anchor.removeAttribute('data-vacancy');anchor.removeAttribute('role');anchor.removeAttribute('aria-label');
          anchor.href=app.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.dataset.appId=app.id;
          anchor.innerHTML=`<span class="orbit-lens"><canvas class="planet-surface" data-surface="${escape(app.surface||planet.position)}" width="224" height="224" aria-hidden="true"></canvas>${icon(app.glyph)}</span><span class="orbit-app-name">${escape(app.name)}</span>`;
        }else{
          anchor.classList.add('orbit-vacancy');anchor.href='#';anchor.removeAttribute('target');anchor.removeAttribute('data-app-id');anchor.dataset.vacancy=planet.position;anchor.setAttribute('role','button');anchor.setAttribute('aria-label','添加应用到轨道虚位');
          anchor.innerHTML='<span class="orbit-lens"><span class="orbit-plus">＋</span></span>';
        }
      }
      updateVisibility();
      root.dispatchEvent(new Event('dio:surfaces',{bubbles:true}));
      resize();
    };
    galaxyControls=window.mountGalaxyNavigation({resume:requestFrame,prepareTravel,hole,layout,scene,apps,groups:site.groups,layouts:site.galaxies,apply,geometry:holeGeometry,points:()=>planets.filter(p=>!p.node.hidden).map(p=>({anchor:p.anchor,seat:p.position,...(listTarget?p.row:point(p))})),accelerate:()=>blackHole?.accelerate(.75),motion:motionEnabled});
  }
  resize();
  return () => {
    disposed = true;
    galaxyControls?.stop();
    blackHole?.destroy();
    events.abort();
    observer.disconnect();
    dialogObserver.disconnect();
    cancelAnimationFrame(frame);
  };
};
