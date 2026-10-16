window.bridge.onCustomDropdownData(payload => {
  const container = document.getElementById('options');
  container.classList.toggle('scrollable', Boolean(payload.scrollable));
  container.classList.remove('ready');
  container.replaceChildren();
  for (const source of payload.options || []) {
    if (source.separator) {
      const separator = document.createElement('div');
      separator.className = 'option-separator';
      separator.setAttribute('role', 'separator');
      container.appendChild(separator);
      continue;
    }
    const option = document.createElement('button');
    option.type = 'button';
    option.disabled = Boolean(source.disabled);
    if (source.icon) {
      const icons = {
        lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"/></svg>',
        unlock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M10.8 7V5.2a2.8 2.8 0 0 0-5.3-1.3"/></svg>',
        external: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5"/><path d="M12 9v3H4V4h3"/></svg>',
        pin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6l-1.2 3 2.2 2.2v1H8.8V14L8 15l-.8-1V8.7H4v-1l2.2-2.2z"/></svg>',
        unpin: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6l-1.2 3 2.2 2.2v1H8.8V14L8 15l-.8-1V8.7H4v-1l2.2-2.2zM2.5 2.5l11 11"/></svg>'
      };
      option.innerHTML = `${icons[source.icon] || ''}<span></span>`;
      option.querySelector('span').textContent = source.label;
    } else option.textContent = source.label;
    option.classList.toggle('selected', String(source.value) === String(payload.value));
    option.addEventListener('click', () => window.bridge.selectCustomDropdownOption(source.value));
    container.appendChild(option);
  }
  container.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  if (payload.scrollable) setTimeout(() => container.classList.add('ready'), 180);
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.bridge.closeCustomDropdown();
});
