// Sidebar collapse toggle, persisted across pages.
(function () {
  // nudge the background sky video into playing (autoplay can stall when the
  // element loads behind content)
  const sky = document.querySelector('.app-sky-bg');
  if (sky) {
    sky.muted = true;
    sky.setAttribute('preload', 'auto');
    const go = function () { sky.play().catch(function () {}); };
    go();
    sky.addEventListener('canplay', go);
    document.addEventListener('visibilitychange', go);
  }

  if (localStorage.getItem('sb-min') === '1') document.body.classList.add('sb-min');
  document.getElementById('sb-toggle').addEventListener('click', function () {
    const min = document.body.classList.toggle('sb-min');
    localStorage.setItem('sb-min', min ? '1' : '0');
  });
})();
