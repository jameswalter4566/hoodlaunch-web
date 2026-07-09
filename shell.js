// Sidebar collapse toggle, persisted across pages.
(function () {
  if (localStorage.getItem('sb-min') === '1') document.body.classList.add('sb-min');
  document.getElementById('sb-toggle').addEventListener('click', function () {
    const min = document.body.classList.toggle('sb-min');
    localStorage.setItem('sb-min', min ? '1' : '0');
  });
})();
