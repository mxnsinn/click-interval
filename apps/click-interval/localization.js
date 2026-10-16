(function () {
  const translations = {
    ar: {
      'Auto Clicker': 'النقر التلقائي', 'Macro': 'الماكرو', 'Settings': 'الإعدادات', 'Application': 'التطبيق',
      'Language': 'اللغة', 'Application language': 'لغة التطبيق', 'English': 'الإنجليزية', 'Arabic': 'العربية', 'French': 'الفرنسية', 'Russian': 'الروسية',
      'Always above everything': 'دائماً فوق النوافذ', 'Keep Click Interval over other windows and fullscreen apps.': 'إبقاء Click Interval فوق النوافذ الأخرى وتطبيقات ملء الشاشة.',
      'Update automatically': 'التحديث تلقائياً', 'Install trusted Click Interval updates when they become available.': 'تثبيت تحديثات Click Interval الموثوقة عند توفرها.',
      'Open after updating': 'الفتح بعد التحديث', 'Launch the newly updated version when installation finishes.': 'تشغيل الإصدار المحدّث بعد انتهاء التثبيت.',
      'Background tools': 'أدوات الخلفية', 'The open tab always works. Select any other tools that should keep working at the same time.': 'تعمل علامة التبويب المفتوحة دائماً. اختر الأدوات الأخرى التي يجب أن تعمل في الوقت نفسه.',
      'Active indicator': 'مؤشر النشاط', 'Show mouse logo while clicking': 'إظهار شعار الفأرة أثناء النقر', 'Logo position': 'موضع الشعار',
      'Show live CPS while clicking': 'إظهار النقرات في الثانية أثناء النقر', 'Include my physical clicks': 'تضمين نقراتي الفعلية', 'Show CPS continuously': 'إظهار CPS باستمرار', 'CPS display': 'عرض CPS', 'Total CPS': 'إجمالي CPS', 'Left | Right': 'يسار | يمين', 'CPS position': 'موضع CPS', 'Theme': 'السمة', 'Save': 'حفظ', 'Cancel': 'إلغاء',
      'Click interval': 'الفاصل الزمني للنقر', 'Click options': 'خيارات النقر', 'Mouse button:': 'زر الفأرة:', 'Click type:': 'نوع النقر:',
      'Left': 'الأيسر', 'Right': 'الأيمن', 'Middle': 'الأوسط', 'Single': 'مفرد', 'Double': 'مزدوج', 'Random offset': 'إزاحة عشوائية',
      'Cursor position': 'موضع المؤشر', 'Current location': 'الموقع الحالي', 'Pick location': 'اختيار موقع', 'Start': 'بدء', 'Stop': 'إيقاف',
      'Hotkey setting': 'إعداد الاختصار', 'Emergency Stop': 'إيقاف طارئ', 'Your macros': 'وحدات الماكرو', 'No macros yet. Press + to create one.': 'لا توجد وحدات ماكرو بعد. اضغط + لإنشاء واحدة.',
      'hours': 'ساعات', 'mins': 'دقائق', 'secs': 'ثوانٍ', 'milliseconds': 'مللي ثانية', 'CPS cap & emergency stop': 'حد CPS والإيقاف الطارئ',
      'CPS cap:': 'حد CPS:', 'Emergency:': 'الطوارئ:', 'Start (Q)': 'بدء (Q)', 'Stop (Q)': 'إيقاف (Q)',
      'Emergency Stop (Ctrl + Shift + F12)': 'إيقاف طارئ (Ctrl + Shift + F12)',
      'Record': 'تسجيل', 'Play': 'تشغيل', 'Open file': 'فتح ملف', 'Settings': 'الإعدادات', 'Repeat': 'التكرار', 'Playback': 'التشغيل',
      'Repeat count': 'عدد مرات التكرار', 'Constant repeat': 'تكرار مستمر', 'Loop delay': 'تأخير الحلقة', 'Speed': 'السرعة', 'Start delay': 'تأخير البدء',
      'Timing variance': 'تفاوت التوقيت', 'Minimize app': 'تصغير التطبيق', 'Restore cursor': 'استعادة المؤشر', 'Stop on input': 'الإيقاف عند الإدخال',
      'Record & playback': 'التسجيل والتشغيل', 'Quality': 'الجودة', 'Hotkeys': 'الاختصارات', 'Advanced editor': 'المحرر المتقدم',
      'Top left': 'أعلى اليسار', 'Top right': 'أعلى اليمين', 'Center': 'الوسط', 'Bottom left': 'أسفل اليسار', 'Bottom right': 'أسفل اليمين',
      'Open a macro file': 'فتح ملف ماكرو', 'Create a new macro': 'إنشاء ماكرو جديد', 'Saved macros': 'وحدات الماكرو المحفوظة',
      'Back to saved macros': 'العودة إلى وحدات الماكرو المحفوظة', 'Save macro': 'حفظ الماكرو', 'Open advanced editor': 'فتح المحرر المتقدم',
      'Not saved': 'غير محفوظ', 'None': 'بلا', 'Compact': 'مضغوط', 'Balanced': 'متوازن', 'Smooth': 'سلس', 'Ultra': 'فائق',
      'Hide Click Interval when playback starts': 'إخفاء Click Interval عند بدء التشغيل',
      'Return the cursor to its starting position when playback ends': 'إعادة المؤشر إلى موضع البداية عند انتهاء التشغيل',
      'Stop playback when physical keyboard or mouse input is detected': 'إيقاف التشغيل عند اكتشاف إدخال فعلي من لوحة المفاتيح أو الفأرة',
      'Record / Stop: Ctrl + F10': 'تسجيل / إيقاف: Ctrl + F10', 'Play / Stop: Ctrl + F11': 'تشغيل / إيقاف: Ctrl + F11',
      'Hotkey Setting': 'إعداد الاختصار', 'Start / Stop': 'بدء / إيقاف', 'Ok': 'موافق', 'New Macro': 'ماكرو جديد',
      'Macro name': 'اسم الماكرو', 'My Macro': 'الماكرو الخاص بي', 'Create': 'إنشاء', 'Delete Macro': 'حذف الماكرو', 'Delete': 'حذف',
      'Unsaved Changes': 'تغييرات غير محفوظة', "You didn't save your changes. Would you like to save?": 'لم تحفظ تغييراتك. هل تريد حفظها؟',
      'Yes': 'نعم', 'No': 'لا', 'Unsaved Settings': 'إعدادات غير محفوظة',
      'You have unsaved settings. Would you like to save them before closing?': 'لديك إعدادات غير محفوظة. هل تريد حفظها قبل الإغلاق؟',
      "Don't save": 'عدم الحفظ', 'Information': 'معلومات', 'Light': 'فاتح',
      'Trigger': 'المشغّل', 'When:': 'عند:', 'Keys:': 'المفاتيح:', 'Enable global trigger': 'تمكين المشغّل العام', 'Record settings': 'إعدادات التسجيل',
      'Movement': 'الحركة', 'Buttons': 'الأزرار', 'Keyboard': 'لوحة المفاتيح', 'Delays': 'التأخيرات', 'Absolute': 'مطلق', 'Relative': 'نسبي',
      'Actions': 'الإجراءات', 'Wait': 'انتظار', 'Add': 'إضافة', 'Pressed': 'ضغطة', 'Hold': 'ضغط مستمر', 'Toggle': 'تبديل'
    },
    fr: {
      'Auto Clicker': 'Clic automatique', 'Macro': 'Macro', 'Settings': 'Paramètres', 'Application': 'Application',
      'Language': 'Langue', 'Application language': "Langue de l’application", 'English': 'Anglais', 'Arabic': 'Arabe', 'French': 'Français', 'Russian': 'Russe',
      'Always above everything': 'Toujours au premier plan', 'Keep Click Interval over other windows and fullscreen apps.': 'Garder Click Interval au-dessus des autres fenêtres et applications en plein écran.',
      'Update automatically': 'Mettre à jour automatiquement', 'Install trusted Click Interval updates when they become available.': 'Installer les mises à jour fiables de Click Interval lorsqu’elles sont disponibles.',
      'Open after updating': 'Ouvrir après la mise à jour', 'Launch the newly updated version when installation finishes.': 'Lancer la nouvelle version après l’installation.',
      'Background tools': 'Outils en arrière-plan', 'The open tab always works. Select any other tools that should keep working at the same time.': 'L’onglet ouvert fonctionne toujours. Sélectionnez les autres outils à maintenir actifs.',
      'Active indicator': 'Indicateur d’activité', 'Show mouse logo while clicking': 'Afficher le logo de la souris pendant les clics', 'Logo position': 'Position du logo',
      'Show live CPS while clicking': 'Afficher les CPS pendant les clics', 'Include my physical clicks': 'Inclure mes clics physiques', 'Show CPS continuously': 'Afficher les CPS en continu', 'CPS display': 'Affichage CPS', 'Total CPS': 'CPS total', 'Left | Right': 'Gauche | Droite', 'CPS position': 'Position des CPS', 'Theme': 'Thème', 'Save': 'Enregistrer', 'Cancel': 'Annuler',
      'Click interval': 'Intervalle de clic', 'Click options': 'Options de clic', 'Mouse button:': 'Bouton de la souris :', 'Click type:': 'Type de clic :',
      'Left': 'Gauche', 'Right': 'Droite', 'Middle': 'Milieu', 'Single': 'Simple', 'Double': 'Double', 'Random offset': 'Décalage aléatoire',
      'Cursor position': 'Position du curseur', 'Current location': 'Position actuelle', 'Pick location': 'Choisir une position', 'Start': 'Démarrer', 'Stop': 'Arrêter',
      'Hotkey setting': 'Raccourci clavier', 'Emergency Stop': 'Arrêt d’urgence', 'Your macros': 'Vos macros', 'No macros yet. Press + to create one.': 'Aucune macro. Appuyez sur + pour en créer une.',
      'hours': 'h', 'mins': 'min', 'secs': 's', 'milliseconds': 'millisecondes', 'CPS cap & emergency stop': 'Limite CPS et arrêt d’urgence',
      'CPS cap:': 'Limite CPS :', 'Emergency:': 'Urgence :', 'Start (Q)': 'Démarrer (Q)', 'Stop (Q)': 'Arrêter (Q)',
      'Emergency Stop (Ctrl + Shift + F12)': 'Arrêt d’urgence (Ctrl + Shift + F12)',
      'Record': 'Enregistrer', 'Play': 'Lire', 'Open file': 'Ouvrir un fichier', 'Repeat': 'Répétition', 'Playback': 'Lecture', 'Repeat count': 'Nombre de répétitions',
      'Constant repeat': 'Répétition continue', 'Loop delay': 'Délai de boucle', 'Speed': 'Vitesse', 'Start delay': 'Délai de démarrage', 'Timing variance': 'Variation du minutage',
      'Minimize app': 'Réduire l’application', 'Restore cursor': 'Restaurer le curseur', 'Stop on input': 'Arrêter à la saisie', 'Record & playback': 'Enregistrement et lecture',
      'Quality': 'Qualité', 'Hotkeys': 'Raccourcis', 'Advanced editor': 'Éditeur avancé', 'Top left': 'En haut à gauche', 'Top right': 'En haut à droite',
      'Center': 'Centre', 'Bottom left': 'En bas à gauche', 'Bottom right': 'En bas à droite',
      'Open a macro file': 'Ouvrir un fichier macro', 'Create a new macro': 'Créer une macro', 'Saved macros': 'Macros enregistrées',
      'Back to saved macros': 'Retour aux macros enregistrées', 'Save macro': 'Enregistrer la macro', 'Open advanced editor': 'Ouvrir l’éditeur avancé',
      'Not saved': 'Non enregistrée', 'None': 'Aucun', 'Compact': 'Compact', 'Balanced': 'Équilibré', 'Smooth': 'Fluide', 'Ultra': 'Ultra',
      'Hide Click Interval when playback starts': 'Masquer Click Interval au début de la lecture',
      'Return the cursor to its starting position when playback ends': 'Ramener le curseur à sa position initiale après la lecture',
      'Stop playback when physical keyboard or mouse input is detected': 'Arrêter la lecture lors d’une saisie physique au clavier ou à la souris',
      'Record / Stop: Ctrl + F10': 'Enregistrer / Arrêter : Ctrl + F10', 'Play / Stop: Ctrl + F11': 'Lire / Arrêter : Ctrl + F11',
      'Hotkey Setting': 'Réglage du raccourci', 'Start / Stop': 'Démarrer / Arrêter', 'Ok': 'OK', 'New Macro': 'Nouvelle macro',
      'Macro name': 'Nom de la macro', 'My Macro': 'Ma macro', 'Create': 'Créer', 'Delete Macro': 'Supprimer la macro', 'Delete': 'Supprimer',
      'Unsaved Changes': 'Modifications non enregistrées', "You didn't save your changes. Would you like to save?": 'Vous n’avez pas enregistré vos modifications. Voulez-vous les enregistrer ?',
      'Yes': 'Oui', 'No': 'Non', 'Unsaved Settings': 'Paramètres non enregistrés',
      'You have unsaved settings. Would you like to save them before closing?': 'Des paramètres ne sont pas enregistrés. Voulez-vous les enregistrer avant de fermer ?',
      "Don't save": 'Ne pas enregistrer', 'Information': 'Informations', 'Light': 'Clair',
      'Trigger': 'Déclencheur', 'When:': 'Quand :', 'Keys:': 'Touches :', 'Enable global trigger': 'Activer le déclencheur global', 'Record settings': 'Paramètres d’enregistrement',
      'Movement': 'Mouvement', 'Buttons': 'Boutons', 'Keyboard': 'Clavier', 'Delays': 'Délais', 'Absolute': 'Absolu', 'Relative': 'Relatif',
      'Actions': 'Actions', 'Wait': 'Attendre', 'Add': 'Ajouter', 'Pressed': 'Appui', 'Hold': 'Maintien', 'Toggle': 'Bascule'
    },
    ru: {
      'Auto Clicker': 'Автокликер', 'Macro': 'Макрос', 'Settings': 'Настройки', 'Application': 'Приложение',
      'Language': 'Язык', 'Application language': 'Язык приложения', 'English': 'Английский', 'Arabic': 'Арабский', 'French': 'Французский', 'Russian': 'Русский',
      'Always above everything': 'Поверх всех окон', 'Keep Click Interval over other windows and fullscreen apps.': 'Показывать Click Interval поверх других окон и полноэкранных приложений.',
      'Update automatically': 'Обновлять автоматически', 'Install trusted Click Interval updates when they become available.': 'Устанавливать доверенные обновления Click Interval, когда они доступны.',
      'Open after updating': 'Открыть после обновления', 'Launch the newly updated version when installation finishes.': 'Запустить новую версию после завершения установки.',
      'Background tools': 'Фоновые инструменты', 'The open tab always works. Select any other tools that should keep working at the same time.': 'Открытая вкладка всегда работает. Выберите другие инструменты для одновременной работы.',
      'Active indicator': 'Индикатор активности', 'Show mouse logo while clicking': 'Показывать логотип мыши во время кликов', 'Logo position': 'Положение логотипа',
      'Show live CPS while clicking': 'Показывать CPS во время кликов', 'Include my physical clicks': 'Учитывать мои физические клики', 'Show CPS continuously': 'Показывать CPS постоянно', 'CPS display': 'Вид CPS', 'Total CPS': 'Общий CPS', 'Left | Right': 'Левая | Правая', 'CPS position': 'Положение CPS', 'Theme': 'Тема', 'Save': 'Сохранить', 'Cancel': 'Отмена',
      'Click interval': 'Интервал кликов', 'Click options': 'Параметры клика', 'Mouse button:': 'Кнопка мыши:', 'Click type:': 'Тип клика:',
      'Left': 'Левая', 'Right': 'Правая', 'Middle': 'Средняя', 'Single': 'Одинарный', 'Double': 'Двойной', 'Random offset': 'Случайное отклонение',
      'Cursor position': 'Положение курсора', 'Current location': 'Текущее положение', 'Pick location': 'Выбрать положение', 'Start': 'Старт', 'Stop': 'Стоп',
      'Hotkey setting': 'Настройка горячей клавиши', 'Emergency Stop': 'Аварийная остановка', 'Your macros': 'Ваши макросы', 'No macros yet. Press + to create one.': 'Макросов пока нет. Нажмите +, чтобы создать.',
      'hours': 'ч', 'mins': 'мин', 'secs': 'с', 'milliseconds': 'мс', 'CPS cap & emergency stop': 'Лимит CPS и аварийная остановка',
      'CPS cap:': 'Лимит CPS:', 'Emergency:': 'Аварийная:', 'Start (Q)': 'Старт (Q)', 'Stop (Q)': 'Стоп (Q)',
      'Emergency Stop (Ctrl + Shift + F12)': 'Аварийная остановка (Ctrl + Shift + F12)',
      'Record': 'Запись', 'Play': 'Воспроизвести', 'Open file': 'Открыть файл', 'Repeat': 'Повтор', 'Playback': 'Воспроизведение', 'Repeat count': 'Количество повторов',
      'Constant repeat': 'Постоянный повтор', 'Loop delay': 'Задержка цикла', 'Speed': 'Скорость', 'Start delay': 'Задержка запуска', 'Timing variance': 'Разброс времени',
      'Minimize app': 'Свернуть приложение', 'Restore cursor': 'Вернуть курсор', 'Stop on input': 'Остановить при вводе', 'Record & playback': 'Запись и воспроизведение',
      'Quality': 'Качество', 'Hotkeys': 'Горячие клавиши', 'Advanced editor': 'Расширенный редактор', 'Top left': 'Сверху слева', 'Top right': 'Сверху справа',
      'Center': 'По центру', 'Bottom left': 'Снизу слева', 'Bottom right': 'Снизу справа',
      'Open a macro file': 'Открыть файл макроса', 'Create a new macro': 'Создать макрос', 'Saved macros': 'Сохранённые макросы',
      'Back to saved macros': 'Назад к сохранённым макросам', 'Save macro': 'Сохранить макрос', 'Open advanced editor': 'Открыть расширенный редактор',
      'Not saved': 'Не сохранён', 'None': 'Нет', 'Compact': 'Компактное', 'Balanced': 'Сбалансированное', 'Smooth': 'Плавное', 'Ultra': 'Ультра',
      'Hide Click Interval when playback starts': 'Скрыть Click Interval при запуске воспроизведения',
      'Return the cursor to its starting position when playback ends': 'Вернуть курсор в исходное положение после воспроизведения',
      'Stop playback when physical keyboard or mouse input is detected': 'Остановить воспроизведение при физическом вводе с клавиатуры или мыши',
      'Record / Stop: Ctrl + F10': 'Запись / Стоп: Ctrl + F10', 'Play / Stop: Ctrl + F11': 'Воспроизведение / Стоп: Ctrl + F11',
      'Hotkey Setting': 'Настройка горячей клавиши', 'Start / Stop': 'Старт / Стоп', 'Ok': 'ОК', 'New Macro': 'Новый макрос',
      'Macro name': 'Название макроса', 'My Macro': 'Мой макрос', 'Create': 'Создать', 'Delete Macro': 'Удалить макрос', 'Delete': 'Удалить',
      'Unsaved Changes': 'Несохранённые изменения', "You didn't save your changes. Would you like to save?": 'Изменения не сохранены. Сохранить их?',
      'Yes': 'Да', 'No': 'Нет', 'Unsaved Settings': 'Несохранённые настройки',
      'You have unsaved settings. Would you like to save them before closing?': 'Есть несохранённые настройки. Сохранить их перед закрытием?',
      "Don't save": 'Не сохранять', 'Information': 'Информация', 'Light': 'Светлая',
      'Trigger': 'Триггер', 'When:': 'Режим:', 'Keys:': 'Клавиши:', 'Enable global trigger': 'Включить глобальный триггер', 'Record settings': 'Настройки записи',
      'Movement': 'Движение', 'Buttons': 'Кнопки', 'Keyboard': 'Клавиатура', 'Delays': 'Задержки', 'Absolute': 'Абсолютно', 'Relative': 'Относительно',
      'Actions': 'Действия', 'Wait': 'Ожидание', 'Add': 'Добавить', 'Pressed': 'Нажатие', 'Hold': 'Удержание', 'Toggle': 'Переключение'
    }
  };

  function translateTextNode(node, dictionary) {
    const value = node.nodeValue || '';
    const trimmed = value.trim();
    if (!trimmed) return;
    let translated = dictionary[trimmed];
    if (!translated) {
      const actionCount = trimmed.match(/^(\d+) actions?$/);
      if (actionCount) {
        const language = document.documentElement.lang;
        translated = language === 'ar' ? `${actionCount[1]} إجراء` : language === 'fr' ? `${actionCount[1]} action${actionCount[1] === '1' ? '' : 's'}` : language === 'ru' ? `${actionCount[1]} действий` : null;
      }
    }
    if (translated && translated !== trimmed) node.nodeValue = value.replace(trimmed, translated);
  }

  function translateElement(element, dictionary) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const value = element.getAttribute?.(attribute);
      if (value && dictionary[value]) element.setAttribute(attribute, dictionary[value]);
    }
    for (const child of element.childNodes || []) {
      if (child.nodeType === Node.TEXT_NODE) translateTextNode(child, dictionary);
      else if (child.nodeType === Node.ELEMENT_NODE) translateElement(child, dictionary);
    }
  }

  function applyLanguage(language) {
    const selected = ['en', 'ar', 'fr', 'ru'].includes(language) ? language : 'en';
    document.documentElement.lang = selected;
    document.documentElement.dir = 'ltr';
    document.documentElement.dataset.language = selected;
    if (selected === 'en') return;
    const dictionary = translations[selected];
    translateElement(document.body, dictionary);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target, dictionary);
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, dictionary);
          else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node, dictionary);
        }
      }
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  window.ClickIntervalI18n = { applyLanguage };
  addEventListener('DOMContentLoaded', () => {
    const language = window.bridge?.loadAppSettings?.()?.language || 'en';
    applyLanguage(language);
  }, { once: true });
})();
