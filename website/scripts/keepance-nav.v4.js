/* Keepance shared site navigation injector.
 * Removes any existing <nav> at the top of <body> and inserts the canonical
 * homepage-style nav. Skipped if the page already has .keepance-nav (which
 * the homepage itself does not, so no double-render).
 */
(function () {
  if (document.querySelector('.keepance-nav')) return;

  // Remove any existing top-of-body <nav> so we don't render two navbars.
  // Only strips a <nav> element that's the first or second child of <body>
  // (typical placement); avoids stripping in-page navs deeper in the doc.
  var firstChild = document.body && document.body.firstElementChild;
  if (firstChild && firstChild.tagName === 'NAV') {
    firstChild.remove();
  } else {
    var second = document.body && document.body.children[1];
    if (second && second.tagName === 'NAV') second.remove();
  }

  // Keepance wordmark SVG — four paths: text, shield outer, shield body, gradient sparkle.
  var LOGO_SVG = '<img src="/keepance-logo-white.svg" alt="Keepance home" style="height:26px;width:auto;display:block;">';

  function buildLogo() {
    var a = document.createElement('a');
    a.href = '/';
    a.className = 'keepance-nav-logo';
    a.setAttribute('aria-label', 'Keepance home');
    a.innerHTML = LOGO_SVG;
    return a;
  }

  // CANONICAL NAV ITEMS — change here once, every page picks it up.
  var ITEMS = [
    { href: '/legal/', label: 'Attorneys' },
    { href: '/tax/', label: 'Tax pros' },
    { href: '/consulting/', label: 'Consultants' },
    { href: '/blog/', label: 'Blog' },
    { href: '/#pricing', label: 'Pricing' }
  ];

  function buildLink(href, label, cls) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (cls) a.className = cls;
    return a;
  }

  function buildBurger() {
    var b = document.createElement('button');
    b.className = 'keepance-nav-burger';
    b.setAttribute('aria-label', 'Open menu');
    b.setAttribute('aria-expanded', 'false');
    // Trusted SVG markup — no user input.
    var svg = new DOMParser().parseFromString(
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M3 6h18M3 12h18M3 18h18"/></svg>',
      'image/svg+xml',
    ).documentElement;
    if (svg && svg.tagName.toLowerCase() === 'svg') {
      b.appendChild(document.importNode(svg, true));
    } else {
      b.textContent = '☰';
    }
    return b;
  }

  function buildNav() {
    var nav = document.createElement('nav');
    nav.className = 'keepance-nav';
    nav.setAttribute('aria-label', 'Site');

    var inner = document.createElement('div');
    inner.className = 'keepance-nav-inner';

    inner.appendChild(buildLogo());

    // Desktop: full-width links row + CTA on the right.
    var links = document.createElement('div');
    links.className = 'keepance-nav-links';
    ITEMS.forEach(function (item) { links.appendChild(buildLink(item.href, item.label)); });
    inner.appendChild(links);

    var cta = buildLink('/#pricing', 'Download free trial', 'keepance-nav-cta');
    inner.appendChild(cta);

    // Mobile: burger button toggles a slide-down panel with the same items + CTA.
    var burger = buildBurger();
    inner.appendChild(burger);

    var mobile = document.createElement('div');
    mobile.className = 'keepance-nav-mobile';
    ITEMS.forEach(function (item) { mobile.appendChild(buildLink(item.href, item.label)); });
    mobile.appendChild(buildLink('/#pricing', 'Download free trial', 'keepance-nav-cta'));
    nav.appendChild(inner);
    nav.appendChild(mobile);

    burger.addEventListener('click', function () {
      var isOpen = mobile.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(isOpen));
    });
    // Close mobile menu on navigation.
    mobile.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        mobile.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });

    return nav;
  }

  // Inject Satoshi font if not already loaded.
  if (!document.querySelector('link[href*="fontshare"]')) {
    var fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://api.fontshare.com/v2/css?f[]=satoshi@700,400&display=swap';
    document.head.appendChild(fontLink);
  }

  document.body.insertBefore(buildNav(), document.body.firstChild);

  // Remove any body padding-top that secondary pages set to account for a nav —
  // the injected sticky nav handles its own layout and doesn't need clearance padding.
  document.body.style.paddingTop = '0';
})();
