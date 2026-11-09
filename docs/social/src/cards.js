// #wide in the URL switches a card to its 16:9 layout
if (location.hash === '#wide') document.documentElement.classList.add('wide');
// Mounts the app's real rating widgets (from CrowdPulse running on localhost:3055) into any [data-rater] element.
if (window.CP) document.querySelectorAll('[data-rater]').forEach(el => {
  const r = CP.raters[el.dataset.rater];
  if (!r) { el.textContent = 'missing rater ' + el.dataset.rater; return; }
  r.mount(el, Number(el.dataset.v), () => {});
});
// the brand mark, drawn the same way as the favicon
document.querySelectorAll('.logo').forEach(l => {
  l.innerHTML = '<svg viewBox="0 0 64 64"><path d="M8 32h11l8-19 11 38 8-19h10" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
});
