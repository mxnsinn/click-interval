window.bridge.onMessageData(payload => {
  document.title = payload.title || 'Information';
  document.getElementById('popupTitle').textContent = payload.title || 'Information';
  document.getElementById('messageText').textContent = payload.message || '';
  document.getElementById('messageIcon').classList.toggle('visible', payload.icon === 'alert');
});
document.getElementById('okButton').addEventListener('click', () => window.bridge.closeCurrentWindow());
