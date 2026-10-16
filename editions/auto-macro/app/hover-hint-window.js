window.bridge.onHoverHintContent(payload => {
  const content = document.getElementById('content');
  content.textContent = String(payload?.text || '');
  requestAnimationFrame(() => window.bridge.reportHoverHintPainted(Number(payload?.token) || 0));
});
