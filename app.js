'use strict';

// Point this at another host when production sign-off moves.
const API_BASE = 'https://djduaqegxwjnmjlzjdor.supabase.co/functions/v1/test-signoff-sign';

const FETCH_TIMEOUT_MS = 20000;
const MAX_SIGNATURE_CHARS = 1400000;
const PAGE_FALLBACK_W = 612;
const PAGE_FALLBACK_H = 792;

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
let padHasInk = false;
let announceTimer = 0;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]);
}

function announce(message) {
  if (!announceEl) return;
  window.clearTimeout(announceTimer);
  announceEl.textContent = '';
  announceTimer = window.setTimeout(() => {
    announceEl.textContent = message;
  }, 30);
}

function unmountPad() {
  if (!activePad) return;
  activePad.destroy();
  activePad = null;
}

function cleanupForm() {
  document.body.classList.remove('is-form', 'modal-open');
  window.removeEventListener('resize', fitAllText);
  document.removeEventListener('keydown', onEscape);
  unmountPad();
}

function setTheme(test) {
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', test ? '#ffe500' : '#10283f');
}

function bannerHtml() {
  return '<div class="test-banner" role="status">TEST</div>';
}

function screen(options) {
  cleanupForm();
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
  announce(lede ? title + '. ' + lede : title);
  if (busy) return;
  const heading = app.querySelector('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function isTestRecord(data) {
  return !!(data && data.is_test === true) || !!(loaded && loaded.is_test === true);
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

function pacificStamp(date) {
  const zone = { timeZone: 'America/Los_Angeles' };
  return {
    date: date.toLocaleDateString('en-US', Object.assign({ month: '2-digit', day: '2-digit', year: 'numeric' }, zone)),
    time: date.toLocaleTimeString('en-US', Object.assign({ hour: 'numeric', minute: '2-digit', hour12: true }, zone)),
  };
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderLoading() {
  cleanupForm();
  document.body.dataset.state = 'loading';
  document.title = 'Loading your sign-off · MTS Installations';
  setTheme(!!(loaded && loaded.is_test === true));
  app.setAttribute('aria-busy', 'true');
  app.replaceChildren();
  if (loaded && loaded.is_test === true) {
    const banner = document.createElement('div');
    banner.className = 'test-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'TEST';
    app.appendChild(banner);
  }
  const note = document.createElement('p');
  note.className = 'boot';
  note.textContent = 'Loading your sign-off';
  app.appendChild(note);
  announce('Loading your sign-off');
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
  const kind = data && typeof data.form_type === 'string' && /^[a-z0-9_-]{1,40}$/i.test(data.form_type)
    ? data.form_type
    : '';
  const detail = kind
    ? 'This page does not support the "' + kind + '" form yet.'
    : 'This page does not support this form yet.';
  screen({
    state: 'unsupported',
    title: "This form isn't available",
    lede: 'Please contact MTS Installations and ask them to resend the sign-off.',
    test: !!(data && data.is_test === true),
    body:
      '<section class="card status-card warn">' +
        '<h2>' + escapeHtml(detail) + '</h2>' +
      '</section>',
  });
}

function pageAlt(pageNumber) {
  if (Number(pageNumber) === 2) return 'Window Treatments Completion Verification';
  if (Number(pageNumber) === 1) return 'Window Treatments Installation Authorization';
  return 'Costco form page ' + String(pageNumber);
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function buildOverlay(overlay, pageW, pageH) {
  if (!overlay || typeof overlay !== 'object') return null;
  const x = Number(overlay.x);
  const y = Number(overlay.y);
  const w = Number(overlay.w);
  const h = Number(overlay.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  const el = document.createElement('div');
  el.className = 'overlay';
  const key = typeof overlay.key === 'string' ? overlay.key : '';
  el.dataset.key = key;
  el.style.left = (x / pageW * 100) + '%';
  el.style.top = (y / pageH * 100) + '%';
  el.style.width = (w / pageW * 100) + '%';
  el.style.height = (h / pageH * 100) + '%';
  const label = typeof overlay.label === 'string' && overlay.label ? overlay.label : key;
  if (key === 'signature') el.classList.add('is-signature');
  if (overlay.fill_at_signing === true) {
    el.dataset.fill = '1';
    el.setAttribute('aria-label', label);
    return el;
  }
  const value = overlay.value == null ? '' : String(overlay.value);
  if (value) {
    const span = document.createElement('span');
    span.className = 'fit';
    span.textContent = value;
    el.appendChild(span);
  }
  el.setAttribute('aria-label', value ? label + ': ' + value : label);
  return el;
}

function fitOne(el) {
  const box = el.parentElement;
  if (!box) return;
  const style = window.getComputedStyle(box);
  const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  const maxW = box.clientWidth - padX;
  const maxH = box.clientHeight * 0.8;
  if (maxW < 4 || maxH < 4) return;
  let lo = 5;
  let hi = Math.max(lo, maxH);
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= maxW + 0.5) lo = mid;
    else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}

function fitAllText() {
  document.querySelectorAll('.overlay .fit').forEach(fitOne);
}

function onImageError() {
  if (document.body.dataset.state !== 'pending') return;
  renderLoadError("The form image didn't load. Please try again.");
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

function setSignButton(label, disabled) {
  const button = document.getElementById('open-sign');
  if (!button) return;
  button.textContent = label;
  button.disabled = disabled;
}

function renderPages(data) {
  cleanupForm();
  submitting = false;
  const pages = (Array.isArray(data.pages) ? data.pages : [])
    .filter((page) => page && typeof page === 'object')
    .slice()
    .sort((a, b) => Number(a.page) - Number(b.page));

  const sheets = document.createElement('div');
  sheets.className = 'sheets';
  let rendered = 0;
  pages.forEach((page) => {
    const src = httpsUrl(page.image_url);
    if (!src) return;
    const pageW = positive(page.width, PAGE_FALLBACK_W);
    const pageH = positive(page.height, PAGE_FALLBACK_H);
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.style.aspectRatio = pageW + ' / ' + pageH;
    const img = document.createElement('img');
    img.className = 'page-image';
    img.alt = pageAlt(page.page);
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', fitAllText);
    img.addEventListener('error', onImageError);
    img.src = src;
    sheet.appendChild(img);
    (Array.isArray(page.overlays) ? page.overlays : []).forEach((overlay) => {
      const node = buildOverlay(overlay, pageW, pageH);
      if (node) sheet.appendChild(node);
    });
    sheets.appendChild(sheet);
    rendered += 1;
  });

  if (!rendered) {
    renderUnsupported(data);
    return;
  }

  document.body.dataset.state = 'pending';
  document.body.classList.add('is-form');
  document.title = 'Costco sign-off · MTS Installations';
  setTheme(data.is_test === true);
  app.setAttribute('aria-busy', 'false');
  app.replaceChildren();

  if (data.is_test === true) {
    const banner = document.createElement('div');
    banner.className = 'test-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'TEST';
    app.appendChild(banner);
  }

  const heading = document.createElement('h1');
  heading.className = 'sr-only';
  heading.textContent = 'Costco sign-off';
  app.appendChild(heading);
  app.appendChild(sheets);

  const bar = document.createElement('div');
  bar.className = 'sign-bar';
  const error = document.createElement('p');
  error.id = 'form-error';
  error.className = 'form-error';
  error.hidden = true;
  error.setAttribute('role', 'alert');
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-primary';
  open.id = 'open-sign';
  open.textContent = 'Sign';
  open.addEventListener('click', openPad);
  bar.append(error, open);
  app.appendChild(bar);
  app.appendChild(buildPadModal());

  window.addEventListener('resize', fitAllText);
  window.requestAnimationFrame(fitAllText);
  window.scrollTo(0, 0);
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  announce('Costco sign-off');
}

function buildPadModal() {
  const modal = document.createElement('div');
  modal.className = 'pad-modal';
  modal.id = 'pad-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'pad-title');

  const title = document.createElement('h2');
  title.id = 'pad-title';
  title.textContent = 'Sign both pages';

  const help = document.createElement('p');
  help.id = 'sign-help';
  help.className = 'help';
  help.textContent = 'Sign with your finger.';

  const pad = document.createElement('div');
  pad.className = 'pad';
  pad.id = 'signature-pad';
  const line = document.createElement('div');
  line.className = 'pad-line';
  line.setAttribute('aria-hidden', 'true');
  const hint = document.createElement('p');
  hint.className = 'pad-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = 'Sign here';
  const canvas = document.createElement('canvas');
  canvas.id = 'signature';
  canvas.width = 320;
  canvas.height = 200;
  canvas.draggable = false;
  canvas.setAttribute('aria-label', 'Signature drawing area');
  canvas.setAttribute('aria-describedby', 'sign-help');
  canvas.textContent = 'A signature box.';
  pad.append(line, hint, canvas);

  const padError = document.createElement('p');
  padError.id = 'pad-error';
  padError.className = 'form-error';
  padError.hidden = true;
  padError.setAttribute('role', 'alert');

  const actions = document.createElement('div');
  actions.className = 'pad-actions';
  const row = document.createElement('div');
  row.className = 'row';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn-secondary';
  clear.id = 'clear-signature';
  clear.textContent = 'Clear';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary';
  cancel.id = 'cancel-sign';
  cancel.textContent = 'Cancel';
  row.append(clear, cancel);
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-primary';
  confirm.id = 'submit-signature';
  confirm.textContent = 'Sign both pages';
  confirm.disabled = true;
  actions.append(row, confirm);

  modal.append(title, help, pad, padError, actions);
  clear.addEventListener('click', clearPad);
  cancel.addEventListener('click', closePad);
  confirm.addEventListener('click', confirmSign);
  return modal;
}

function setPadError(message) {
  const el = document.getElementById('pad-error');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function syncPadButtons() {
  const submitBtn = document.getElementById('submit-signature');
  const clearBtn = document.getElementById('clear-signature');
  const padEl = document.getElementById('signature-pad');
  if (submitBtn) {
    submitBtn.disabled = submitting || !padHasInk;
    submitBtn.textContent = 'Sign both pages';
  }
  if (clearBtn) clearBtn.disabled = submitting;
  if (padEl) padEl.classList.toggle('is-locked', submitting);
}

function onEscape(event) {
  if (event.key === 'Escape') closePad();
}

function openPad() {
  if (submitting) return;
  const modal = document.getElementById('pad-modal');
  const canvas = document.getElementById('signature');
  const padEl = document.getElementById('signature-pad');
  if (!modal || !canvas || !padEl) return;
  if (!canvas.getContext('2d')) {
    setFormError('This browser cannot record a signature in the box.');
    return;
  }
  unmountPad();
  padHasInk = false;
  padEl.classList.remove('has-ink');
  setPadError('');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onEscape);
  window.requestAnimationFrame(() => {
    if (modal.hidden) return;
    activePad = createSignaturePad(canvas, () => {
      if (padHasInk) return;
      padHasInk = true;
      padEl.classList.add('has-ink');
      syncPadButtons();
      announce('Signature captured');
    });
    syncPadButtons();
  });
  if (!modal.hasAttribute('tabindex')) modal.tabIndex = -1;
  modal.focus({ preventScroll: true });
}

function clearPad() {
  if (submitting || !activePad) return;
  activePad.clear();
  padHasInk = false;
  const padEl = document.getElementById('signature-pad');
  if (padEl) padEl.classList.remove('has-ink');
  setPadError('');
  syncPadButtons();
  announce('Signature cleared');
}

function closePad() {
  const modal = document.getElementById('pad-modal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', onEscape);
  unmountPad();
  padHasInk = false;
  const opener = document.getElementById('open-sign');
  if (opener) opener.focus({ preventScroll: true });
}

function paintSigning(signature) {
  const stamp = pacificStamp(new Date());
  document.querySelectorAll('.overlay').forEach((el) => {
    const key = el.dataset.key;
    if (key === 'signature') {
      el.classList.add('filled');
      el.replaceChildren();
      const img = document.createElement('img');
      img.alt = '';
      img.src = signature;
      el.appendChild(img);
      el.setAttribute('aria-label', 'Member signature');
      return;
    }
    if (key !== 'date' && key !== 'time') return;
    const span = document.createElement('span');
    span.className = 'fit';
    span.textContent = key === 'date' ? stamp.date : stamp.time;
    el.replaceChildren(span);
    el.setAttribute('aria-label', (key === 'date' ? 'Date: ' : 'Time: ') + span.textContent);
  });
  fitAllText();
}

async function confirmSign() {
  if (submitting || !padHasInk || !activePad) return;
  let signature = null;
  try {
    signature = normalizePngDataUrl(activePad.toDataUrl());
  } catch {
    signature = null;
  }
  if (!signature) {
    setPadError('We could not read that signature. Clear it and sign again.');
    return;
  }
  submitting = true;
  syncPadButtons();
  closePad();
  setSignButton('Signing...', true);
  setFormError('');
  paintSigning(signature);
  await postSignature(signature);
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
    const width = canvas.width;
    const height = canvas.height;
    let pixels;
    try {
      pixels = context.getImageData(0, 0, width, height).data;
    } catch {
      return '';
    }
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3] < 16) continue;
        if (pixels[i] > 246 && pixels[i + 1] > 246 && pixels[i + 2] > 246) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return '';
    const padPx = Math.max(4, Math.round(8 * ratio));
    minX = Math.max(0, minX - padPx);
    minY = Math.max(0, minY - padPx);
    maxX = Math.min(width - 1, maxX + padPx);
    maxY = Math.min(height - 1, maxY + padPx);
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const offscreen = document.createElement('canvas');
    offscreen.width = cropW;
    offscreen.height = cropH;
    const off = offscreen.getContext('2d');
    if (!off) return '';
    off.fillStyle = '#ffffff';
    off.fillRect(0, 0, cropW, cropH);
    off.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
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

async function postSignature(signature) {
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
    setSignButton('Sign', false);
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
  if (!document.getElementById('open-sign')) return;
  setSignButton('Sign', false);
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

function hasPages(data) {
  return Array.isArray(data.pages) && data.pages.length > 0;
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
  if (!hasPages(data)) {
    renderUnsupported(data);
    return;
  }
  renderPages(data);
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
