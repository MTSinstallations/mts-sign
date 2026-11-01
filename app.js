'use strict';

// Point this at another host when production sign-off moves.
const API_BASE = 'https://djduaqegxwjnmjlzjdor.supabase.co/functions/v1/test-signoff-sign';

const STATEMENT = 'I confirm the installation was completed to my satisfaction.';
const FETCH_TIMEOUT_MS = 20000;
const MAX_SIGNATURE_CHARS = 1400000;

const HTML_ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const app = document.getElementById('app');
const announceEl = document.getElementById('announce');
const token = (new URLSearchParams(window.location.search).get('t') || '').trim();

let loadSeq = 0;
let loaded = null;
let activePad = null;
let submitting = false;

const FORMS = {
  costco: {
    title: 'Costco Installation Sign-Off',
    lede: 'Review the details, then sign to confirm the work.',
    body: costcoBody,
  },
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function announce(message) {
  if (!announceEl) return;
  announceEl.textContent = '';
  window.setTimeout(() => {
    announceEl.textContent = message;
  }, 30);
}

function unmountPad() {
  if (!activePad) return;
  activePad.destroy();
  activePad = null;
}

function setTheme(test) {
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', test ? '#ffe500' : '#10283f');
}

function bannerHtml() {
  return (
    '<div class="test-banner" role="status">' +
      '<p class="test-word">TEST</p>' +
      '<p class="test-note">This is a test sign-off, not a live customer record.</p>' +
    '</div>'
  );
}

function screen(options) {
  unmountPad();
  const state = options.state;
  const title = options.title;
  const lede = options.lede || '';
  const body = options.body || '';
  const test = options.test === true;
  const busy = options.busy === true;

  document.body.dataset.state = state;
  document.title = title + ' · MTS Installations';
  setTheme(test);
  app.setAttribute('aria-busy', busy ? 'true' : 'false');
  app.innerHTML =
    (test ? bannerHtml() : '') +
    '<header class="mast">' +
      '<div class="mast-inner">' +
        '<p class="brand"><span class="brand-mark" aria-hidden="true"></span>MTS Installations</p>' +
        '<h1>' + escapeHtml(title) + '</h1>' +
        (lede ? '<p class="lede">' + escapeHtml(lede) + '</p>' : '') +
      '</div>' +
    '</header>' +
    '<main class="content">' + body + '</main>' +
    '<footer class="foot"><p>MTS Installations</p></footer>';

  window.scrollTo(0, 0);
  if (busy) {
    announce(title);
    return;
  }
  const heading = app.querySelector('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function isTestRecord(data) {
  return !!(data && data.is_test === true) || !!(loaded && loaded.is_test === true);
}

function display(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '<span class="missing">Not provided</span>';
  return escapeHtml(raw);
}

function phoneHref(value) {
  const cleaned = String(value ?? '').replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return 'tel:' + cleaned;
}

function field(label, value, options) {
  const opts = options || {};
  const wide = opts.wide ? ' field-wide' : '';
  const pre = opts.pre ? ' class="pre"' : '';
  let shown = display(value);
  if (opts.phone && String(value ?? '').trim()) {
    const href = phoneHref(value);
    if (href) shown = '<a href="' + escapeHtml(href) + '">' + shown + '</a>';
  }
  return (
    '<div class="field' + wide + '">' +
      '<dt>' + escapeHtml(label) + '</dt>' +
      '<dd' + pre + '>' + shown + '</dd>' +
    '</div>'
  );
}

function formatWhen(value, mode) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  let date;
  if (dateOnly) {
    date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return raw;
  const withTime = mode === 'datetime' && !dateOnly;
  try {
    return new Intl.DateTimeFormat(undefined, withTime
      ? { dateStyle: 'long', timeStyle: 'short' }
      : { dateStyle: 'long' }).format(date);
  } catch {
    return raw;
  }
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function itemLines(items) {
  const source = Array.isArray(items)
    ? items
    : (typeof items === 'string' ? items.split(/,\s*/) : []);
  return source
    .map((item) => {
      if (item == null) return '';
      if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
      return '';
    })
    .filter(Boolean);
}

function itemsHtml(items) {
  const lines = itemLines(items);
  if (!lines.length) return '<p class="missing">No items listed</p>';
  return '<ul class="items">' + lines.map((line) => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul>';
}

function pdfHtml(url) {
  const safe = safeUrl(url);
  if (!safe) return '';
  const href = escapeHtml(safe);
  return (
    '<section class="card" aria-labelledby="doc-heading">' +
      '<h2 id="doc-heading">Installation document</h2>' +
      '<p class="pdf-actions"><a class="btn btn-secondary" id="pdf-link" href="' + href + '" target="_blank" rel="noopener noreferrer">Open the PDF</a></p>' +
      '<iframe class="preview" id="pdf-frame" title="Installation document preview" src="' + href + '" referrerpolicy="no-referrer"></iframe>' +
      '<p class="help spaced">If the preview is blank, use Open the PDF.</p>' +
    '</section>'
  );
}

function costcoBody(data) {
  const fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
  const installDate = formatWhen(fields.install_date, 'date');
  return (
    '<a class="skip" href="#sign-heading">Skip to signature</a>' +
    '<section class="card" aria-labelledby="details-heading">' +
      '<h2 id="details-heading">Installation details</h2>' +
      '<dl class="fields">' +
        field('Customer name', fields.customer_name, { wide: true }) +
        field('Phone', fields.phone, { phone: true }) +
        field('Account number', fields.account_number) +
        field('Store number', fields.store_number) +
        field('Work order', fields.work_order) +
        field('Install date', installDate || fields.install_date) +
        field('Address', fields.address, { wide: true, pre: true }) +
        field('Installer', fields.installer, { wide: true }) +
      '</dl>' +
      '<h3>Items installed</h3>' +
      itemsHtml(fields.items) +
    '</section>' +
    pdfHtml(data.pdf_view_url) +
    '<section class="card" aria-labelledby="sign-heading">' +
      '<h2 id="sign-heading">Signature</h2>' +
      '<form id="sign-form" novalidate>' +
        '<p class="statement">' + escapeHtml(STATEMENT) + '</p>' +
        '<p id="sign-help" class="help">Sign in the box with your finger. Submit stays off until a signature is drawn.</p>' +
        '<div class="pad" id="signature-pad">' +
          '<div class="pad-line" aria-hidden="true"></div>' +
          '<p class="pad-hint" aria-hidden="true">Sign here</p>' +
          '<canvas id="signature" width="320" height="200" draggable="false" aria-label="Signature drawing area" aria-describedby="sign-help">A signature box.</canvas>' +
        '</div>' +
        '<p id="form-error" class="form-error" role="alert" hidden></p>' +
        '<div class="actions">' +
          '<button type="button" class="btn btn-secondary" id="clear-signature">Clear</button>' +
          '<button type="submit" class="btn btn-primary" id="submit-signature" disabled>Submit signature</button>' +
        '</div>' +
      '</form>' +
    '</section>'
  );
}

function renderLoading() {
  screen({
    state: 'loading',
    title: 'Loading your sign-off',
    lede: 'This usually takes a moment.',
    busy: true,
    test: !!(loaded && loaded.is_test === true),
    body:
      '<section class="card">' +
        '<div class="spinner" aria-hidden="true"></div>' +
        '<p class="help">If this stays here, enable JavaScript and reload this page.</p>' +
      '</section>',
  });
}

function renderInvalid() {
  screen({
    state: 'invalid',
    title: "This link isn't valid",
    lede: 'Check that you opened the full link from your installer, or ask them to send a new one.',
    test: isTestRecord(null),
    body:
      '<section class="card status-card bad">' +
        '<h2>The link did not match a sign-off</h2>' +
        '<p class="help spaced">Nothing was signed.</p>' +
      '</section>',
  });
}

function renderExpired() {
  screen({
    state: 'expired',
    title: 'This link has expired',
    lede: 'This sign-off link is no longer active. Ask your installer for a new one.',
    test: isTestRecord(null),
    body:
      '<section class="card status-card warn">' +
        '<h2>The link timed out</h2>' +
        '<p class="help spaced">MTS Installations can send a fresh link if you still need to sign.</p>' +
      '</section>',
  });
}

function signedLede(signedAt, already) {
  const when = formatWhen(signedAt, 'datetime');
  if (already) {
    return when
      ? 'This installation was signed on ' + when + '.'
      : 'This installation has already been signed.';
  }
  return when
    ? 'Your signature was received on ' + when + '. You can close this page.'
    : 'Your signature was received. You can close this page.';
}

function renderAlreadySigned(data) {
  const signedAt = data && data.signed_at;
  screen({
    state: 'already-signed',
    title: 'Already signed',
    lede: signedLede(signedAt, true),
    test: isTestRecord(data),
    body:
      '<section class="card status-card">' +
        '<div class="mark" aria-hidden="true"></div>' +
        '<h2>No further signature is needed</h2>' +
        '<p class="help spaced">You can close this page.</p>' +
      '</section>',
  });
}

function renderThanks(data) {
  const signedAt = (data && data.signed_at) || (loaded && loaded.signed_at);
  screen({
    state: 'thanks',
    title: 'Signed, thank you',
    lede: signedLede(signedAt, false),
    test: isTestRecord(data),
    body:
      '<section class="card status-card">' +
        '<div class="mark" aria-hidden="true"></div>' +
        '<h2>Your sign-off is complete</h2>' +
        '<p class="help spaced">MTS Installations has your signature.</p>' +
      '</section>',
  });
}

function renderLoadError(message) {
  screen({
    state: 'error',
    title: 'Something went wrong',
    lede: message || "We couldn't load this sign-off. Check your connection and try again.",
    test: !!(loaded && loaded.is_test === true),
    body:
      '<section class="card status-card bad">' +
        '<h2>The sign-off did not load</h2>' +
        '<div class="actions">' +
          '<button type="button" class="btn btn-primary" id="retry">Try again</button>' +
        '</div>' +
      '</section>',
  });
  const retry = document.getElementById('retry');
  if (retry) retry.addEventListener('click', () => { load(); });
}

function renderUnsupported(data) {
  const kind = typeof data.form_type === 'string' && /^[a-z0-9_-]{1,40}$/i.test(data.form_type)
    ? data.form_type
    : '';
  const detail = kind
    ? 'This page does not support the "' + kind + '" form yet.'
    : 'This page does not support this form yet.';
  screen({
    state: 'unsupported',
    title: "This form isn't available",
    lede: 'Please contact MTS Installations and ask them to resend the sign-off.',
    test: data.is_test === true,
    body:
      '<section class="card status-card warn">' +
        '<h2>' + escapeHtml(detail) + '</h2>' +
      '</section>',
  });
}

function renderForm(data) {
  const form = FORMS[data.form_type];
  if (!form) {
    renderUnsupported(data);
    return;
  }
  submitting = false;
  screen({
    state: 'pending',
    title: form.title,
    lede: form.lede,
    test: data.is_test === true,
    body: form.body(data),
  });
  attachSignatureForm();
}

function setFormError(message) {
  const el = document.getElementById('form-error');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function attachSignatureForm() {
  const canvas = document.getElementById('signature');
  const padEl = document.getElementById('signature-pad');
  const form = document.getElementById('sign-form');
  const clearBtn = document.getElementById('clear-signature');
  const submitBtn = document.getElementById('submit-signature');
  if (!canvas || !padEl || !form || !clearBtn || !submitBtn) return;
  if (!canvas.getContext('2d')) {
    setFormError('This browser cannot record a signature in the box.');
    return;
  }

  let hasInk = false;
  activePad = createSignaturePad(canvas, () => {
    if (hasInk) return;
    hasInk = true;
    padEl.classList.add('has-ink');
    syncButtons();
    announce('Signature captured');
  });

  function syncButtons() {
    submitBtn.disabled = submitting || !hasInk;
    submitBtn.textContent = submitting ? 'Submitting...' : 'Submit signature';
    clearBtn.disabled = submitting;
    padEl.classList.toggle('is-locked', submitting);
  }

  clearBtn.addEventListener('click', () => {
    if (submitting || !activePad) return;
    activePad.clear();
    hasInk = false;
    padEl.classList.remove('has-ink');
    setFormError('');
    syncButtons();
    announce('Signature cleared');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting || !hasInk || !activePad) return;
    submitSignature(activePad, syncButtons);
  });

  syncButtons();
}

function createSignaturePad(canvas, onInk) {
  const context = canvas.getContext('2d');
  const pad = canvas.closest('.pad') || canvas;
  const strokes = [];
  let active = null;
  let pointerId = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let ratio = 1;
  let layoutAttempts = 0;
  let destroyed = false;
  let resizeTimer = 0;
  let inkNotified = false;

  canvas.style.touchAction = 'none';
  pad.style.touchAction = 'none';

  function dpr() {
    return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  }

  function paint() {
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.lineWidth = 2.75;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#142433';
    context.fillStyle = '#142433';
    strokes.forEach(drawStroke);
  }

  function drawStroke(points) {
    if (!points.length) return;
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, 1.45, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      context.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i += 1) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        context.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      const last = points[points.length - 1];
      context.lineTo(last.x, last.y);
    }
    context.stroke();
  }

  function layout() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      if (layoutAttempts < 30) {
        layoutAttempts += 1;
        window.requestAnimationFrame(layout);
      }
      return;
    }
    const width = rect.width;
    const height = rect.height;
    const nextRatio = dpr();
    if (width === cssWidth && height === cssHeight && nextRatio === ratio && canvas.width > 0) return;
    const prevW = cssWidth || width;
    const prevH = cssHeight || height;
    const sx = width / prevW;
    const sy = height / prevH;
    if (cssWidth && (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001)) {
      strokes.forEach((stroke) => {
        stroke.forEach((point) => {
          point.x *= sx;
          point.y *= sy;
        });
      });
    }
    cssWidth = width;
    cssHeight = height;
    ratio = nextRatio;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    paint();
  }

  function scheduleLayout() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, 50);
  }

  function localPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function notifyInk() {
    if (inkNotified) return;
    inkNotified = true;
    onInk();
  }

  function addPoint(x, y) {
    if (!active) return;
    const prev = active[active.length - 1];
    if (prev && Math.hypot(prev.x - x, prev.y - y) < 0.45) return;
    active.push({ x, y });
    notifyInk();
    paint();
  }

  function startStroke(x, y) {
    active = [];
    strokes.push(active);
    addPoint(x, y);
  }

  function endStroke() {
    active = null;
    pointerId = null;
  }

  function onPointerDown(event) {
    if (destroyed || submitting || pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* older browsers */ }
    const point = localPoint(event.clientX, event.clientY);
    startStroke(point.x, point.y);
  }

  function onPointerMove(event) {
    if (pointerId === null || event.pointerId !== pointerId || !active) return;
    event.preventDefault();
    const list = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
    const events = list && list.length ? list : [event];
    events.forEach((item) => {
      const point = localPoint(item.clientX, item.clientY);
      addPoint(point.x, point.y);
    });
  }

  function onPointerUp(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    event.preventDefault();
    endStroke();
  }

  function blockTouchScroll(event) {
    event.preventDefault();
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
    // iOS Safari still scrolls the page unless touchmove is cancelled.
    pad.addEventListener('touchstart', blockTouchScroll, { passive: false });
    pad.addEventListener('touchmove', blockTouchScroll, { passive: false });
  } else {
    pad.addEventListener('touchstart', (event) => {
      if (submitting) return;
      event.preventDefault();
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch || active) return;
      const point = localPoint(touch.clientX, touch.clientY);
      startStroke(point.x, point.y);
    }, { passive: false });
    pad.addEventListener('touchmove', (event) => {
      event.preventDefault();
      if (!active) return;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const point = localPoint(touch.clientX, touch.clientY);
      addPoint(point.x, point.y);
    }, { passive: false });
    const finishTouch = (event) => {
      event.preventDefault();
      endStroke();
    };
    pad.addEventListener('touchend', finishTouch, { passive: false });
    pad.addEventListener('touchcancel', finishTouch, { passive: false });
  }

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(scheduleLayout);
    observer.observe(pad);
  } else {
    window.addEventListener('resize', scheduleLayout);
  }
  window.addEventListener('orientationchange', scheduleLayout);
  layout();

  function toDataUrl() {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const off = offscreen.getContext('2d');
    if (!off) return '';
    off.fillStyle = '#ffffff';
    off.fillRect(0, 0, offscreen.width, offscreen.height);
    off.drawImage(canvas, 0, 0);
    return offscreen.toDataURL('image/png');
  }

  return {
    clear() {
      strokes.splice(0, strokes.length);
      endStroke();
      inkNotified = false;
      paint();
    },
    toDataUrl,
    destroy() {
      destroyed = true;
      window.clearTimeout(resizeTimer);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('orientationchange', scheduleLayout);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      pad.removeEventListener('touchstart', blockTouchScroll);
      pad.removeEventListener('touchmove', blockTouchScroll);
    },
  };
}

function normalizePngDataUrl(url) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(url || '');
  if (!match) return null;
  const b64 = match[1].replace(/\s+/g, '');
  if (!b64 || b64.length % 4 === 1 || b64.length > MAX_SIGNATURE_CHARS) return null;
  const normalized = 'data:image/png;base64,' + b64;
  try {
    const header = atob(b64.slice(0, 16));
    if (header.charCodeAt(0) !== 0x89 || header.charCodeAt(1) !== 0x50) return null;
  } catch {
    return null;
  }
  return normalized;
}

function submitMessage(status) {
  if (status === 400) return 'That signature could not be read. Clear it and sign again.';
  if (status === 413) return 'That signature is too large to send. Clear it and sign again.';
  return "We couldn't submit your signature. Check your connection and try again.";
}

async function submitSignature(pad, syncButtons) {
  if (submitting) return;
  submitting = true;
  syncButtons();
  setFormError('');

  let signature;
  try {
    signature = normalizePngDataUrl(pad.toDataUrl());
  } catch {
    signature = null;
  }
  if (!signature) {
    submitting = false;
    syncButtons();
    setFormError('We could not read that signature. Clear it and sign again.');
    return;
  }

  let response;
  try {
    response = await fetchWithTimeout(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ token, signature }),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    submitting = false;
    syncButtons();
    const timedOut = error && error.name === 'AbortError';
    setFormError(timedOut
      ? 'The request timed out. Check your connection and try again.'
      : "We couldn't submit your signature. Check your connection and try again.");
    return;
  }

  const body = await parseJson(response);
  if (response.status === 409 || (body && body.error === 'already_signed')) {
    renderAlreadySigned({
      is_test: !!(loaded && loaded.is_test === true),
      signed_at: body && body.signed_at,
    });
    return;
  }
  if (response.status === 410 || (body && body.status === 'expired' && !response.ok)) {
    renderExpired();
    return;
  }
  if (response.status === 404) {
    renderInvalid();
    return;
  }
  if (response.ok && body && body.status === 'signed') {
    renderThanks(body);
    return;
  }

  submitting = false;
  syncButtons();
  if (!document.getElementById('sign-form')) return;
  setFormError(body
    ? submitMessage(response.status)
    : 'The sign-off service sent an unexpected response. Please try again.');
}

function apiLoadUrl() {
  const url = new URL(API_BASE);
  url.searchParams.set('t', token);
  url.searchParams.set('format', 'json');
  return url.toString();
}

async function parseJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function fetchWithTimeout(url, options) {
  if (typeof AbortController !== 'function') return fetch(url, options);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => window.clearTimeout(timer));
}

async function handleLoadResponse(response, seq) {
  if (response.status === 404) {
    renderInvalid();
    return;
  }
  const data = await parseJson(response);
  if (seq !== loadSeq) return;
  if (!data) {
    renderLoadError('The sign-off service sent an unexpected response. Please try again.');
    return;
  }
  if (data.is_test === true) loaded = data;
  if (response.status === 410 || data.status === 'expired') {
    loaded = data;
    renderExpired();
    return;
  }
  if (response.status === 409 || data.status === 'signed') {
    loaded = data;
    renderAlreadySigned(data);
    return;
  }
  if (!response.ok || data.status !== 'pending') {
    renderLoadError("We couldn't load this sign-off. Please try again.");
    return;
  }
  loaded = data;
  renderForm(data);
}

async function load() {
  const seq = ++loadSeq;
  submitting = false;
  if (!token) {
    renderInvalid();
    return;
  }
  renderLoading();
  try {
    const response = await fetchWithTimeout(apiLoadUrl(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (seq !== loadSeq) return;
    await handleLoadResponse(response, seq);
  } catch (error) {
    if (seq !== loadSeq) return;
    const timedOut = error && error.name === 'AbortError';
    renderLoadError(timedOut
      ? 'The request timed out. Check your connection and try again.'
      : "We couldn't reach the sign-off service. Check your connection and try again.");
  }
}

function init() {
  load().catch(() => {
    renderLoadError('This page hit a problem. Please try again.');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
