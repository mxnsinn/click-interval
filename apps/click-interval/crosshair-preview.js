const canvas = document.getElementById('preview');
const context = canvas.getContext('2d');
const motion = new window.CrosshairMotion();
let config = {};
let imageElement = null;
function loadImage(source) { imageElement = null; if (!source) return; const image = new Image(); image.onload = () => { imageElement = image; }; image.src = source; }
window.crosshairPreviewBridge.onConfig(value => { config = value || {}; motion.setConfig(config); loadImage(config.imageData); });
window.crosshairPreviewBridge.onPulse(value => motion.fire(Boolean(value.active)));
document.getElementById('min').addEventListener('click', () => window.crosshairPreviewBridge.control('minimize'));
document.getElementById('close').addEventListener('click', () => window.crosshairPreviewBridge.control('close'));
function frame(now) { const effect = motion.update(now); const moving = config.staticCrosshair === false; window.CrosshairDraw.draw(context, canvas.width, canvas.height, { ...config, imageElement, offsetX: moving ? effect.x : 0, offsetY: moving ? effect.y : 0 }, effect.pulse); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
