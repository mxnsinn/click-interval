const dialog = window.bridge.loadMacroDeleteDialog() || { name: 'this macro' };
const noun = dialog.entity === 'server' ? 'Server' : 'Macro';
const title = dialog.title || `Delete ${noun}`;
document.title = title;
document.querySelector('.popup-titlebar').textContent = title;
document.getElementById('deleteQuestion').textContent = dialog.question || `Are you sure you want to delete “${dialog.name}”?`;
document.getElementById('confirmDelete').textContent = dialog.confirmText || 'Delete';
const resetSettingsAvailable = dialog.entity === 'server' && dialog.action === 'wipe';
const resetSettings = document.getElementById('resetServerSettings');
const resetFieldNames = ['serverIcon', 'serverType', 'serverVersion', 'levelName', 'motd', 'publicAddress', 'simulationDistance'];
document.getElementById('resetServerSettingsOption').hidden = !resetSettingsAvailable;
document.getElementById('resetServerSettingsHelp').hidden = !resetSettingsAvailable;
document.getElementById('resetServerFields').hidden = !resetSettingsAvailable;
resetSettings.checked = false;
for (const field of resetFieldNames) document.getElementById(`resetServerField-${field}`).checked = false;
document.body.classList.toggle('reset-data-window', resetSettingsAvailable);
document.getElementById('confirmDelete').addEventListener('click', () => {
  document.getElementById('confirmDelete').disabled = true;
  window.bridge.confirmMacroDelete({
    resetSettings: resetSettingsAvailable && resetSettings.checked,
    resetFields: resetSettingsAvailable ? resetFieldNames.filter(field => document.getElementById(`resetServerField-${field}`).checked === true) : []
  });
});
document.getElementById('cancelDelete').addEventListener('click', () => window.bridge.closeCurrentWindow());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
});
document.getElementById('cancelDelete').focus();
