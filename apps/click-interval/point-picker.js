const messages = {
  en: 'Click the exact overlay position · Esc to cancel',
  ar: 'انقر على موضع المؤشر الدقيق · Esc للإلغاء',
  fr: 'Cliquez sur la position exacte · Échap pour annuler',
  ru: 'Щёлкните точное положение · Esc для отмены'
};
const language = messages[window.pointPicker.language] ? window.pointPicker.language : 'en';
document.documentElement.lang = language;
document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
document.getElementById('hint').textContent = messages[language];

addEventListener('mousedown', event => {
  if (event.button !== 0) return;
  window.pointPicker.finish({
    canceled: false,
    x: window.screenX + event.clientX,
    y: window.screenY + event.clientY
  });
});

addEventListener('keydown', event => {
  if (event.key === 'Escape') window.pointPicker.finish({ canceled: true });
});
