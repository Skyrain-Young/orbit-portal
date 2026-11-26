// A decorative depth field; the foreground constellation keeps its own interactions.
window.createGalaxyField = (context, {density = 40} = {}) => {
  const starDensity = Number.isFinite(density) ? Math.max(10, Math.min(100, density)) : 40;
  const colors = ['209,229,255', '179,204,255', '222,210,255'];
  const bands = [
    {radius: .54, alpha: .35, flight: .006, rotation: .0018},
    {radius: .83, alpha: .48, flight: .008, rotation: .0025},
    {radius: 1.12, alpha: .61, flight: .011, rotation: .0032},
  ];
  let width = 0;
  let height = 0;
  let ratio = 1;
  let time = 0;
  let flightTime = 0;
  let boost = 0;
  let stars = [];
  let sprites = [];

  const smooth = value => {
    const bounded = Math.max(0, Math.min(1, value));
    return bounded * bounded * (3 - 2 * bounded);
  };

  function makeSprite(color, flare) {
    const canvas = document.createElement('canvas');
    const size = 64;
    canvas.width = canvas.height = Math.round(size * ratio);
    const brush = canvas.getContext('2d');
    if (!brush) return canvas;
    brush.scale(ratio, ratio);
    const center = size / 2;
    const glow = brush.createRadialGradient(center, center, 0, center, center, 30);
    glow.addColorStop(0, `rgba(${color},1)`);
    glow.addColorStop(.045, `rgba(${color},.95)`);
    glow.addColorStop(.09, `rgba(${color},.35)`);
    glow.addColorStop(.22, `rgba(${color},.085)`);
    glow.addColorStop(.55, `rgba(${color},.018)`);
    glow.addColorStop(1, `rgba(${color},0)`);
    brush.fillStyle = glow;
    brush.fillRect(0, 0, size, size);
    if (flare) {
      brush.translate(center, center);
      for (let axis = 0; axis < 4; axis += 1) {
        brush.save();
        brush.rotate(axis * Math.PI / 4);
        const reach = axis % 2 ? 10 : 20;
        const ray = brush.createLinearGradient(-reach, 0, reach, 0);
        ray.addColorStop(0, `rgba(${color},0)`);
        ray.addColorStop(.43, `rgba(${color},.1)`);
        ray.addColorStop(.5, `rgba(${color},${axis % 2 ? .34 : .64})`);
        ray.addColorStop(.57, `rgba(${color},.1)`);
        ray.addColorStop(1, `rgba(${color},0)`);
        brush.fillStyle = ray;
        brush.fillRect(-reach, -.3, reach * 2, .6);
        brush.restore();
      }
    }
    return canvas;
  }

  function resize(nextWidth, nextHeight, pixelRatio = 1) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    const nextRatio = Math.max(1, Math.min(2, pixelRatio || 1));
    if (!sprites.length || nextRatio !== ratio) {
      ratio = nextRatio;
      sprites = colors.map(color => [makeSprite(color, false), makeSprite(color, true)]);
    }
    let seed = 0xd105face;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    const phone = width < 600;
    const budget = Math.min(phone ? 150 : 600, Math.max(phone ? 95 : 190, width * height / 2350));
    const count = Math.round(budget * starDensity / 100);
    stars = Array.from({length: count}, (_, index) => {
      const band = bands[index % bands.length];
      const color = random();
      return {
        // Overscan keeps all three depth bands populated near the viewport edges.
        x: (random() - .5) * 1.65,
        y: (random() - .5) * 1.65,
        phase: random(),
        shimmer: random() * Math.PI * 2,
        tempo: .45 + random() * .8,
        radius: band.radius * (.65 + random() * .65),
        alpha: band.alpha * (.6 + random() * .4),
        color: color < .68 ? 0 : color < .9 ? 1 : 2,
        flare: index % 31 === 0,
        band,
        pushX: 0,
        pushY: 0,
      };
    });
    resetMotion();
  }

  function warp() {
    if (width && height) boost = Math.min(1.6, boost + 1);
  }

  function resetMotion() {
    boost = 0;
    for (const star of stars) star.pushX = star.pushY = 0;
  }

  function paint({elapsed = 0, animate = true, pointer, arrival} = {}) {
    if (!width || !height) return;
    const delta = animate ? Math.max(0, Math.min(64, elapsed)) / 1000 : 0;
    if (!animate) resetMotion();
    const intro = animate && Number.isFinite(arrival) ? Math.max(0, Math.min(1, arrival)) : null;
    const introBoost = intro === null ? 0 : .9 * smooth((intro - .1) / .2) * (1 - smooth((intro - .5) / .5));
    const projection = intro === null ? 1 : .12 + .88 * smooth((intro - .1) / .62);
    const visibility = intro === null ? 1 : smooth((intro - .1) / .22) * (.35 + projection * .65);
    time += delta;
    // A jump crosses several depth layers before easing back into the idle drift.
    flightTime += delta * (1 + Math.max(boost, introBoost) * 300);
    boost *= Math.exp(-delta * .9);
    if (boost < .006) boost = 0;
    const flightBoost = Math.max(boost, introBoost);
    const stretch = 1 + flightBoost * 10.5;
    const follow = 1 - Math.exp(-delta / .18);
    const focalX = width * .5;
    const focalY = height * .46;
    const influence = Math.min(180, Math.max(100, width * .13));
    if (!visibility) return;
    const diagonal = Math.hypot(width, height);
    const revealRadius = intro === null ? diagonal : diagonal * .72 * smooth((intro - .1) / .6);
    const revealFeather = Math.max(12, diagonal * .08);
    context.save();
    context.globalCompositeOperation = 'screen';
    for (const star of stars) {
      const progress = (star.phase + flightTime * star.band.flight) % 1;
      const depth = 1.28 - progress * .56;
      const perspective = 1 / depth;
      const angle = time * star.band.rotation;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const baseX = star.x * width;
      const baseY = star.y * height;
      const x = focalX + (baseX * cosine - baseY * sine) * perspective * projection;
      const y = focalY + (baseX * sine + baseY * cosine) * perspective * projection;
      const radialVisibility = intro === null ? 1 : 1 - smooth((Math.hypot(x - focalX, y - focalY) - revealRadius) / revealFeather);
      if (!radialVisibility) continue;
      let pushX = 0;
      let pushY = 0;
      if (animate && pointer && intro === null) {
        const awayX = x - pointer.x;
        const awayY = y - pointer.y;
        const distance = Math.hypot(awayX, awayY);
        if (distance > .01 && distance < influence) {
          const strength = 16 * smooth(1 - distance / influence);
          pushX = awayX / distance * strength;
          pushY = awayY / distance * strength;
        }
      }
      if (animate) {
        star.pushX += (pushX - star.pushX) * follow;
        star.pushY += (pushY - star.pushY) * follow;
      } else {
        star.pushX = 0;
        star.pushY = 0;
      }
      const fade = smooth(progress / .12) * smooth((1 - progress) / .14);
      const shimmer = 1 + Math.sin(time * star.tempo + star.shimmer) * .2;
      const radius = star.radius * perspective;
      const size = radius * 35.5;
      const drawX = x + star.pushX - size / 2;
      const drawY = y + star.pushY - size / 2;
      const reach = size * stretch / 2;
      if (x + star.pushX - reach > width || y + star.pushY - reach > height ||
          x + star.pushX + reach < 0 || y + star.pushY + reach < 0) continue;
      context.globalAlpha = Math.min(1, star.alpha * fade * shimmer * (1 + Math.min(flightBoost, 1) * .23)) * visibility * radialVisibility;
      if (flightBoost) {
        // Stretch only the decorative stars along their flight from the fixed focal point.
        context.save();
        context.translate(x + star.pushX, y + star.pushY);
        context.rotate(Math.atan2(y - focalY, x - focalX));
        const length = size * stretch;
        const thickness = size / Math.pow(stretch, .45);
        context.drawImage(sprites[star.color][0], -length / 2, -thickness / 2, length, thickness);
        context.restore();
      } else {
        context.drawImage(sprites[star.color][star.flare ? 1 : 0], drawX, drawY, size, size);
      }
    }
    context.restore();
  }

  return {resize, paint, warp, resetMotion, isWarping: () => boost > 0};
};
