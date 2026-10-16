(function () {
  function draw(ctx, width, height, config, pulse = 0) {
    ctx.clearRect(0, 0, width, height);
    const scale = Math.max(0, Math.min(4, Number(config.scale ?? 100) / 100)) * (1 + pulse * .18);
    if (scale <= 0) return;
    const cx = width / 2 + Number(config.offsetX || 0);
    const cy = height / 2 + Number(config.offsetY || 0);
    const speed = Math.max(.25, Number(config.effectSpeed || 100) / 100);
    const fade = config.fade ? .82 + Math.sin(performance.now() / (280 / speed)) * .18 : 1;
    const rainbowColor = `hsl(${(performance.now() * .06 * speed) % 360} 100% 60%)`;
    const color = value => config.rainbow ? rainbowColor : value;
    const outlineEnabled = Boolean(config.outline);
    const outlineColor = config.outlineColor || '#000';
    const outlineWidth = Math.max(0, Number(config.outlineSize || 0)) * scale;
    const outlineAlpha = Math.max(0, Math.min(1, Number(config.outlineOpacity ?? 100) / 100));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Number(config.rotation || 0) * Math.PI / 180);
    if (config.animation === 'spin') ctx.rotate((performance.now() % (2400 / speed)) / (2400 / speed) * Math.PI * 2);
    ctx.lineJoin = config.outlineJoin || 'round';
    ctx.shadowBlur = Math.max(0, Number(config.glow || 0)) * scale;

    const stroke = (path, componentColor, widthValue, alpha, cap = 'round') => {
      ctx.lineCap = cap;
      if (outlineEnabled && outlineWidth) {
        ctx.globalAlpha = alpha * outlineAlpha * fade;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = widthValue + outlineWidth * 2;
        ctx.stroke(path);
      }
      ctx.globalAlpha = alpha * fade;
      ctx.strokeStyle = color(componentColor);
      ctx.shadowColor = color(componentColor);
      ctx.lineWidth = widthValue;
      ctx.stroke(path);
    };
    const fill = (path, componentColor, alpha) => {
      if (outlineEnabled && outlineWidth) {
        ctx.globalAlpha = alpha * outlineAlpha * fade;
        ctx.fillStyle = outlineColor;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = outlineWidth * 2;
        ctx.stroke(path);
      }
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = color(componentColor);
      ctx.shadowColor = color(componentColor);
      ctx.fill(path);
    };

    if (config.imageElement) {
      const imageSize = Math.max(8, Number(config.barLength || config.length || 18) * scale * 3);
      ctx.globalAlpha = fade;
      ctx.drawImage(config.imageElement, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
    } else {
      if (config.barsEnabled !== false) {
        const gap = Math.max(0, Number(config.barGap ?? config.gap ?? 6)) * scale;
        const length = Math.max(1, Number(config.barLength ?? config.length ?? 18)) * scale;
        const thickness = Math.max(1, Number(config.barThickness ?? config.thickness ?? 3)) * scale;
        const alpha = Math.max(0, Math.min(1, Number(config.barOpacity ?? config.opacity ?? 100) / 100));
        const cap = config.barShape === 'sharp' ? 'butt' : 'round';
        const segments = [
          ['barTop', 0, -gap, 0, -(gap + length)], ['barBottom', 0, gap, 0, gap + length],
          ['barLeft', -gap, 0, -(gap + length), 0], ['barRight', gap, 0, gap + length, 0]
        ];
        for (const [key, x1, y1, x2, y2] of segments) {
          if (config[key] === false) continue;
          const path = new Path2D(); path.moveTo(x1, y1); path.lineTo(x2, y2);
          stroke(path, config.barColor || config.color || '#00e5ff', thickness, alpha, cap);
        }
      }
      if (config.circleEnabled) {
        const size = Math.max(2, Number(config.circleSize || 28)) * scale;
        const thickness = Math.max(1, Number(config.circleThickness || 2)) * scale;
        const alpha = Math.max(0, Math.min(1, Number(config.circleOpacity ?? 100) / 100));
        const path = new Path2D();
        if (config.circleShape === 'sharp') path.rect(-size / 2, -size / 2, size, size);
        else if (config.circleShape === 'round') path.roundRect(-size / 2, -size / 2, size, size, Math.max(2, size * .2));
        else path.arc(0, 0, size / 2, 0, Math.PI * 2);
        stroke(path, config.circleColor || '#00e5ff', thickness, alpha);
      }
      if (config.dot) {
        const size = Math.max(1, Number(config.dotSize || 4)) * scale;
        const alpha = Math.max(0, Math.min(1, Number(config.dotOpacity ?? 100) / 100));
        const path = new Path2D();
        if (config.dotShape === 'sharp') path.rect(-size / 2, -size / 2, size, size);
        else path.arc(0, 0, size / 2, 0, Math.PI * 2);
        fill(path, config.dotColor || config.color || '#00e5ff', alpha);
      }
    }
    ctx.restore();
  }
  window.CrosshairDraw = { draw };
}());
