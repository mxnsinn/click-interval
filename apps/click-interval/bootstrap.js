'use strict';

if (process.argv.includes('--update-payload')) {
  require('./updater-main');
} else {
  const { isUpdateLockActive } = require('./update-lock');
  const updateWaitDeadline = Date.now() + 120_000;

  const startWhenUpdateFinishes = () => {
    if (!isUpdateLockActive(__dirname)) {
      require('./main');
      return;
    }
    if (Date.now() < updateWaitDeadline) {
      setTimeout(startWhenUpdateFinishes, 250);
      return;
    }
    const { app, dialog } = require('electron');
    app.whenReady().then(() => {
      dialog.showErrorBox(
        'Click Interval is updating',
        'An update is still in progress. Click Interval will reopen when it finishes.'
      );
      app.quit();
    });
  };

  startWhenUpdateFinishes();
}
