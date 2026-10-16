document.getElementById('saveSettingsChanges').addEventListener('click', () => window.bridge.resolveUnsavedSettings('save'));
document.getElementById('discardSettingsChanges').addEventListener('click', () => window.bridge.resolveUnsavedSettings('discard'));
document.getElementById('cancelSettingsClose').addEventListener('click', () => window.bridge.resolveUnsavedSettings('cancel'));
addEventListener('keydown', event => { if (event.key === 'Escape') window.bridge.resolveUnsavedSettings('cancel'); });
