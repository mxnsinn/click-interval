const selection = document.getElementById('selection');
let start = null;

function rectangle(point) {
  const left = Math.min(start.x, point.x);
  const top = Math.min(start.y, point.y);
  const width = Math.max(1, Math.abs(point.x - start.x));
  const height = Math.max(1, Math.abs(point.y - start.y));
  return { left, top, width, height };
}

function draw(rect) {
  selection.style.display = 'block';
  selection.style.left = `${rect.left}px`;
  selection.style.top = `${rect.top}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  start = { x: event.clientX, y: event.clientY };
  draw(rectangle(start));
});

addEventListener('mousemove', event => {
  if (!start || !(event.buttons & 1)) return;
  draw(rectangle({ x: event.clientX, y: event.clientY }));
});

addEventListener('mouseup', event => {
  if (!start || event.button !== 0) return;
  const rect = rectangle({ x: event.clientX, y: event.clientY });
  start = null;
  if (rect.width < 3 || rect.height < 3) return;
  window.areaPicker.finish({
    canceled: false,
    x: window.screenX + rect.left,
    y: window.screenY + rect.top,
    width: rect.width,
    height: rect.height
  });
});

addEventListener('keydown', event => {
  if (event.key === 'Escape') window.areaPicker.finish({ canceled: true });
});
