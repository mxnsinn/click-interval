const input = document.getElementById('macroNameInput');
const select = document.getElementById('macroNameSelect');
const dialog = window.bridge.loadMacroNameDialog() || { mode: 'create', name: '' };
const noun = dialog.entity === 'crosshair' ? 'Crosshair' : dialog.entity === 'server' ? 'Server' : 'Macro';
const defaultName = dialog.entity === 'crosshair' ? 'My Crosshair' : dialog.entity === 'server' ? 'My Server' : 'My Macro';
const createFallback = dialog.entity === 'server' && dialog.action !== 'create' ? '' : defaultName;
const title = dialog.title || `New ${noun}`;
document.title = title;
document.getElementById('macroNameTitle').textContent = title;
document.getElementById('macroNameLabel').textContent = dialog.label || `${noun} name`;
input.placeholder = dialog.placeholder || defaultName;
input.maxLength = Math.max(1, Math.min(1024, Number(dialog.maxLength) || (dialog.secret ? 256 : 40)));
document.getElementById('createMacro').textContent = dialog.confirmText || 'Create';
if (dialog.name) input.value = dialog.name;
if (Array.isArray(dialog.options) && dialog.options.length) {
  input.hidden = true;
  select.hidden = false;
  for (const option of dialog.options) {
    const element = document.createElement('option');
    element.value = String(option.value || '');
    element.textContent = String(option.label || option.value || '');
    select.append(element);
  }
  if (dialog.name && [...select.options].some(option => option.value === dialog.name)) select.value = dialog.name;
}
if (dialog.inputType === 'datetime-local') {
  input.type = 'datetime-local';
  if (dialog.inputMin) input.min = dialog.inputMin;
  if (dialog.inputMax) input.max = dialog.inputMax;
  input.autocomplete = 'off';
  input.spellcheck = false;
}
if (dialog.secret) {
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
}
if (dialog.mode === 'rename') {
  document.title = dialog.title || `Rename ${noun}`;
  document.getElementById('macroNameTitle').textContent = dialog.title || `Rename ${noun}`;
  document.getElementById('macroNameLabel').textContent = dialog.label || 'New name';
  document.getElementById('createMacro').textContent = dialog.confirmText || 'Save';
  input.value = dialog.name || '';
}
const submit = () => {
  const control = select.hidden ? input : select;
  const name = control.value.trim().slice(0, input.maxLength) || (dialog.mode === 'create' ? createFallback : '');
  if (!name) return;
  window.bridge.submitMacroName(name);
};

document.getElementById('createMacro').addEventListener('click', submit);
document.getElementById('cancelMacro').addEventListener('click', () => window.bridge.closeCurrentWindow());
input.addEventListener('keydown', event => {
  if (event.key === 'Enter') submit();
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
});
select.addEventListener('keydown', event => {
  if (event.key === 'Enter') submit();
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
});
window.addEventListener('DOMContentLoaded', () => {
  const control = select.hidden ? input : select;
  control.focus();
  if (dialog.mode === 'rename' && control === input) input.select();
});
