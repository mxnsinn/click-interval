(function () {
  class Motion {
    constructor() {
      this.config = {};
      this.held = false;
      this.x = 0;
      this.y = 0;
      this.targetX = 0;
      this.targetY = 0;
      this.shots = 0;
      this.lastShot = 0;
      this.lastFrame = performance.now();
    }
    setConfig(config) { this.config = config || {}; }
    addShot(now) {
      this.shots += 1;
      this.lastShot = now;
      if (!this.config.recoilEnabled) return;
      const vertical = Number(this.config.recoilVertical ?? -Number(this.config.recoilRise || 0));
      const sway = Number(this.config.recoilSway || 0);
      const verticalLimit = Math.max(1, Math.abs(vertical) * 8);
      this.targetY = Math.max(-verticalLimit, Math.min(verticalLimit, this.targetY + vertical));
      if (this.config.recoilPattern === 'sway') this.targetX += (this.shots % 2 ? 1 : -1) * sway;
      else if (this.config.recoilPattern === 'left') this.targetX -= sway;
      else if (this.config.recoilPattern === 'right') this.targetX += sway;
      else if (this.config.recoilPattern === 'random') this.targetX += (Math.random() * 2 - 1) * sway;
      this.targetX = Math.max(-sway * 5, Math.min(sway * 5, this.targetX));
    }
    fire(active, now = performance.now()) {
      this.held = Boolean(active);
      if (active) this.addShot(now);
      else if (this.config.resetOnRelease !== false) { this.targetX = 0; this.targetY = 0; this.shots = 0; }
    }
    update(now = performance.now()) {
      const delta = Math.max(1, Math.min(50, now - this.lastFrame));
      this.lastFrame = now;
      if (this.held && this.config.automaticFire !== false) {
        const interval = 60000 / Math.max(60, Number(this.config.fireRate || 600));
        while (now - this.lastShot >= interval) this.addShot(this.lastShot + interval);
      }
      if (!this.held) {
        const recovery = Math.max(50, Number(this.config.recoilRecovery || 260));
        const decay = Math.exp(-delta * 5 / recovery);
        this.targetX *= decay;
        this.targetY *= decay;
        if (Math.abs(this.targetX) < .05) this.targetX = 0;
        if (Math.abs(this.targetY) < .05) this.targetY = 0;
      }
      const response = 1 - Math.exp(-delta / 28);
      this.x += (this.targetX - this.x) * response;
      this.y += (this.targetY - this.y) * response;
      const bloomAge = now - this.lastShot;
      const bloom = bloomAge < 170 ? (1 - bloomAge / 170) * Math.max(0, Number(this.config.bloomStrength || 0)) / 100 : 0;
      return { x: this.x, y: this.y, pulse: bloom };
    }
  }
  window.CrosshairMotion = Motion;
}());
