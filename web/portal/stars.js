window.mountSpaceStars = (canvas, {exclude, prepareMeteorBurst, onMeteorBurst, onBackgroundMeteor, onWarp, arrival = false, onArrivalReveal, onArrivalComplete, starDensity = 40, meteorIntervalMin = 10, meteorIntervalMax = 15} = {}) => {
  const context = canvas.getContext('2d');
  if (!context) {
    if (arrival) { onArrivalReveal?.(); onArrivalComplete?.(); }
    return () => {};
  }
  const galaxy = window.createGalaxyField(context, {density: starDensity});

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const events = new AbortController();
  const {signal} = events;
  const colors = ['210,224,255', '172,192,250', '222,205,250'];
  let stars = [];
  let links = [];
  let pointer;
  let hover;
  let width = 0;
  let height = 0;
  let scale = 0;
  let frame = 0;
  let lastPaint = null;
  let nextPaint = 0;
  let paintInterval = 0;
  let paused = false;
  let pausedAt = 0;
  let pausedDuration = 0;
  const animationTime = () => (paused ? pausedAt : performance.now()) - pausedDuration;
  let fading = false;
  let meteors = [];
  let meteorTimer = 0;
  let warpPending = false;
  let attentionVersion = 0;
  let arriving = arrival && !reduceMotion.matches;
  let arrivalElapsed = 0;
  let arrivalRevealed = !arrival;
  let arrivalCompleted = !arrival;

  function revealArrival() {
    if (arrivalRevealed || signal.aborted) return;
    arrivalRevealed = true;
    onArrivalReveal?.();
  }

  function completeArrival() {
    if (arrivalCompleted || signal.aborted) return;
    arriving = false;
    revealArrival();
    arrivalCompleted = true;
    pointer = undefined;
    hover = undefined;
    onArrivalComplete?.();
    scheduleMeteors();
  }

  function buildStars() {
    const previous = stars;
    hover = undefined;
    let seed = 37;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const columns = Math.max(1, Math.round(width / 102));
    const rows = Math.max(1, Math.round(height / 102));
    stars = Array.from({length: columns * rows}, (_, i) => ({
      x: (i % columns + .18 + random() * .64) * width / columns,
      y: (Math.floor(i / columns) + .18 + random() * .64) * height / rows,
      radius: .55 + random() * .8,
      alpha: .19 + random() * .3,
      color: colors[Math.floor(random() * colors.length)],
      phase: random() * Math.PI * 2,
      tempo: .65 + random() * .75,
      twinkle: random() < .23,
      glow: 0,
      charge: 0,
      returnAt: previous[i]?.returnAt ?? 0,
      visibility: previous[i]?.visibility ?? 1,
      neighbors: [],
      degree: 0,
    }));

    const nearby = [];
    stars.forEach((a, i) => {
      for (let j = i + 1; j < stars.length; j += 1) {
        const b = stars[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < 144) nearby.push({a, b, distance});
      }
    });
    // Keep a sparse, fixed network so lines do not rewire as the pointer moves.
    links = nearby.sort((a, b) => a.distance - b.distance).filter(({a, b}) => {
      if (a.degree >= 2 || b.degree >= 2) return false;
      a.degree += 1;
      b.degree += 1;
      a.neighbors.push(b);
      b.neighbors.push(a);
      return true;
    });
  }

  function schedule() {
    if (!paused && !signal.aborted && !frame && !document.hidden && document.hasFocus()) frame = requestAnimationFrame(paint);
  }

  function scheduleMeteors() {
    if (paused || arriving || signal.aborted || meteorTimer || !width || document.hidden || !document.hasFocus() || reduceMotion.matches) return;
    meteorTimer = window.setTimeout(() => {
      meteorTimer = 0;
      if (paused || signal.aborted || document.hidden || !document.hasFocus() || reduceMotion.matches) return;

      const start = animationTime();
      const count = 1 + Math.floor(Math.random() * 2);
      const bounds = canvas.getBoundingClientRect();
      const visibleTop = Math.max(0, -bounds.top);
      const visibleHeight = Math.min(height - visibleTop, innerHeight);
      for (let index = 0; index < count; index += 1) {
        meteors.push(window.spaceMeteors.create({
          width, height: visibleHeight, yOffset: visibleTop, startTime: start + index * 115,
          onVisible: point => {
            if (document.hidden || !document.hasFocus() || signal.aborted) return false;
            const box = canvas.getBoundingClientRect();
            const x = point.x + box.left, y = point.y + box.top, quiet = exclude?.();
            if (x < 0 || x > innerWidth || y < 0 || y > innerHeight) return false;
            if (quiet && x > quiet.left - 28 && x < quiet.right + 28 && y > quiet.top - 28 && y < quiet.bottom + 28) return false;
            onBackgroundMeteor?.();
            return true;
          },
        }));
      }
      schedule();
      scheduleMeteors();
    }, (meteorIntervalMin + Math.random() * (meteorIntervalMax - meteorIntervalMin)) * 1000);
  }

  function stopMeteors() {
    clearTimeout(meteorTimer);
    meteorTimer = 0;
    meteors = [];
  }

  function resize() {
    if (paused) return;
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    if (!nextWidth || !nextHeight) return;
    // Bound the full-screen backing store, especially on Retina / 4K displays.
    // Planet surfaces and text keep their original resolution.
    const nextScale = Math.min(devicePixelRatio || 1, 2, Math.sqrt(2500000 / (nextWidth * nextHeight)));
    if (nextWidth === width && nextHeight === height && nextScale === scale) return;
    width = nextWidth;
    height = nextHeight;
    scale = nextScale;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    buildStars();
    galaxy.resize(width, height, scale);
    schedule();
    scheduleMeteors();
  }

  function dot(x, y, radius, fill) {
    context.fillStyle = fill;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function findHoverChain(bounds, radius) {
    const nearby = stars.filter(star => star.visibility === 1 &&
      Math.hypot(star.x + bounds.left - pointer.x, star.y + bounds.top - pointer.y) < radius * .9);
    nearby.sort((a, b) =>
      Math.hypot(a.x + bounds.left - pointer.x, a.y + bounds.top - pointer.y) -
      Math.hypot(b.x + bounds.left - pointer.x, b.y + bounds.top - pointer.y));
    const seed = nearby.find(star => star.neighbors.some(neighbor => nearby.includes(neighbor)));
    if (!seed) return [];
    const chain = [seed];
    for (let index = 0; index < chain.length && chain.length < 5; index += 1) {
      for (const neighbor of chain[index].neighbors) {
        if (chain.length < 5 && nearby.includes(neighbor) && !chain.includes(neighbor)) chain.push(neighbor);
      }
    }
    return chain;
  }

  function launchHoverChain(time) {
    for (const star of hover.stars) {
      meteors.push(window.spaceMeteors.create({
        width, height, startTime: time, x: star.x, y: star.y, compact: true,
        critical: hover.burst?.critical === true, starRadius: star.radius,
      }));
      star.returnAt = time + 10000;
      star.visibility = 0;
      star.glow = 0;
      star.charge = 0;
    }
    hover.fired = true;
    onMeteorBurst?.(hover.burst ?? hover.stars.length);
  }

  function paint(time) {
    frame = 0;
    if (paused || signal.aborted || !width || document.hidden || !document.hasFocus()) return;
    time -= pausedDuration;
    if(document.querySelector('dialog[open]')){pointer=undefined;hover=undefined;}
    const animate = !reduceMotion.matches;
    const twinkle = animate && finePointer.matches;
    const elapsed = lastPaint === null ? 16 : time - lastPaint;
    // Decorative motion needs 30 fps; interactions and travel get 60 fps.
    // Do not double all canvas work on a 120 / 144 Hz monitor.
    const interval = arriving || galaxy.isWarping() || pointer || fading || meteors.length ? 1000 / 60 : 1000 / 30;
    if (lastPaint === null || interval !== paintInterval) {
      nextPaint = lastPaint === null ? time : lastPaint + interval;
      paintInterval = interval;
    }
    if (animate && time < nextPaint - 1) {
      schedule();
      return;
    }
    // Keep the fractional deadline across screen refreshes (e.g. 75 / 144 Hz).
    // Animation still uses actual elapsed time; late frames never catch up in a loop.
    nextPaint += Math.max(1, Math.floor((time - nextPaint) / interval) + 1) * interval;
    lastPaint = time;
    if (arriving) {
      // Arrival uses the same starfield, without charging or starting gameplay timers.
      arrivalElapsed += Math.max(0, Math.min(64, elapsed));
      context.clearRect(0, 0, width, height);
      galaxy.paint({elapsed, animate, arrival: Math.min(1, arrivalElapsed / 1000)});
      if (arrivalElapsed >= 700) revealArrival();
      if (arrivalElapsed >= 1000) completeArrival();
      schedule();
      return;
    }

    const bounds = pointer && canvas.getBoundingClientRect();
    const radius = Math.min(200, Math.max(142, width * .15));
    let charge = 0;
    if (animate && bounds && hover && !hover.fired) {
      if (!hover.stars.length) {
        hover.stars = findHoverChain(bounds, radius);
        hover.startedAt = time;
        if (hover.stars.length >= 2 && prepareMeteorBurst) {
          const charging = hover;
          charging.preparing = true;
          Promise.resolve().then(() => prepareMeteorBurst(charging.stars.length)).then(burst => {
            if (hover !== charging || signal.aborted) return;
            charging.burst = burst;
            charging.preparing = false;
            charging.preparedAt = animationTime();
            schedule();
          }).catch(() => {
            // A failed connection cancels this charge instead of showing an unrecorded critical hit.
            if (hover === charging && !signal.aborted) { charging.fired = true; charging.preparing = false; schedule(); }
          });
        }
      }
      charge = Math.min(1, (time - hover.startedAt) / 3200);
      if (hover.preparing) charge = Math.min(charge, .76);
      else if (hover.preparedAt) charge = Math.min(charge, .76 + (time - hover.preparedAt) / 768 * .24);
      if (charge === 1 && hover.stars.length >= 2) launchHoverChain(time);
    }
    fading = false;
    for (const star of stars) {
      if (star.returnAt) {
        star.visibility = Math.max(0, Math.min(1, (time - star.returnAt) / 1600));
        if (star.visibility === 1) star.returnAt = 0;
      }
      let target = 0;
      if (bounds && star.visibility > 0) {
        const distance = Math.hypot(star.x + bounds.left - pointer.x, star.y + bounds.top - pointer.y);
        const proximity = Math.max(0, 1 - distance / radius);
        target = proximity * proximity * (3 - 2 * proximity);
      }
      const duration = target > star.glow ? 80 : 235;
      const blend = animate ? 1 - Math.exp(-Math.min(elapsed, 60) / duration) : 1;
      star.glow += (target - star.glow) * blend;
      if (!target && star.glow < .01) star.glow = 0;
      const chargeTarget = hover && !hover.fired && hover.stars.includes(star) ? charge : 0;
      star.charge += (chargeTarget - star.charge) * (animate ? 1 - Math.exp(-elapsed / 110) : 1);
      if (!chargeTarget && star.charge < .01) star.charge = 0;
      fading ||= star.glow > 0 || star.charge > 0;
    }

    context.clearRect(0, 0, width, height);
    // Clip the whole background layer, including hover chains and meteor trails.
    const quiet=exclude?.();
    context.save();
    if(quiet){
      const box=canvas.getBoundingClientRect();
      context.beginPath();context.rect(0,0,width,height);
      context.rect(quiet.left-box.left-28,quiet.top-box.top-28,quiet.width+56,quiet.height+56);
      context.clip('evenodd');
    }
    galaxy.paint({elapsed, animate, pointer: bounds ? {x: pointer.x - bounds.left, y: pointer.y - bounds.top} : undefined});
    context.lineWidth = .9;
    for (const {a, b} of links) {
      const charged = Math.min(a.charge, b.charge);
      const intensity = (Math.min(a.glow, b.glow) + charged * .85) * Math.min(a.visibility, b.visibility);
      if (intensity < .045) continue;
      context.lineWidth = .9 + charged * 1.1;
      context.strokeStyle = `rgba(192,212,255,${Math.min(.96, intensity * .72)})`;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
    for (const star of stars) {
      if (!star.visibility) continue;
      const critical = hover?.burst?.critical === true && !hover.fired && hover.stars.includes(star);
      const reveal = critical ? Math.max(0, Math.min(1, (charge - .76) / .24)) : 0;
      const growth = reveal * reveal * (3 - 2 * reveal);
      const shimmer = twinkle && star.twinkle ? Math.sin(time * .001 * star.tempo + star.phase) * .1 : 0;
      if (star.glow > .08 || star.charge > .01) {
        const haloRadius = star.radius * (5.5 + star.charge * 9) + growth * 18;
        const halo = context.createRadialGradient(star.x, star.y, 0, star.x, star.y, haloRadius);
        halo.addColorStop(0, `rgba(${reveal ? '255,211,117' : star.color},${Math.min(.9, star.glow * .36 + star.charge * .6) * star.visibility})`);
        halo.addColorStop(1, `rgba(${star.color},0)`);
        dot(star.x, star.y, haloRadius, halo);
      }
      const alpha = Math.min(1, star.alpha + shimmer + star.glow * .68 + star.charge * .5) * star.visibility;
      const radius = star.radius + star.glow * .6 + star.charge * 1.5;
      if (reveal) window.spaceMeteors.drawStar(context, star.x, star.y, radius + (window.spaceMeteors.criticalRadius(star.radius) - radius) * growth, {reveal: growth, opacity: alpha});
      else dot(star.x, star.y, radius, `rgba(${star.color},${alpha})`);
    }
    if (animate && meteors.length) meteors = window.spaceMeteors.draw(context, meteors, time);
    context.restore();
    if (animate) schedule();
  }

  function clearPointer() {
    pointer = undefined;
    hover = undefined;
    schedule();
  }

  function updateVisibility() {
    attentionVersion += 1;
    if (document.hidden || !document.hasFocus()) {
      pointer = undefined;
      hover = undefined;
      galaxy.resetMotion();
      stopMeteors();
      cancelAnimationFrame(frame);
      frame = 0;
      lastPaint = null;
      nextPaint = paintInterval = 0;
    } else {
      schedule();
      scheduleMeteors();
    }
  }

  window.addEventListener('pointermove', event => {
    if (paused) return;
    if (arriving) { clearPointer(); return; }
    const quiet=exclude?.();
    if (event.target.closest?.('.player-hud,.player-board,dialog') || event.pointerType === 'touch' || (quiet && event.clientX>quiet.left-28 && event.clientX<quiet.right+28 && event.clientY>quiet.top-28 && event.clientY<quiet.bottom+28)) {
      clearPointer();
      return;
    }
    if (!hover || Math.hypot(event.clientX - hover.x, event.clientY - hover.y) > 18) {
      hover = {x: event.clientX, y: event.clientY, startedAt: animationTime(), stars: [], fired: false};
    }
    pointer = {x: event.clientX, y: event.clientY};
    schedule();
  }, {passive: true, signal});
  window.addEventListener('pointerout', event => {
    if (!event.relatedTarget) clearPointer();
  }, {passive: true, signal});
  window.addEventListener('dblclick', async event => {
    if (paused || arriving || warpPending || signal.aborted || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        reduceMotion.matches || document.hidden || !document.hasFocus() ||
        document.querySelector('dialog[open]')) return;
    if (event.target.closest?.('a,button,input,select,textarea,label,dialog,[role="button"],[role="checkbox"],[contenteditable],.player-hud,.player-board,.orbit-usage')) return;
    const quiet = exclude?.();
    if (quiet && event.clientX > quiet.left - 28 && event.clientX < quiet.right + 28 &&
        event.clientY > quiet.top - 28 && event.clientY < quiet.bottom + 28) return;
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    if (x < 0 || y < 0 || x > width || y > height) return;
    const version = attentionVersion;
    warpPending = true;
    try {
      const approved = onWarp ? await onWarp() : true;
      if (approved !== true || signal.aborted || version !== attentionVersion ||
          reduceMotion.matches || document.hidden || !document.hasFocus() ||
          document.querySelector('dialog[open]')) return;
      pointer = undefined;
      hover = undefined;
      galaxy.warp();
      schedule();
    } catch {
      // Failed or denied charges do not play a free warp.
    } finally {
      warpPending = false;
    }
  }, {passive: true, signal});
  window.addEventListener('blur', updateVisibility, {signal});
  window.addEventListener('focus', updateVisibility, {signal});
  window.addEventListener('scroll', clearPointer, {passive: true, signal});
  window.addEventListener('resize', resize, {signal});
  document.addEventListener('visibilitychange', updateVisibility, {signal});
  reduceMotion.addEventListener('change', () => {
    attentionVersion += 1;
    if (reduceMotion.matches) {
      completeArrival();
      galaxy.resetMotion();
      stopMeteors();
      hover = undefined;
      for (const star of stars) {
        star.returnAt = 0;
        star.visibility = 1;
        star.charge = 0;
      }
    }
    else scheduleMeteors();
    schedule();
  }, {signal});
  finePointer.addEventListener('change', schedule, {signal});
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  if (arrival && !arriving) completeArrival();

  function setPaused(value) {
    if (signal.aborted || paused === Boolean(value)) return;
    attentionVersion += 1;
    if (value) {
      pausedAt = performance.now();
      paused = true;
      pointer = undefined;
      hover = undefined;
      clearTimeout(meteorTimer);
      meteorTimer = 0;
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      // Keep existing meteor trajectories and star return times on a frozen clock.
      pausedDuration += performance.now() - pausedAt;
      paused = false;
      lastPaint = null;
      nextPaint = paintInterval = 0;
      resize();
      schedule();
      scheduleMeteors();
    }
  }

  const stop = () => {
    events.abort();
    observer.disconnect();
    galaxy.resetMotion();
    stopMeteors();
    cancelAnimationFrame(frame);
  };
  stop.setPaused = setPaused;
  return stop;
};
