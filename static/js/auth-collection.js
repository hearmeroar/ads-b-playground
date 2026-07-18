// --- Google sign-in + aircraft collection ---
// A new, mostly self-contained concern: no other file in this app has any
// user/session notion. Loaded after sidebar-track.js (needs its globals —
// selectedIcao24, buildMergedDetails, galleryCache — to snapshot the
// currently-selected aircraft) and before icons.js/render-details.js/
// parsers.js/main.js, none of which depend on anything defined here.

const authStatusEl = document.getElementById('auth-status');
const collectionToggleBtn = document.getElementById('collection-toggle');
const collectionPanelEl = document.getElementById('collection-panel');
const collectionPanelGridEl = document.getElementById('collection-panel-grid');
const collectionPanelCloseBtn = document.getElementById('collection-panel-close');
const sidebarSaveCollectionBtn = document.getElementById('sidebar-save-collection');

let currentUser = null; // { sub, email, name, picture } | null

function renderAuthStatus() {
  if (currentUser) {
    authStatusEl.textContent = `Hi, ${currentUser.name || currentUser.email} · Logout`;
    authStatusEl.classList.add('logged-in');
  } else {
    authStatusEl.textContent = 'Sign in with Google';
    authStatusEl.classList.remove('logged-in');
  }
  updateSaveButtonState();
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
}

authStatusEl.addEventListener('click', async () => {
  if (currentUser) {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    renderAuthStatus();
    collectionPanelEl.setAttribute('hidden', '');
  } else {
    // A full-page navigation, not fetch() — OAuth needs a real browser
    // redirect to Google's consent screen, not an XHR.
    window.location.href = '/api/login/google';
  }
});

// --- Save-to-collection (sidebar button) ---

function updateSaveButtonState() {
  if (!sidebarSaveCollectionBtn) return;
  sidebarSaveCollectionBtn.classList.remove('saved');
}

async function saveCurrentAircraftToCollection() {
  if (selectedIcao24 == null) return;
  if (!currentUser) {
    window.location.href = '/api/login/google';
    return;
  }
  const merged = buildMergedDetails(selectedIcao24);
  const photos = galleryCache.get(selectedIcao24) || [];
  const photo = photos[0];
  const body = {
    icao24: selectedIcao24,
    snapshot: merged.info,
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
      sidebarSaveCollectionBtn.classList.add('saved');
      if (!collectionPanelEl.hasAttribute('hidden')) loadCollection();
    }
  } catch (err) {
    // Best-effort — a failed save just leaves the button unmarked.
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
    img.alt = card.snapshot.registration || card.icao24 || '';
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

  const body = document.createElement('div');
  body.className = 'collection-card-body';

  const title = document.createElement('div');
  title.className = 'collection-card-title';
  title.textContent = card.snapshot.registration || card.icao24 || 'Unknown';
  body.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.className = 'collection-card-subtitle';
  const subtitleParts = [card.snapshot.aircraftType, card.snapshot.operator].filter(Boolean);
  subtitle.textContent = subtitleParts.join(' · ') || '—';
  body.appendChild(subtitle);

  el.appendChild(body);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'collection-card-delete';
  deleteBtn.setAttribute('aria-label', 'Remove from collection');
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => deleteCollectionCard(card.id));
  el.appendChild(deleteBtn);

  return el;
}

async function loadCollection() {
  collectionPanelGridEl.innerHTML = '';
  if (!currentUser) {
    const msg = document.createElement('div');
    msg.id = 'collection-panel-empty';
    msg.textContent = 'Sign in with Google to save and view your collection.';
    collectionPanelGridEl.appendChild(msg);
    return;
  }
  try {
    const resp = await fetch('/api/collection');
    if (!resp.ok) return;
    const data = await resp.json();
    const cards = data.cards || [];
    if (cards.length === 0) {
      const msg = document.createElement('div');
      msg.id = 'collection-panel-empty';
      msg.textContent = 'No saved aircraft yet — open one and click the save icon.';
      collectionPanelGridEl.appendChild(msg);
      return;
    }
    for (const card of cards) {
      collectionPanelGridEl.appendChild(renderCollectionCard(card));
    }
  } catch (err) {
    // Best-effort — leave the panel empty on a network error.
  }
}

async function deleteCollectionCard(id) {
  try {
    const resp = await fetch(`/api/collection/${id}`, { method: 'DELETE' });
    if (resp.ok) loadCollection();
  } catch (err) {
    // Best-effort.
  }
}

collectionToggleBtn.addEventListener('click', () => {
  const isHidden = collectionPanelEl.hasAttribute('hidden');
  if (isHidden) {
    collectionPanelEl.removeAttribute('hidden');
    loadCollection();
  } else {
    collectionPanelEl.setAttribute('hidden', '');
  }
});

collectionPanelCloseBtn.addEventListener('click', () => {
  collectionPanelEl.setAttribute('hidden', '');
});

checkAuth();
