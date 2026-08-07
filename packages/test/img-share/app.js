/**
 * Postgrify Image Share — app.js
 *
 * Akış:
 *   1. Bağlan → POST /auth/token (database: "test", scope: read+write+schema)
 *   2. Setup  → GET /db/test/tables → "images" yoksa POST /db/test/tables oluştur
 *   3. Upload → POST /db/test/images (JSON satır) → POST upload?id=...
 *   4. Galeri → GET /db/test/images → her kart için GET /db/test/images/:id/photo/raw
 */

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  apiUrl: '',
  token: '',
  selectedFile: null,   // File object
};

const DB = 'test';
const TABLE = 'images';
const LS_KEY = 'imgshare_session';

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const el = {
  apiUrl:          $('api-url'),
  apiSecret:       $('api-secret'),
  btnConnect:      $('btn-connect'),
  connectSpinner:  $('connect-spinner'),
  setupLog:        $('setup-log'),
  sectionConnect:  $('section-connect'),
  sectionApp:      $('section-app'),
  navbarDb:        $('navbar-db'),
  navbarStatus:    $('navbar-status'),
  btnDisconnect:   $('btn-disconnect'),
  // upload
  uploadTitle:     $('upload-title'),
  dropZone:        $('drop-zone'),
  fileInput:       $('file-input'),
  previewWrap:     $('preview-wrap'),
  previewImg:      $('preview-img'),
  btnRemovePreview:$('btn-remove-preview'),
  progressWrap:    $('progress-wrap'),
  progressBar:     $('progress-bar'),
  progressLabel:   $('progress-label'),
  btnUpload:       $('btn-upload'),
  uploadSpinner:   $('upload-spinner'),
  // gallery
  galleryGrid:     $('gallery-grid'),
  galleryCount:    $('gallery-count'),
  btnRefresh:      $('btn-refresh'),
  // lightbox
  lightbox:        $('lightbox'),
  lightboxImg:     $('lightbox-img'),
  lightboxClose:   $('lightbox-close'),
};

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const url = state.apiUrl + path;
  const headers = { ...(opts.headers || {}) };

  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }

  const res = await fetch(url, { ...opts, headers });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      msg = err.message || err.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), duration);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup log
// ─────────────────────────────────────────────────────────────────────────────
function logLine(text, cls = 'log-info') {
  const logEl = el.setupLog;
  logEl.classList.remove('hidden');
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session persistence
// ─────────────────────────────────────────────────────────────────────────────
function saveSession() {
  localStorage.setItem(LS_KEY, JSON.stringify({ apiUrl: state.apiUrl, token: state.token }));
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (s.apiUrl && s.token) return s;
  } catch (_) {}
  return null;
}

function clearSession() {
  localStorage.removeItem(LS_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect flow
// ─────────────────────────────────────────────────────────────────────────────
async function connect(apiUrl, secret) {
  state.apiUrl = apiUrl.replace(/\/$/, '');

  // 1. Token al
  logLine('→ Token alınıyor...');
  const data = await apiFetch('/auth/token', {
    method: 'POST',
    json: { database: DB, secret, scope: ['read', 'write', 'schema', 'delete'] },
  });
  state.token = data.token;
  logLine(`✓ Token alındı (scope: ${data.scope.join(', ')})`, 'log-ok');

  // 2. Tablo setup
  await ensureTable();

  // 3. UI geçiş
  saveSession();
  showApp();
  loadGallery();
}

async function ensureTable() {
  logLine('→ Tablolar kontrol ediliyor...');
  const data = await apiFetch(`/db/${DB}/tables`);
  const tables = Array.isArray(data) ? data : (data.tables || []);
  const exists = tables.some(t => (typeof t === 'string' ? t : t.name) === TABLE);

  if (exists) {
    logLine(`✓ "${TABLE}" tablosu mevcut`, 'log-ok');
    return;
  }

  logLine(`→ "${TABLE}" tablosu oluşturuluyor...`);
  await apiFetch(`/db/${DB}/tables`, {
    method: 'POST',
    json: {
      name: TABLE,
      columns: [
        { name: 'id',          type: 'serial',    primaryKey: true },
        { name: 'title',       type: 'text',      nullable: false },
        { name: 'photo',       type: 'bytea',     nullable: true },
        { name: 'photo_mime',  type: 'text',      nullable: true },
        { name: 'uploaded_at', type: 'text',      nullable: true },
      ],
    },
  });
  logLine(`✓ "${TABLE}" tablosu oluşturuldu`, 'log-ok');
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function showApp() {
  el.sectionConnect.classList.remove('active');
  el.sectionApp.classList.add('active');
  el.navbarDb.textContent = `· ${DB}`;
  el.navbarStatus.textContent = 'Bağlandı';
  el.navbarStatus.className = 'connected';
  el.btnDisconnect.classList.remove('hidden');
}

function showConnect() {
  el.sectionApp.classList.remove('active');
  el.sectionConnect.classList.add('active');
  el.navbarDb.textContent = '';
  el.navbarStatus.textContent = 'Bağlı değil';
  el.navbarStatus.className = 'disconnected';
  el.btnDisconnect.classList.add('hidden');
}

function setProgress(pct, label) {
  el.progressWrap.classList.add('visible');
  el.progressBar.style.width = pct + '%';
  el.progressLabel.textContent = label;
}

function hideProgress() {
  el.progressWrap.classList.remove('visible');
  el.progressBar.style.width = '0%';
}

// ─────────────────────────────────────────────────────────────────────────────
// File selection
// ─────────────────────────────────────────────────────────────────────────────
function setFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Lütfen geçerli bir resim dosyası seçin.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    toast('Dosya 10 MB\'dan büyük olamaz.', 'error');
    return;
  }
  state.selectedFile = file;

  // Preview
  const reader = new FileReader();
  reader.onload = e => {
    el.previewImg.src = e.target.result;
    el.previewWrap.classList.add('visible');
    el.dropZone.style.display = 'none';
  };
  reader.readAsDataURL(file);

  updateUploadBtn();
}

function clearFile() {
  state.selectedFile = null;
  el.previewImg.src = '';
  el.previewWrap.classList.remove('visible');
  el.dropZone.style.display = '';
  el.fileInput.value = '';
  updateUploadBtn();
}

function updateUploadBtn() {
  el.btnUpload.disabled = !state.selectedFile || !el.uploadTitle.value.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload flow
// ─────────────────────────────────────────────────────────────────────────────
async function doUpload() {
  const title = el.uploadTitle.value.trim();
  if (!title) { toast('Başlık girin.', 'error'); return; }
  if (!state.selectedFile) { toast('Dosya seçin.', 'error'); return; }

  el.btnUpload.disabled = true;
  el.uploadSpinner.classList.remove('hidden');

  try {
    // Adım 1: JSON satır ekle → id al
    setProgress(20, 'Kayıt oluşturuluyor...');
    const now = new Date().toISOString();
    const row = await apiFetch(`/db/${DB}/${TABLE}`, {
      method: 'POST',
      json: { title, uploaded_at: now },
    });

    // POST /db/:db/:table → { inserted: [{id, ...}] }
    const rowId = row?.inserted?.[0]?.id ?? row?.id ?? (Array.isArray(row) ? row[0]?.id : null);
    if (!rowId) throw new Error('Satır ID alınamadı');

    // Adım 2: Multipart upload
    setProgress(50, 'Resim yükleniyor...');
    const formData = new FormData();
    formData.append('file', state.selectedFile);

    const uploadRes = await fetch(
      `${state.apiUrl}/db/${DB}/${TABLE}/photo/upload?id=${rowId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      }
    );

    if (!uploadRes.ok) {
      // Upload başarısız olursa satırı sil
      await apiFetch(`/db/${DB}/${TABLE}/${rowId}`, { method: 'DELETE' }).catch(() => {});
      const err = await uploadRes.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Upload ${uploadRes.status}`);
    }

    setProgress(100, 'Tamamlandı!');
    toast(`"${title}" yüklendi`, 'success');

    // Reset
    setTimeout(() => {
      el.uploadTitle.value = '';
      clearFile();
      hideProgress();
      loadGallery();
    }, 600);

  } catch (err) {
    toast(err.message, 'error');
    hideProgress();
  } finally {
    el.btnUpload.disabled = false;
    el.uploadSpinner.classList.add('hidden');
    updateUploadBtn();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gallery
// ─────────────────────────────────────────────────────────────────────────────
async function loadGallery() {
  try {
    const rows = await apiFetch(
      `/db/${DB}/${TABLE}?select=id,title,uploaded_at&order=id.desc&limit=50`
    );
    const items = Array.isArray(rows) ? rows : (rows.rows || []);
    renderGallery(items);
  } catch (err) {
    toast('Galeri yüklenemedi: ' + err.message, 'error');
    el.galleryGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div>Galeri yüklenemedi</div></div>';
  }
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return isoStr; }
}

function renderGallery(items) {
  el.galleryCount.textContent = items.length ? `${items.length} resim` : '';

  if (!items.length) {
    el.galleryGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🖼️</div>
        <div>Henüz resim yok</div>
        <div style="font-size:.8rem;color:var(--text-faint)">Sol taraftan bir resim yükle</div>
      </div>`;
    return;
  }

  el.galleryGrid.innerHTML = '';
  items.forEach(item => {
    const card = buildCard(item);
    el.galleryGrid.appendChild(card);
  });
}

function buildCard(item) {
  const imgSrc = `${state.apiUrl}/db/${DB}/${TABLE}/${item.id}/photo/raw`;
  const tokenParam = encodeURIComponent(state.token);

  const card = document.createElement('div');
  card.className = 'img-card';
  card.dataset.id = item.id;

  card.innerHTML = `
    <div class="img-thumb-wrap">
      <img class="img-thumb"
           src="${imgSrc}"
           alt="${escHtml(item.title)}"
           loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
      />
      <div class="img-thumb-placeholder" style="display:none">📷</div>
    </div>
    <div class="img-card-body">
      <div class="img-card-title" title="${escHtml(item.title)}">${escHtml(item.title)}</div>
      <div class="img-card-meta">${formatDate(item.uploaded_at)}</div>
      <div class="img-card-actions">
        <button class="btn btn-ghost btn-sm" data-action="view" data-src="${imgSrc}" data-alt="${escHtml(item.title)}">
          🔍 Büyüt
        </button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${item.id}" data-title="${escHtml(item.title)}">
          🗑
        </button>
      </div>
    </div>
  `;

  // Thumbnail'e Authorization header eklemek için fetch + object URL
  const thumb = card.querySelector('.img-thumb');
  loadThumbWithAuth(thumb, imgSrc);

  // Kart butonları
  card.querySelector('[data-action="view"]').addEventListener('click', e => {
    e.stopPropagation();
    openLightbox(imgSrc, item.title);
  });
  card.querySelector('[data-action="delete"]').addEventListener('click', e => {
    e.stopPropagation();
    deleteImage(item.id, item.title);
  });

  return card;
}

function loadThumbWithAuth(imgEl, src) {
  fetch(src, { headers: { Authorization: `Bearer ${state.token}` } })
    .then(res => {
      if (!res.ok) throw new Error('no image');
      return res.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      imgEl.src = url;
      // Cleanup after load
      imgEl.onload = () => {};
    })
    .catch(() => {
      imgEl.style.display = 'none';
      const placeholder = imgEl.nextElementSibling;
      if (placeholder) placeholder.style.display = 'flex';
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────
async function deleteImage(id, title) {
  if (!confirm(`"${title}" silinsin mi?`)) return;
  try {
    await apiFetch(`/db/${DB}/${TABLE}/${id}`, { method: 'DELETE' });
    toast(`"${title}" silindi`, 'success');
    // Kartı animasyonla kaldır
    const card = el.galleryGrid.querySelector(`[data-id="${id}"]`);
    if (card) {
      card.style.transition = 'opacity .2s, transform .2s';
      card.style.opacity = '0';
      card.style.transform = 'scale(.95)';
      setTimeout(() => { card.remove(); recountGallery(); }, 220);
    }
  } catch (err) {
    toast('Silinemedi: ' + err.message, 'error');
  }
}

function recountGallery() {
  const count = el.galleryGrid.querySelectorAll('.img-card').length;
  el.galleryCount.textContent = count ? `${count} resim` : '';
  if (!count) {
    el.galleryGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🖼️</div>
        <div>Henüz resim yok</div>
        <div style="font-size:.8rem;color:var(--text-faint)">Sol taraftan bir resim yükle</div>
      </div>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────
function openLightbox(src, alt) {
  // Auth gerekli — object URL kullan
  fetch(src, { headers: { Authorization: `Bearer ${state.token}` } })
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      el.lightboxImg.src = url;
      el.lightboxImg.alt = alt;
      el.lightbox.classList.add('open');
    })
    .catch(() => toast('Resim açılamadı', 'error'));
}

function closeLightbox() {
  el.lightbox.classList.remove('open');
  // Revoke blob URL
  if (el.lightboxImg.src.startsWith('blob:')) {
    URL.revokeObjectURL(el.lightboxImg.src);
  }
  el.lightboxImg.src = '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Event bindings
// ─────────────────────────────────────────────────────────────────────────────

// Connect
el.btnConnect.addEventListener('click', async () => {
  const apiUrl = el.apiUrl.value.trim();
  const secret = el.apiSecret.value.trim();
  if (!apiUrl) { toast('API URL girin', 'error'); return; }
  if (!secret) { toast('Secret girin', 'error'); return; }

  el.btnConnect.disabled = true;
  el.connectSpinner.classList.remove('hidden');
  el.setupLog.innerHTML = '';
  el.setupLog.classList.remove('hidden');

  try {
    await connect(apiUrl, secret);
  } catch (err) {
    logLine('✕ Hata: ' + err.message, 'log-err');
    toast(err.message, 'error');
  } finally {
    el.btnConnect.disabled = false;
    el.connectSpinner.classList.add('hidden');
  }
});

// Enter key on secret
el.apiSecret.addEventListener('keydown', e => {
  if (e.key === 'Enter') el.btnConnect.click();
});

// Disconnect
el.btnDisconnect.addEventListener('click', () => {
  state.token = '';
  state.selectedFile = null;
  clearSession();
  clearFile();
  el.setupLog.innerHTML = '';
  el.setupLog.classList.add('hidden');
  showConnect();
});

// File select
el.fileInput.addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

el.uploadTitle.addEventListener('input', updateUploadBtn);

// Remove preview
el.btnRemovePreview.addEventListener('click', clearFile);

// Drag & drop
el.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  el.dropZone.classList.add('dragover');
});
el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('dragover'));
el.dropZone.addEventListener('drop', e => {
  e.preventDefault();
  el.dropZone.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) setFile(file);
});

// Upload
el.btnUpload.addEventListener('click', doUpload);

// Refresh gallery
el.btnRefresh.addEventListener('click', loadGallery);

// Lightbox close
el.lightboxClose.addEventListener('click', closeLightbox);
el.lightbox.addEventListener('click', e => {
  if (e.target === el.lightbox) closeLightbox();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLightbox();
});

// ─────────────────────────────────────────────────────────────────────────────
// Init — session restore
// ─────────────────────────────────────────────────────────────────────────────
(async function init() {
  const saved = loadSession();
  if (!saved) return;

  state.apiUrl = saved.apiUrl;
  state.token  = saved.token;
  el.apiUrl.value = saved.apiUrl;

  // Session geçerli mi? Hızlı tablo kontrolü yap
  try {
    await apiFetch(`/db/${DB}/tables`);
    // Geçerli — direkt app'e geç
    showApp();
    loadGallery();
  } catch (_) {
    // Token expired veya API kapalı
    clearSession();
    state.token = '';
  }
})();