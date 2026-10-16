const canvas = document.getElementById('overlay');
const context = canvas.getContext('2d');
let config = {};
let aiming = false;
let imageElement = null;
const motion = new window.CrosshairMotion();

function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function loadImage(source) {
  imageElement = null;
  if (!source) return;
  const image = new Image();
  image.onload = () => { imageElement = image; };
  image.src = source;
}
function frame(now) {
  const effect = motion.update(now);
  const effectSpeed = Math.max(.25, Number(config.effectSpeed || 100) / 100);
  const idlePulse = config.animation === 'pulse' ? (Math.sin(now / (260 / effectSpeed)) + 1) * Math.max(0, Number(config.idleScale || 12)) / 100 : 0;
  context.clearRect(0, 0, innerWidth, innerHeight);
  const scoped = aiming ? { barsEnabled: config.scopedBars, dot: config.scopedDot, barColor: config.scopedColor || config.barColor, dotColor: config.scopedColor || config.dotColor } : {};
  if (config.enabled && (!aiming || config.showWhileAiming !== false)) window.CrosshairDraw.draw(context, innerWidth, innerHeight, {
    ...config, ...scoped, imageElement,
    offsetX: Number(config.offsetX || 0) + (config.staticCrosshair ? 0 : effect.x),
    offsetY: Number(config.offsetY || 0) + (config.staticCrosshair ? 0 : effect.y)
  }, Math.max(effect.pulse, idlePulse));
  requestAnimationFrame(frame);
}
window.crosshairOverlay.onConfig(value => { config = value || {}; motion.setConfig(config); loadImage(config.imageData); });
window.crosshairOverlay.onPulse(value => motion.fire(Boolean(value.active)));
window.crosshairOverlay.onAds(value => { aiming = Boolean(value); });
addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
