const dialog = window.bridge.loadMacroDeleteDialog() || { name: 'this macro' };
document.getElementById('deleteQuestion').textContent = `Are you sure you want to delete “${dialog.name}”?`;
document.getElementById('confirmDelete').addEventListener('click', () => window.bridge.confirmMacroDelete());
document.getElementById('cancelDelete').addEventListener('click', () => window.bridge.closeCurrentWindow());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.bridge.closeCurrentWindow();
});
