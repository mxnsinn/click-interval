'use strict';

const status = document.getElementById('status');
const fill = document.getElementById('fill');
const close = document.getElementById('close');

window.clickIntervalUpdater.onProgress(value => {
  const amount = Math.max(0, Math.min(100, Number(value?.value) || 0));
  fill.style.width = `${amount}%`;
  status.textContent = String(value?.message || 'Updating...');
  if (value?.failed) {
    document.body.classList.add('failed');
    close.hidden = false;
  }
});

close.addEventListener('click', () => window.clickIntervalUpdater.close());
