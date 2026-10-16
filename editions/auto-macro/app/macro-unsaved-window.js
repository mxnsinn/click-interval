document.getElementById('saveChanges').addEventListener('click', () => window.bridge.resolveUnsavedMacro(true));
document.getElementById('discardChanges').addEventListener('click', () => window.bridge.resolveUnsavedMacro(false));
