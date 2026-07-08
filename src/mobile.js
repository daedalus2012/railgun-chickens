export function isMobileDevice() {
  return window.matchMedia('(pointer: coarse)').matches
    || (window.matchMedia('(hover: none)').matches && navigator.maxTouchPoints > 0)
    || (navigator.maxTouchPoints > 0 && Math.min(window.innerWidth, window.innerHeight) < 900);
}

export function initMobileControls({
  aimZone, fireBtn, reloadBtn, pauseBtn,
  onAimDelta, onFireDown, onFireUp, onReload, onPause,
}) {
  let aimTouchId = null;
  let lastX = 0;
  let lastY = 0;

  aimZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (aimTouchId !== null) continue;
      aimTouchId = t.identifier;
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: false });

  aimZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== aimTouchId) continue;
      onAimDelta(t.clientX - lastX, t.clientY - lastY);
      lastX = t.clientX;
      lastY = t.clientY;
    }
  }, { passive: false });

  const endAim = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === aimTouchId) aimTouchId = null;
    }
  };
  aimZone.addEventListener('touchend', endAim);
  aimZone.addEventListener('touchcancel', endAim);

  fireBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onFireDown();
  }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    onFireUp();
  });
  fireBtn.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    onFireUp();
  });

  reloadBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onReload();
  }, { passive: false });
  reloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onReload();
  });

  pauseBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onPause();
  }, { passive: false });
  pauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onPause();
  });
}
