// --- Google sign-in + aircraft collection ---
// A new, mostly self-contained concern: no other file in this app has any
// user/session notion. Loaded after sidebar-track.js (needs its globals —
// selectedIcao24, buildMergedDetails, galleryCache, detailsById — to
// snapshot the currently-selected aircraft) and state-filters.js (reuses
// CATEGORY_ICON_SVGS.unknown for the empty-state illustration and the
// category-group taxonomy for grouping), and before icons.js/render-
// details.js/parsers.js/main.js, none of which depend on anything defined
// here.

// Account widget: a "Sign in with Google" button (signed out) or an avatar
// pill that opens a dropdown menu (signed in) — see index.html's
// #account-bar, pinned to the top-right corner above #hud. Only one of
// #google-signin-btn/#user-menu is ever shown at a time (toggled via the
// `hidden` attribute in renderAuthStatus()).
const googleSigninBtn = document.getElementById('google-signin-btn');
const userMenuEl = document.getElementById('user-menu');
const userMenuTrigger = document.getElementById('user-menu-trigger');
const userAvatarEl = document.getElementById('user-avatar');
const userMenuNameEl = document.getElementById('user-menu-name');
const userMenuEmailEl = document.getElementById('user-menu-email');
const userMenuCollectionBtn = document.getElementById('user-menu-collection');
const userMenuLogoutBtn = document.getElementById('user-menu-logout');
const collectionPanelEl = document.getElementById('collection-panel');
const collectionPanelTitleEl = document.getElementById('collection-panel-title');
const collectionPanelGridEl = document.getElementById('collection-panel-grid');
const collectionPanelCloseBtn = document.getElementById('collection-panel-close');
const sidebarSaveCollectionBtn = document.getElementById('sidebar-save-collection');

let currentUser = null; // { sub, email, name, picture } | null

// icao24 -> card, mirrors this session's view of the server's collection —
// refreshed after login and kept in sync on every save/unsave (never
// re-fetched just to open the panel, since that would also silently drop
// the removedCards ghosts below, which the server has no memory of at all).
const savedCardsByIcao = new Map();

// id -> card, aircraft the user just removed from the panel this session.
// The DELETE already happened for real (see removeCardWithUndo) — this Map
// exists purely so the panel can still render a dimmed "Removed · Undo"
// ghost for the rest of the session. Cleared for free on page reload, which
// is exactly the intended "gone for good after a refresh" behavior.
const removedCards = new Map();

// Same weight-class order as #category-filter's dropdown in index.html,
// reused here as the group ordering for the collection panel — a saved
// aircraft's own categoryGroup, not its literal model string, decides which
// group it lands in.
const COLLECTION_GROUP_ORDER = [
  'light', 'small', 'large', 'high_vortex_large', 'heavy', 'high_performance',
  'rotorcraft', 'glider', 'lighter_than_air', 'parachutist', 'ultralight',
  'uav', 'surface_obstacle', 'unknown',
];
const COLLECTION_GROUP_LABELS = {
  light: 'Light', small: 'Small', large: 'Large',
  high_vortex_large: 'High vortex large', heavy: 'Heavy',
  high_performance: 'High performance', rotorcraft: 'Rotorcraft',
  glider: 'Glider / sailplane', lighter_than_air: 'Lighter-than-air',
  parachutist: 'Parachutist / skydiver', ultralight: 'Ultralight / hang-glider',
  uav: 'UAV', surface_obstacle: 'Surface vehicle / obstacle',
  unknown: 'Unknown / no info',
};

// The exact bookmark glyph already used for #sidebar-save-collection in
// index.html — duplicated here as a string so the panel's per-card toggle
// button (built dynamically) renders the same icon language. Filled vs
// outline is a pure CSS concern (see .saved svg path in style.css), so one
// markup string serves both states.
const BOOKMARK_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '</svg>';

// Reuses the existing "no ADS-B info" glyph (state-filters.js's own
// CATEGORY_ICON_SVGS, loaded before this file) rather than inventing a
// second illustration — this is a static, trusted constant, never touched
// by user/external data, so building it via string concatenation (not DOM
// methods) is fine, unlike the card rendering below.
const EMPTY_STATE_ICON_SVG = '<svg viewBox="' + CATEGORY_ICON_SVGS.unknown.viewBox + '">' +
  CATEGORY_ICON_SVGS.unknown.inner + '</svg>';

// A plain gray-silhouette placeholder for a signed-in user with no Google
// profile photo (picture: null is a real, expected value, not an error) or
// whose photo URL fails to load — an inline data: SVG, not a network
// request, so it never itself needs a fallback.
const DEFAULT_AVATAR_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="12" fill="#cbd5e1"/>' +
  '<circle cx="12" cy="9.5" r="4" fill="#fff"/>' +
  '<path d="M4 21c1.4-4.2 5-6 8-6s6.6 1.8 8 6" fill="#fff"/></svg>');

function renderAuthStatus() {
  closeUserMenu();
  if (currentUser) {
    googleSigninBtn.hidden = true;
    userMenuEl.hidden = false;
    userAvatarEl.src = currentUser.picture || DEFAULT_AVATAR_SVG;
    userMenuNameEl.textContent = currentUser.name || currentUser.email;
    userMenuEmailEl.textContent = currentUser.email || '';
  } else {
    googleSigninBtn.hidden = false;
    userMenuEl.hidden = true;
  }
  updateSaveButtonState();
}

function closeUserMenu() {
  userMenuEl.classList.remove('open');
}

async function fetchCollectionCards() {
  if (!currentUser) return [];
  try {
    const resp = await fetch('/api/collection');
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.cards || [];
  } catch (err) {
    return [];
  }
}

async function checkAuth() {
  try {
    const resp = await fetch('/api/me');
    const data = await resp.json();
    currentUser = data.user || null;
  } catch (err) {
    currentUser = null;
  }
  renderAuthStatus();
  if (currentUser) {
    savedCardsByIcao.clear();
    for (const card of await fetchCollectionCards()) savedCardsByIcao.set(card.icao24, card);
    updateSaveButtonState();
  }
}

// A full-page navigation, not fetch() — OAuth needs a real browser redirect
// to Google's consent screen, not an XHR.
googleSigninBtn.addEventListener('click', () => {
  window.location.href = '/api/login/google';
});

userAvatarEl.addEventListener('error', () => { userAvatarEl.src = DEFAULT_AVATAR_SVG; });

// Same open/close-on-outside-click pattern as #category-filter/#basemap-filter
// in state-filters.js — stopPropagation on the trigger so this click doesn't
// immediately re-close the menu it just opened via the document listener.
userMenuTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  userMenuEl.classList.toggle('open');
});
document.addEventListener('click', closeUserMenu);

userMenuLogoutBtn.addEventListener('click', async () => {
  closeUserMenu();
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  savedCardsByIcao.clear();
  removedCards.clear();
  renderAuthStatus();
  collectionPanelEl.setAttribute('hidden', '');
});

userMenuCollectionBtn.addEventListener('click', () => {
  closeUserMenu();
  collectionPanelEl.removeAttribute('hidden');
  renderCollectionPanelFromState();
});

// --- Save-to-collection (sidebar button) ---

// Reflects whether the selected aircraft is already saved (filled vs
// outline) and the no-selection state. A "C0" (ADS-B: surface vehicle, no
// category info at all) or a ground vehicle/tower flagged by
// looksLikeGroundVehicle() (see state-filters.js — not always caught by
// "C0" alone, e.g. a plain registration/callsign heuristic match with no
// category code at all, like a "TWR" beacon) isn't a real aircraft to
// collect, so the button is hidden entirely rather than shown disabled —
// there's nothing meaningful to save, so no control should imply otherwise.
function updateSaveButtonState() {
  if (!sidebarSaveCollectionBtn) return;
  if (selectedIcao24 == null) {
    sidebarSaveCollectionBtn.classList.remove('saved');
    sidebarSaveCollectionBtn.hidden = false;
    sidebarSaveCollectionBtn.removeAttribute('title');
    return;
  }
  const details = detailsById.get(selectedIcao24);
  const notCollectible = !!(details && (details.categoryCode === 'C0' || details.isGroundVehicle));
  sidebarSaveCollectionBtn.hidden = notCollectible;
  if (notCollectible) return;
  sidebarSaveCollectionBtn.title = savedCardsByIcao.has(selectedIcao24)
    ? 'Remove from collection' : 'Save to collection';
  sidebarSaveCollectionBtn.classList.toggle('saved', savedCardsByIcao.has(selectedIcao24));
}

async function saveCurrentAircraftToCollection() {
  if (selectedIcao24 == null || sidebarSaveCollectionBtn.hidden) return;
  if (!currentUser) {
    window.location.href = '/api/login/google';
    return;
  }
  if (savedCardsByIcao.has(selectedIcao24)) {
    await unsaveAircraft(selectedIcao24);
    return;
  }
  const details = detailsById.get(selectedIcao24);
  const merged = buildMergedDetails(selectedIcao24);
  const photos = galleryCache.get(selectedIcao24) || [];
  const photo = photos[0];
  const body = {
    icao24: selectedIcao24,
    snapshot: merged.info,
    category_code: details && details.categoryCode,
    is_ground_vehicle: !!(details && details.isGroundVehicle),
    photo_url: photo ? ((photo.thumbnail_large && photo.thumbnail_large.src) || null) : null,
    photo_link: photo ? (photo.link || null) : null,
    photo_photographer: photo ? (photo.photographer || null) : null,
  };
  try {
    const resp = await fetch('/api/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const card = await resp.json();
      savedCardsByIcao.set(selectedIcao24, card);
      updateSaveButtonState();
      if (!collectionPanelEl.hasAttribute('hidden')) renderCollectionPanelFromState();
    }
  } catch (err) {
    // Best-effort — a failed save just leaves the button unmarked.
  }
}

// Sidebar unsave: immediate, no ghost/undo of its own (unlike the panel's
// removeCardWithUndo below) — there's no list context here, and re-saving
// from the sidebar is trivial since the live snapshot is right there.
async function unsaveAircraft(icao24) {
  const card = savedCardsByIcao.get(icao24);
  if (!card) return;
  try {
    const resp = await fetch(`/api/collection/${card.id}`, { method: 'DELETE' });
    if (resp.ok) {
      savedCardsByIcao.delete(icao24);
      updateSaveButtonState();
      if (!collectionPanelEl.hasAttribute('hidden')) renderCollectionPanelFromState();
    }
  } catch (err) {
    // Best-effort.
  }
}

if (sidebarSaveCollectionBtn) {
  sidebarSaveCollectionBtn.addEventListener('click', saveCurrentAircraftToCollection);
}

// --- Collection panel ---

function renderCollectionCard(card) {
  const el = document.createElement('div');
  el.className = 'collection-card';

  const photoWrap = document.createElement('div');
  photoWrap.className = 'collection-card-photo-wrap';
  if (card.photo_url) {
    const img = document.createElement('img');
    img.src = card.photo_url;
    img.alt = (card.snapshot && card.snapshot.registration) || card.icao24 || '';
    img.addEventListener('error', () => {
      photoWrap.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'collection-card-photo-placeholder';
      placeholder.textContent = 'No photo';
      photoWrap.appendChild(placeholder);
    });
    photoWrap.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'collection-card-photo-placeholder';
    placeholder.textContent = 'No photo';
    photoWrap.appendChild(placeholder);
  }
  el.appendChild(photoWrap);

  // Compact body: registration/ICAO as the title, aircraft type as the one
  // subtitle line — photo + type are the two things this card is required
  // to always show, so operator/etc are left out to keep it compact.
  const body = document.createElement('div');
  body.className = 'collection-card-body';

  const title = document.createElement('div');
  title.className = 'collection-card-title';
  title.textContent = (card.snapshot && card.snapshot.registration) || card.icao24 || 'Unknown';
  body.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'collection-card-subtitle';
  subtitle.textContent = (card.snapshot && card.snapshot.aircraftType) || 'Unknown type';
  body.appendChild(subtitle);

  el.appendChild(body);

  if (card._removed) {
    el.classList.add('removed');
    const overlay = document.createElement('div');
    overlay.className = 'collection-card-removed-overlay';
    const label = document.createElement('div');
    label.className = 'collection-card-removed-label';
    label.textContent = 'Removed';
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'collection-card-undo-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => undoRemoveCard(card));
    overlay.appendChild(label);
    overlay.appendChild(undoBtn);
    el.appendChild(overlay);
    return el;
  }

  const iconBtn = document.createElement('button');
  iconBtn.type = 'button';
  iconBtn.className = 'collection-card-icon-btn saved';
  iconBtn.setAttribute('aria-label', 'Remove from collection');
  iconBtn.title = 'Remove from collection';
  iconBtn.innerHTML = BOOKMARK_ICON_SVG;
  iconBtn.addEventListener('click', () => removeCardWithUndo(card));
  el.appendChild(iconBtn);

  return el;
}

function renderEmptyState(title, hint) {
  const wrap = document.createElement('div');
  wrap.id = 'collection-panel-empty';
  const icon = document.createElement('div');
  icon.className = 'collection-empty-icon';
  icon.innerHTML = EMPTY_STATE_ICON_SVG;
  const titleEl = document.createElement('div');
  titleEl.className = 'collection-empty-title';
  titleEl.textContent = title;
  wrap.appendChild(icon);
  wrap.appendChild(titleEl);
  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'collection-empty-hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }
  collectionPanelGridEl.appendChild(wrap);
}

// Renders from the two in-memory Maps (savedCardsByIcao + removedCards)
// rather than re-fetching — reopening the panel within the same session
// must still show any dimmed "Removed · Undo" ghosts, which the server has
// no record of at all (see removedCards above).
function renderCollectionPanelFromState() {
  const liveCards = Array.from(savedCardsByIcao.values());
  const ghostCards = Array.from(removedCards.values()).map((c) => Object.assign({}, c, { _removed: true }));
  renderCollectionPanel(liveCards.concat(ghostCards), liveCards.length);
}

function renderCollectionPanel(cards, liveCount) {
  collectionPanelGridEl.innerHTML = '';
  collectionPanelTitleEl.textContent = 'My collection' + (liveCount ? ` · ${liveCount}` : '');

  if (!currentUser) {
    renderEmptyState('Sign in to see your collection', 'Sign in with Google, then save aircraft you like to see them here.');
    return;
  }
  if (cards.length === 0) {
    renderEmptyState('No saved aircraft yet', "Tap the bookmark icon on an aircraft's details panel to add it here.");
    return;
  }

  const byGroup = new Map();
  for (const card of cards) {
    const group = (card.snapshot && card.snapshot.categoryGroup) || 'unknown';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(card);
  }
  for (const group of COLLECTION_GROUP_ORDER) {
    const groupCards = byGroup.get(group);
    if (!groupCards || !groupCards.length) continue;
    groupCards.sort((a, b) => b.saved_at - a.saved_at);

    const header = document.createElement('div');
    header.className = 'collection-group-header';
    const liveInGroup = groupCards.filter((c) => !c._removed).length;
    header.textContent = `${COLLECTION_GROUP_LABELS[group] || group}` + (liveInGroup ? ` · ${liveInGroup}` : '');
    collectionPanelGridEl.appendChild(header);

    const groupGrid = document.createElement('div');
    groupGrid.className = 'collection-group-grid';
    for (const card of groupCards) groupGrid.appendChild(renderCollectionCard(card));
    collectionPanelGridEl.appendChild(groupGrid);
  }
}

// Deletes for real immediately (no confirmation dialog), but keeps a
// dimmed ghost with an Undo action in the panel for the rest of the
// session — "elegant" removal per the owner's request, rather than either
// a blocking confirm() or a silent, unrecoverable vanish.
async function removeCardWithUndo(card) {
  try {
    const resp = await fetch(`/api/collection/${card.id}`, { method: 'DELETE' });
    if (!resp.ok) return;
  } catch (err) {
    return;
  }
  savedCardsByIcao.delete(card.icao24);
  removedCards.set(card.id, card);
  updateSaveButtonState(); // the removed aircraft may be the one currently selected in the sidebar
  renderCollectionPanelFromState();
}

async function undoRemoveCard(card) {
  removedCards.delete(card.id);
  try {
    const resp = await fetch('/api/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icao24: card.icao24, snapshot: card.snapshot,
        photo_url: card.photo_url, photo_link: card.photo_link,
        photo_photographer: card.photo_photographer,
      }),
    });
    if (resp.ok) {
      const restored = await resp.json();
      savedCardsByIcao.set(card.icao24, restored);
      updateSaveButtonState();
    }
  } catch (err) {
    // Best-effort — the ghost is already gone from removedCards; a failed
    // undo just means the aircraft stays unsaved.
  }
  renderCollectionPanelFromState();
}

collectionPanelCloseBtn.addEventListener('click', () => {
  collectionPanelEl.setAttribute('hidden', '');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !collectionPanelEl.hasAttribute('hidden')) {
    collectionPanelEl.setAttribute('hidden', '');
  }
});

checkAuth();
