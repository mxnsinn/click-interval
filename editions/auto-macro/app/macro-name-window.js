const input = document.getElementById('macroNameInput');
const dialog = window.bridge.loadMacroNameDialog() || { mode: 'create', name: '' };
if (dialog.mode === 'rename') {
  document.title = 'Rename Macro';
  document.getElementById('macroNameTitle').textContent = 'Rename Macro';
  document.getElementById('macroNameLabel').textContent = 'New name';
  document.getElementById('createMacro').textContent = 'Save';
  input.value = dialog.name || '';
}
const submit = () => {
  const name = input.value.trim().slice(0, 40) || (dialog.mode === 'create' ? 'My Macro' : '');
  if (!name) return;
  window.bridge.submitMacroName(name);
};

document.getElementById('createMacro').addEventListener('click', submit);
document.getElementById('cancelMacro').addEventListener('click', () => window.bridge.closeCurrentWindow());
input.addEventListener('keydown', event => {
  if (event.key === 'Enter') submit();
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
});
window.addEventListener('DOMContentLoaded', () => {
  input.focus();
  if (dialog.mode === 'rename') input.select();
});
