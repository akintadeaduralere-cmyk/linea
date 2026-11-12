// Linea showcase: the page answers the hand. A light follows the pointer across the studio, the wheel behind the page turns with
// scroll and leans toward the pointer, cards tilt under the cursor, sections rise into place, numbers count up, and the
// "fits any site" switch restyles the live player. Everything stands still under reduced motion.
(function () {
  var root = document.documentElement;
  if (/[?&]card/.test(location.search)) document.body.classList.add('sc-card');
  var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = matchMedia('(pointer: fine)').matches;

  // Split the wordmark so each letter can rise on its own beat.
  document.querySelectorAll('[data-split]').forEach(function (el) {
    var t = el.textContent; el.textContent = '';
    el.setAttribute('aria-label', t);
    t.split('').forEach(function (ch, i) {
      var s = document.createElement('span'); s.textContent = ch; s.setAttribute('aria-hidden', 'true'); s.style.setProperty('--i', i); el.appendChild(s);
    });
  });

  // Reveal on scroll, and count the numbers once they are seen.
  var reveal = function (el) {
    el.classList.add('in');
    el.querySelectorAll('[data-count]').forEach(function (n) {
      var to = +n.getAttribute('data-count');
      if (calm || to === 0) { n.textContent = String(to); return; }
      var t0 = performance.now(), dur = 1400;
      (function step(now) { var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4); n.textContent = String(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); })(t0);
    });
  };
  var items = document.querySelectorAll('.sc-reveal');
  if (!('IntersectionObserver' in window) || calm) items.forEach(reveal);
  else {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } }); }, { threshold: 0, rootMargin: '0px 0px 12% 0px' });
    items.forEach(function (e) { io.observe(e); });
  }

  // Pointer light, ring lean and scroll turn: one rAF loop that only writes CSS variables.
  var mx = 0.5, my = 0.3, tx = 0.5, ty = 0.3, sy = 0, raf = 0;
  var loop = function () {
    raf = 0;
    mx += (tx - mx) * 0.12; my += (ty - my) * 0.12;
    root.style.setProperty('--mx', (mx * 100).toFixed(2) + '%');
    root.style.setProperty('--my', (my * 100).toFixed(2) + '%');
    root.style.setProperty('--lean-x', ((mx - 0.5) * 30).toFixed(2) + 'px');
    root.style.setProperty('--lean-y', ((my - 0.5) * 30).toFixed(2) + 'px');
    // The wheel turns one notch (7.5 degrees) for every section passed, like the player moving one line at a time.
    var secs = document.querySelectorAll('.sc-sec'), passed = 0;
    secs.forEach(function (s) { if (s.getBoundingClientRect().top < innerHeight * 0.55) passed++; });
    root.style.setProperty('--scroll-turn', (passed * 7.5 * 3).toFixed(1) + 'deg');
    document.querySelectorAll('.sc-shot img, .sc-stage img').forEach(function (im) { var r = im.getBoundingClientRect(); var d = ((r.top + r.height / 2) - innerHeight / 2) / innerHeight; im.style.setProperty('--par', (Math.max(-1, Math.min(1, d)) * -22).toFixed(1) + 'px'); });
    if (Math.abs(tx - mx) > 0.001 || Math.abs(ty - my) > 0.001) raf = requestAnimationFrame(loop);
  };
  var kick = function () { if (!raf) raf = requestAnimationFrame(loop); };
  if (!calm) {
    addEventListener('pointermove', function (e) { tx = e.clientX / innerWidth; ty = e.clientY / innerHeight; kick(); }, { passive: true });
    addEventListener('scroll', function () { sy = scrollY; kick(); }, { passive: true });
  }

  // Nav: solid after the top, the current section lit.
  var nav = document.querySelector('.sc-nav');
  var links = Array.prototype.slice.call(document.querySelectorAll('.sc-nav a[href^="#"]:not(.sc-brand)'));
  var lastY = scrollY;
  var onScroll = function () {
    if (nav) {
      nav.classList.toggle('scrolled', scrollY > 40);
      // Never float over a player: the menu steps aside while any player sits under it, and returns once it has passed.
      var band = nav.getBoundingClientRect().bottom + 10;
      var over = Array.prototype.some.call(document.querySelectorAll('.sr-player'), function (pl) { var r = pl.getBoundingClientRect(); return r.width > 0 && r.top < band && r.bottom > 0; });
      nav.classList.toggle('aside', over);
      // Out of the way while reading: it slides away as you scroll down and comes back as soon as you scroll up.
      var y = scrollY; if (y > lastY + 6 && y > 160) nav.classList.add('tucked'); else if (y < lastY - 6) nav.classList.remove('tucked'); if (Math.abs(y - lastY) > 6) lastY = y;
    }
    var cur = null;
    links.forEach(function (a) { var s = document.querySelector(a.getAttribute('href')); if (s && s.getBoundingClientRect().top < innerHeight * 0.4) cur = a; });
    links.forEach(function (a) { if (a === cur) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  };
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();

  // Cards lean toward the pointer (fine pointers only).
  if (fine && !calm) document.querySelectorAll('.sc-tilt').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg'); c.style.setProperty('--ry', (x * 8).toFixed(2) + 'deg');
      c.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%'); c.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
    });
    c.addEventListener('pointerleave', function () { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
  });

  // States: tabs swap the capture with a soft cross-fade; arrow keys move between tabs.
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.sc-tabs [role=tab]'));
  var img = document.getElementById('sc-state-img'), cap = document.getElementById('sc-state-cap');
  var pick = function (t, focus) {
    tabs.forEach(function (b) { var on = b === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    // Playing is a real recording of the player, so it plays as video (paused under reduced motion, showing its first frame).
    var vid = document.getElementById('sc-state-vid'), isVid = t.hasAttribute('data-video');
    if (img) { img.classList.add('swap'); setTimeout(function () {
      img.src = './showcase/' + t.getAttribute('data-img') + '.webp'; img.classList.remove('swap');
      if (vid) { vid.hidden = !isVid; img.hidden = isVid; if (isVid) { if (!calm) { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); } } else vid.pause(); }
    }, calm ? 0 : 180); }
    if (cap) cap.textContent = t.getAttribute('data-cap');
    if (focus) t.focus();
  };
  tabs.forEach(function (t, i) {
    t.tabIndex = i === 0 ? 0 : -1;
    t.addEventListener('click', function () { pick(t); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); pick(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true); }
    });
  });

  // Fits any site: page tone and accent, applied to the live player.
  var player = function () { return document.querySelector('.sr-player'); };
  document.querySelectorAll('[data-page]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.body.classList.toggle('sc-lightpage', b.getAttribute('data-page') === 'light');
      document.querySelectorAll('[data-page]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });
  var hueOf = function (hex) { var n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; var h = mx === r ? ((g - b) / d) % 6 : (mx === g ? (b - r) / d + 2 : (r - g) / d + 4); return (h * 60 + 360) % 360; };
  var hexA = function (hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgb(' + (n >> 16) + ' ' + ((n >> 8) & 255) + ' ' + (n & 255) + ' / ' + a + ')'; };
  document.querySelectorAll('[data-accent]').forEach(function (b) {
    b.addEventListener('click', function () {
      var c = b.getAttribute('data-accent'), p = player();
      var turn = (hueOf(c) - hueOf('#ff5a1f') + 360) % 360;
      [document.documentElement].concat(Array.prototype.slice.call(document.querySelectorAll('.sr-player'))).forEach(function (el) { if (!el) return; el.style.setProperty('--l-now', c); el.style.setProperty('--ember', c);
        // The highlight is a lighter tint of the accent, so darker accents (blue, green) still glow like ember does.
        el.style.setProperty('--ember-hot', 'color-mix(in srgb, ' + c + ' 62%, #ffffff)'); el.style.setProperty('--ember-glow', hexA(c, 0.6));
        el.style.setProperty('--sc-accent', c); el.style.setProperty('--sr-accent-turn', turn.toFixed(1) + 'deg'); });
      document.querySelectorAll('[data-accent]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });

  // Fits any site: Site and Device switch the sample page around the second live player; arrow keys move within each group.
  (function () {
    var stage = document.querySelector('.as-stage'); if (!stage) return;
    // Desktop on a narrow screen: the sample site keeps a real desktop width (1040 px) and is scaled down to fit, so the player
    // shows its true wide deck, not the phone layout the narrow space would give it.
    var device = stage.querySelector('.as-device'), DESK = 1040, note = document.getElementById('as-note');
    var fitDesk = function () {
      var inner = stage.clientWidth - parseFloat(getComputedStyle(stage).paddingLeft) * 2;
      if (stage.getAttribute('data-device') === 'desktop' && inner < DESK) { device.style.width = DESK + 'px'; device.style.maxWidth = 'none'; device.style.zoom = String(inner / DESK); device.inert = inner / DESK < 0.6; }
      else { device.style.width = ''; device.style.maxWidth = ''; device.style.zoom = ''; device.inert = false; }
      if (note) note.hidden = !device.inert;
    };
    var narrow = matchMedia('(max-width: 760px)'), phoneNote = 'You are on a phone, so this shows the phone layout. Open the page on a computer to see the desktop one.', deskNote = note ? note.textContent : '';
    var fitDesk0 = fitDesk;
    fitDesk = function () { fitDesk0(); if (note) { note.textContent = narrow.matches ? phoneNote : deskNote; if (narrow.matches) note.hidden = false; } };
    fitDesk(); addEventListener('resize', fitDesk, { passive: true });
    document.querySelectorAll('.as-seg').forEach(function (seg) {
      var opts = Array.prototype.slice.call(seg.querySelectorAll('.as-opt'));
      var pick = function (o, focus) {
        opts.forEach(function (x) { var on = x === o; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
        if (o.hasAttribute('data-site')) stage.setAttribute('data-site', o.getAttribute('data-site'));
        if (o.hasAttribute('data-device')) stage.setAttribute('data-device', o.getAttribute('data-device'));
        fitDesk();
        if (focus) o.focus();
      };
      opts.forEach(function (o, i) {
        o.tabIndex = o.getAttribute('aria-checked') === 'true' ? 0 : -1;
        o.addEventListener('click', function () { pick(o); });
        o.addEventListener('keydown', function (e) { var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0); if (d) { e.preventDefault(); pick(opts[(i + d + opts.length) % opts.length], true); } });
      });
    });
  })();

  // Try it: each how-to card drives the real player above, then brings it into view.
  document.querySelectorAll('[data-try]').forEach(function (b) {
    b.addEventListener('click', function () {
      var r = window.reel, c = r && r.controller, k = b.getAttribute('data-try'), p = document.querySelector('.sr-player');
      var media = document.querySelector('hls-video, video');
      if (!c) return;
      if (media && media.paused && k !== 'tray') { media.muted = false; var pr = media.play(); if (pr && pr.catch) pr.catch(function () {}); }
      if (k === 'next' || k === 'wheel') c.next();
      if (k === 'again') c.again();
      if (k === 'wait') c.toggleWait();
      if (k === 'words') c.setWords(!c.state().captionsOn);
      if (k === 'tray') { var pull = document.querySelector('.sr-pull'); if (pull) pull.click(); }
      var top = document.getElementById('fit'); if (top) top.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      if (p && !calm) { p.classList.remove('sc-ping'); void p.offsetWidth; p.classList.add('sc-ping'); }
    });
  });

  // Anatomy (control map, 12 Nov 2026): the player stands still. Choosing a line draws a highlight round that control, lights its
  // marker and names it under the picture. A slow tour runs while the section is in view, until someone hovers, taps or tabs in;
  // under reduced motion there is no tour and every change is instant.
  (function () {
    var D = window.__ax, fig = document.querySelector('.ax-fig'); if (!D || !fig) return;
    var NS = 'http://www.w3.org/2000/svg', svg = fig.querySelector('.ax-svg'), now = fig.querySelector('.ax-now');
    var W = D.W, H = D.H, rows = Array.prototype.slice.call(document.querySelectorAll('.ax-it'));
    var byKey = function (k) { return D.items.filter(function (it) { return it[6] === k; })[0][4]; }; var pull = byKey('pull'), level = byKey('level');
    var keyRow = pull[1] + pull[3] + 30, tickTop = level[1] + level[3] + 24;
    var hls = [], mks = [], ticks = [];
    // Marker placement by control, beside it rather than on it; the seven keys share one row under the console, each on a fine tick.
    var KEYS = { again: 1, next: 1, words: 1, wait: 1, full: 1, sound: 1, level: 1 };
    var mkAt = function (i) {
      var it = D.items[i], r = it[4], k = it[6];
      if (KEYS[k]) return [r[0] + r[2] / 2, keyRow];
      return ({ title: [r[0] - 18, r[1] + r[3] / 2], outs: [r[0] - 30, r[1] + r[3] / 2], stage: [r[0] + 30, r[1] + r[3] - 30],
        pull: [r[0] - 12, r[1] + r[3] / 2], seek: [r[0] + r[2] * 0.5, r[1] - 4], window: [r[0] + 28, r[1] + r[3] / 2],
        time: [r[0] + r[2] - 16, r[1] + 16], hub: [r[0] + r[2] - 6, r[1] + 6], reel: [r[0] + r[2] - 8, r[1] + r[3] * 0.62] })[k];
    };
    D.items.forEach(function (it, i) {
      var r = it[4], pad = it[6] === 'stage' ? -6 : 6, el;
      if (it[5] === 'c') { el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', r[0] + r[2] / 2); el.setAttribute('cy', r[1] + r[3] / 2); el.setAttribute('r', Math.max(r[2], r[3]) / 2 + pad); }
      else { el = document.createElementNS(NS, 'rect'); el.setAttribute('x', r[0] - pad); el.setAttribute('y', r[1] - pad); el.setAttribute('width', r[2] + pad * 2); el.setAttribute('height', r[3] + pad * 2); el.setAttribute('rx', Math.min(14, (r[3] + pad * 2) / 2)); }
      el.setAttribute('class', 'ax-hl'); el.setAttribute('pathLength', '1'); svg.appendChild(el); hls.push(el);
      var p = mkAt(i);
      if (KEYS[it[6]]) { var t = document.createElementNS(NS, 'path'); t.setAttribute('d', 'M' + p[0] + ' ' + tickTop + ' V' + (keyRow - 16)); t.setAttribute('class', 'ax-tick'); svg.appendChild(t); ticks[i] = t; }
      var m = document.createElement('span'); m.className = 'ax-mk ' + it[1]; m.textContent = it[0]; m.setAttribute('aria-hidden', 'true');
      m.style.left = (p[0] / W * 100) + '%'; m.style.top = (p[1] / H * 100) + '%'; fig.appendChild(m); mks.push(m);
      m.addEventListener('click', function () { take(); show(i); });
    });
    var cur = -1, timer = 0, touched = false;
    var show = function (i) {
      if (cur === i) return; cur = i;
      hls.forEach(function (h, k) { h.classList.toggle('on', k === i); });
      mks.forEach(function (m, k) { m.classList.toggle('on', k === i); });
      ticks.forEach(function (t, k) { if (t) t.classList.toggle('on', k === i); });
      rows.forEach(function (b, k) { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      var it = D.items[i]; now.innerHTML = '<b>' + String(it[0]).padStart(2, '0') + '  ' + it[2] + '</b>';
    };
    var take = function () { touched = true; clearInterval(timer); };
    rows.forEach(function (b, k) {
      b.addEventListener('click', function () { take(); show(k); });
      b.addEventListener('focus', function () { take(); show(k); });
      if (fine) b.addEventListener('pointerenter', function () { take(); show(k); });
    });
    show(0);
    if (!calm && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { clearInterval(timer); if (e.isIntersecting && !touched) timer = setInterval(function () { show((cur + 1) % D.items.length); }, 2400); }); }, { threshold: 0.35 }).observe(fig);
    }
  })();

  // How to use it: each question swaps in the player's own recorded answer. Arrow keys move between questions; the clip plays
  // only while the section is on screen; under reduced motion it stays on its first frame with the browser's own play control.
  (function () {
    var qs = Array.prototype.slice.call(document.querySelectorAll('.hw-q')), vid = document.getElementById('hw-vid'), cap = document.getElementById('hw-cap'), tryB = document.querySelector('.hw-try');
    if (!qs.length || !vid) return;
    var seen = false;
    if (calm) vid.setAttribute('controls', '');
    var play = function () { if (!calm && seen) { var pr = vid.play(); if (pr && pr.catch) pr.catch(function () {}); } };
    var pick = function (q, focus) {
      qs.forEach(function (b) { var on = b === q; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      var c = q.getAttribute('data-clip');
      vid.classList.add('swap');
      setTimeout(function () {
        vid.poster = './showcase/how-' + c + '.webp'; vid.src = './showcase/how-' + c + '.mp4'; vid.load(); vid.classList.remove('swap'); play();
      }, calm ? 0 : 160);
      if (cap) cap.textContent = q.querySelector('.hw-ans').textContent;
      tryB.setAttribute('data-try', q.getAttribute('data-act'));
      if (focus) q.focus();
    };
    qs.forEach(function (q, i) {
      q.tabIndex = i === 0 ? 0 : -1;
      q.addEventListener('click', function () { pick(q); });
      q.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0);
        if (d) { e.preventDefault(); pick(qs[(i + d + qs.length) % qs.length], true); }
      });
    });
    // Watch the stage, not the video: a video reloading its source has no height for a moment and would read as off screen.
    vid.addEventListener('canplay', play);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { es.forEach(function (e) { seen = e.isIntersecting; if (seen) play(); else vid.pause(); }); }, { threshold: 0 }).observe(document.getElementById('hw-stage'));
  })();

  // Any site on a phone: start on Phone and hide the Device choice (restored on a wide screen).
  (function () {
    var ph = document.querySelector('.as-opt[data-device="phone"]'), desk = document.querySelector('.as-opt[data-device="desktop"]'); if (!ph || !desk) return;
    var g = ph.closest('.as-group'), mq = matchMedia('(max-width: 760px)');
    var apply = function () { if (mq.matches && ph.getAttribute('aria-checked') !== 'true') ph.click(); if (g) g.hidden = mq.matches; };
    apply(); if (mq.addEventListener) mq.addEventListener('change', apply);
  })();

  // States catalogue: every state is a short recording of the real player doing it (the press is marked). On a computer the
  // picked card plays in the viewer; on a phone each card plays its own clip while it is on screen. Reduced motion: the stills.
  (function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.ss-card')), view = document.querySelector('.ss-view');
    if (!cards.length || !view) return;
    var frame = view.querySelector('.ss-frame'), img = document.getElementById('ss-img'), vid = document.getElementById('ss-vid'), cap = document.getElementById('ss-cap'), cur = null;
    var CLIP = { 'phone-play': [600,964], 'phone-side': [1400,652], 'phone-tray': [600,992], 'play-clip': [1600,1302], 's0-standby': [1600,1302], 's2-tray': [1600,1304], 's3-language': [1600,1302], 's4-paused': [1600,1302], 'st-captions-off': [1600,1302], 'st-end': [1600,1302], 'st-error': [1600,1302], 'st-focus': [1600,1302], 'st-fs-faded': [1600,1112], 'st-fs-shown': [1600,1112], 'st-loading': [1600,1302], 'st-muted': [1600,1302], 'st-phone-side-faded': [1400,652], 'st-step-wait': [1600,1302], 'st-volume': [1600,1302], 'st-wheel': [1600,1302] };
    var clipOf = function (n) { return './showcase/stv-' + n + '.mp4'; }, posterOf = function (n) { return './showcase/stv-' + n + '.webp'; };
    var sizeOf = function (n) { return CLIP[n] || [1600, 1262]; };
    var phone = matchMedia('(max-width: 760px)'), viewSeen = false;
    var run = function (v) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); };
    var show = function (c) {
      cards.forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      if (c === cur || phone.matches) { cur = c; return; }
      cur = c;
      frame.classList.add('swap');
      setTimeout(function () {
        var n = c.getAttribute('data-img'), name = c.querySelector('b').textContent, wh = sizeOf(n);
        view.setAttribute('data-kind', c.getAttribute('data-kind'));
        if (calm) { vid.pause(); vid.hidden = true; img.hidden = false; img.width = wh[0]; img.height = wh[1]; img.src = posterOf(n); img.alt = 'Linea: ' + name; }
        else { img.hidden = true; vid.hidden = false; vid.width = wh[0]; vid.height = wh[1]; vid.poster = posterOf(n); vid.src = clipOf(n); vid.setAttribute('aria-label', 'Linea: ' + name); if (viewSeen) run(vid); }
        cap.textContent = name; frame.classList.remove('swap');
      }, calm ? 0 : 170);
    };
    // A clip (or, with reduced motion, its still) in every card, for phones; it loads only when the card comes near.
    cards.forEach(function (c) {
      var n = c.getAttribute('data-img'), wh = sizeOf(n), el;
      if (calm) { el = document.createElement('img'); el.alt = ''; el.loading = 'lazy'; el.decoding = 'async'; el.src = posterOf(n); }
      else { el = document.createElement('video'); el.muted = true; el.defaultMuted = true; el.loop = true; el.playsInline = true; el.setAttribute('muted', ''); el.setAttribute('playsinline', ''); el.preload = 'none'; el.poster = posterOf(n); el.setAttribute('data-src', clipOf(n)); el.setAttribute('aria-hidden', 'true'); }
      el.className = 'ss-pic'; el.width = wh[0]; el.height = wh[1];
      var body = c.querySelector('.ss-body'); if (body) body.insertBefore(el, body.firstChild);
    });
    cards.forEach(function (c) { c.addEventListener('click', function () { show(c); }); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) show(e.target); }); }, { rootMargin: '-46% 0px -46% 0px' });
      cards.forEach(function (c) { io.observe(c); });
      // The viewer plays only while it is on screen.
      new IntersectionObserver(function (es) { es.forEach(function (e) { viewSeen = e.isIntersecting; if (calm || phone.matches || vid.hidden) return; if (viewSeen) run(vid); else vid.pause(); }); }, { threshold: 0.2 }).observe(view);
      // Phones: a card's clip plays while at least half of it is on screen.
      if (!calm) {
        var vio = new IntersectionObserver(function (es) { es.forEach(function (e) { var v = e.target; if (!phone.matches || !e.isIntersecting) { v.pause(); return; } if (!v.getAttribute('src')) v.src = v.getAttribute('data-src'); run(v); }); }, { threshold: 0.5 });
        document.querySelectorAll('video.ss-pic').forEach(function (v) { vio.observe(v); });
      }
    }
    if (!phone.matches) show(cards[0]); else cur = cards[0];
  })();

  // The hero wheel: the player's own wheel drawn large behind it. One notch per spoken line; it turns one notch as each line
  // begins, so the current line always sits under NOW. Reduced motion: it still follows, without the spring.
  (function () {
    var wheel = document.querySelector('.hx-wheel'); if (!wheel) return;
    var nums = wheel.querySelector('.hx-nums'), tries = 0;
    var start = function () {
      var r = window.reel; if (!r || !r.controller) { if (tries++ < 40) setTimeout(start, 250); return; }
      var c = r.controller, built = 0;
      var build = function (count) {
        if (!count || count === built) return; built = count; nums.textContent = '';
        wheel.style.setProperty('--hx-n', count);
        for (var i = 0; i < count; i += 10) { var n = document.createElement('span'); n.textContent = String(i + 1).padStart(2, '0'); n.style.setProperty('--a', (i * 360 / count) + 'deg'); nums.appendChild(n); }
      };
      var last = -1;
      var sync = function (s) { build(s.count); if (s.index === last || !s.count) return; last = s.index; wheel.style.setProperty('--hx-turn', (-s.index * 360 / s.count).toFixed(3) + 'deg'); };
      sync(c.state()); c.subscribe(sync);
    };
    start();
  })();

  // Copy buttons.
  document.querySelectorAll('.sc-copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var code = b.parentElement.querySelector('code');
      if (!code || !navigator.clipboard) return;
      navigator.clipboard.writeText(code.textContent).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); });
    });
  });
})();
