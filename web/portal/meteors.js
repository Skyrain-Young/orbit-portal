window.spaceMeteors = (() => {
  const criticalRadius = radius => 9 + radius * 3;

  // The same outline is used while charging and falling, so launch never changes its size.
  function drawStar(context, x, y, radius, {reveal = 1, rotation = 0, opacity = 1} = {}) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    const inset = .24;
    const inner = 1 - reveal * .5;
    // Compensate for the rounded tips so the visible star keeps its original radius.
    const outer = radius / (1 - inset * .5 * (1 - inner * Math.cos(Math.PI / 5)));
    const points = Array.from({length: 10}, (_, index) => {
      const angle = index * Math.PI / 5 - Math.PI / 2;
      const reach = outer * (index % 2 ? inner : 1);
      return {x: Math.cos(angle) * reach, y: Math.sin(angle) * reach};
    });
    context.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      const entryX = point.x + (previous.x - point.x) * inset;
      const entryY = point.y + (previous.y - point.y) * inset;
      if (!index) context.moveTo(entryX, entryY);
      else context.lineTo(entryX, entryY);
      context.quadraticCurveTo(point.x, point.y, point.x + (next.x - point.x) * inset, point.y + (next.y - point.y) * inset);
    }
    context.closePath();
    context.fillStyle = `rgba(255,239,174,${opacity})`;
    context.shadowColor = 'rgba(255,209,105,.7)';
    context.shadowBlur = 10 * reveal;
    context.fill();
    context.restore();
  }

  function create({width, height, startTime, x, y, compact = false, yOffset = 0, critical = false, starRadius = 1, onVisible}) {
    const fromStar = Number.isFinite(x) && Number.isFinite(y);
    const slope = Math.max(.36, Math.min(1.1, height / width * (.63 + Math.random() * .035)));
    const margin = Math.min(100, width * .09);
    const tailLength = Math.min(300, width * .2);
    const startX = fromStar ? x : -margin;
    const startY = fromStar ? y : yOffset + height * (.025 + Math.random() * .08) - margin * slope;
    const endX = width + tailLength;
    const spanX = endX - startX;
    const drop = spanX * slope;

    return {
      startTime,
      onVisible,
      critical,
      duration: compact ? 1250 + Math.random() * 250 : 1700 + Math.random() * 350,
      start: {x: startX, y: startY},
      control: {x: startX + spanX * .48, y: startY + drop * .4},
      end: {x: endX, y: startY + drop},
      tailFraction: compact ? .13 : .18,
      lineWidth: critical ? 2.4 : compact ? 1.15 : 1.9,
      headRadius: critical ? criticalRadius(starRadius) : compact ? 1.3 : 2,
    };
  }

  function pointOnArc(meteor, t) {
    const remaining = 1 - t;
    return {
      x: remaining * remaining * meteor.start.x + 2 * remaining * t * meteor.control.x + t * t * meteor.end.x,
      y: remaining * remaining * meteor.start.y + 2 * remaining * t * meteor.control.y + t * t * meteor.end.y,
    };
  }

  function fillTrail(context, points, width, color, opacity) {
    const tail = points[0];
    const head = points[points.length - 1];
    const gradient = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
    for (const stop of [0, .25, .5, .75, 1]) {
      gradient.addColorStop(stop, `rgba(${color},${Math.pow(stop, 1.8) * opacity})`);
    }

    context.beginPath();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const halfWidth = width * point.taper * .5;
      const x = point.x + point.normalX * halfWidth;
      const y = point.y + point.normalY * halfWidth;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const point = points[index];
      const halfWidth = width * point.taper * .5;
      context.lineTo(point.x - point.normalX * halfWidth, point.y - point.normalY * halfWidth);
    }
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }

  function draw(context, meteors, time) {
    const active = meteors.filter(meteor => time < meteor.startTime + meteor.duration);
    context.save();

    for (const meteor of active) {
      const progress = (time - meteor.startTime) / meteor.duration;
      if (progress < 0) continue;

      const headTime = progress * (.8 + .2 * progress);
      const tailTime = Math.max(0, headTime - meteor.tailFraction);
      const light = meteor.critical ? Math.min(1, (1 - progress) / .18) : Math.pow(Math.sin(Math.PI * progress), .7);
      const points = [];

      // One filled ribbon follows the arc, avoiding overlapping stroke caps along the trail.
      const segments = 36;
      for (let index = 0; index <= segments; index += 1) {
        const alongTail = index / segments;
        const t = tailTime + (headTime - tailTime) * alongTail;
        const point = pointOnArc(meteor, t);
        const tangentX = 2 * ((1 - t) * (meteor.control.x - meteor.start.x) + t * (meteor.end.x - meteor.control.x));
        const tangentY = 2 * ((1 - t) * (meteor.control.y - meteor.start.y) + t * (meteor.end.y - meteor.control.y));
        const length = Math.hypot(tangentX, tangentY);
        points.push({
          ...point,
          normalX: -tangentY / length,
          normalY: tangentX / length,
          taper: Math.pow(alongTail, .8),
        });
      }
      fillTrail(context, points, meteor.lineWidth * 3.1, meteor.critical ? '255,193,89' : '115,159,255', light * .13);
      fillTrail(context, points, meteor.lineWidth, meteor.critical ? '255,223,148' : '205,226,255', light * .9);
      const previous = points[points.length - 1];
      if (light > 0 && meteor.onVisible?.(previous)) meteor.onVisible = undefined;

      const haloRadius = meteor.headRadius * (meteor.critical ? 2.7 : 4.5);
      const halo = context.createRadialGradient(previous.x, previous.y, 0, previous.x, previous.y, haloRadius);
      halo.addColorStop(0, `rgba(${meteor.critical ? '255,211,117' : '184,217,255'},${light * (meteor.critical ? .32 : .68)})`);
      halo.addColorStop(1, 'rgba(136,181,255,0)');
      context.fillStyle = halo;
      context.beginPath();
      context.arc(previous.x, previous.y, haloRadius, 0, Math.PI * 2);
      context.fill();
      if (meteor.critical) {
        drawStar(context, previous.x, previous.y, meteor.headRadius, {rotation: (time - meteor.startTime) * .026, opacity: light});
        continue;
      }
      context.fillStyle = `rgba(243,249,255,${light})`;
      context.beginPath();
      context.arc(previous.x, previous.y, meteor.headRadius * (.75 + light * .25), 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
    return active;
  }

  return {create, draw, drawStar, criticalRadius};
})();
