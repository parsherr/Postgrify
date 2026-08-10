/**
 * app.js — Tweeter Clone Frontend
 *
 * Vanilla JavaScript ile yazılmış minimal Twitter klonu.
 * Postgrify REST API ve @postgrify/auth-js SDK'yı test eder.
 *
 * Mimari: Tek yönlü veri akışı — state değiştiğinde ilgili DOM bölümü yeniden render edilir.
 * Framework yok — Postgrify API etkileşimlerini net görmek için kasıtlı olarak sade tutuldu.
 *
 * ÖNEMLI BULGULAR (database-issues.md ile senkron):
 * - DB user token'ları (auth-js ile alınan) rows/query endpoint'lerine ERİŞEBİLİYOR.
 *   (db/index.ts → authenticateAny, scopeGuard.ts → DB_USER_ROLE_SCOPES)
 *   Bu iyi bir tasarım — başta yanlış anladım, kod incelemesinde düzelttim.
 * - Asıl sorun: viewer rolü sadece "read" scope'u var.
 *   Tweet oluşturmak için "write" scope gerekiyor ama varsayılan kullanıcı "viewer".
 *   Rol yükseltme için admin endpoint'i gerekiyor (SORUN #7 REVİZE).
 */

// ─── Yapılandırma ────────────────────────────────────────────────────────────
const API_URL  = '/api';
const DATABASE = 'twitter';

// ─── Uygulama Durumu ─────────────────────────────────────────────────────────
const state = {
  view: 'auth',           // 'auth' | 'home' | 'profile' | 'settings'
  authTab: 'login',       // 'login' | 'signup'
  authSession: null,      // { accessToken, refreshToken, user }
  currentUser: null,      // { id, username, display_name, bio, avatar_url, auth_id }
  tweets: [],             // timeline tweet listesi
  profileUser: null,      // görüntülenen profil
  profileTweets: [],      // profil tweet'leri
  loading: false,
  error: null,
  tweetOffset: 0,
  hasMoreTweets: true,
  imagePreview: null,     // tweet'e eklenecek görsel URL (SORUN #2: sadece URL)
};

// ─── Yardımcı: Relatif Zaman ─────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

// ─── API Yardımcıları ─────────────────────────────────────────────────────────

/**
 * Temel fetch wrapper.
 * token parametresi: 'auth' (accessToken), 'db' (dbToken), veya explicit string.
 */
async function api(path, options = {}, useToken = 'auth') {
  let token = null;
  if (useToken === 'auth' && state.authSession) {
    token = state.authSession.accessToken;
  } else if (typeof useToken === 'string' && useToken !== 'auth' && useToken !== 'none') {
    token = useToken;
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message || body.error || msg;
    } catch {
      msg = await res.text().catch(() => msg);
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }

  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

const Auth = {
  /**
   * Signup — sadece email+password, username yoktu.
   * SORUN #6: full_name var ama username yok. Ayrı profil oluşturuyoruz.
   */
  signup: (email, password, fullName) =>
    api(`/db/${DATABASE}/auth/signup`, {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name: fullName }),
    }, 'none'),

  login: (email, password) =>
    api(`/db/${DATABASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, 'none'),

  logout: () =>
    api(`/db/${DATABASE}/auth/logout`, { method: 'POST' }),

  me: () =>
    api(`/db/${DATABASE}/auth/me`, { method: 'GET' }),
};

// ─── Data API (DB user token ile — accessToken kullanılıyor) ─────────────────
// GÜNCELLEME: DB user token'ı rows/query'e ERİŞEBİLİYOR (authenticateAny).
// Ama varsayılan rol "viewer" = sadece read scope.
// Tweet oluşturmak için admin endpoint'i ile rol "editor"'a yükseltmek gerekiyor.
// Bu setup aşamasında yapılıyor (SORUN #7 REVİZE).

const Data = {
  // Kullanıcı profili — auth_id ile ara
  getUserByAuthId: (authId) =>
    api(`/db/${DATABASE}/rows/users?where=auth_id.eq.${encodeURIComponent(authId)}&limit=1`),

  getUserByUsername: (username) =>
    api(`/db/${DATABASE}/rows/users?where=username.eq.${encodeURIComponent(username)}&limit=1`),

  createProfile: (data) =>
    api(`/db/${DATABASE}/rows/users`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProfile: (userId, data) =>
    api(`/db/${DATABASE}/rows/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteProfile: (userId) =>
    api(`/db/${DATABASE}/rows/users/${userId}`, { method: 'DELETE' }),

  // Tweet oluştur (write scope gerekli → kullanıcı "editor" rolünde olmalı)
  // SORUN #2: Görsel sadece URL olarak kaydedilebiliyor — binary upload yok.
  createTweet: (userId, content, imageUrl = '', replyTo = null) => {
    const body = { user_id: userId, content };
    if (imageUrl) body.image_url = imageUrl;
    if (replyTo) body.reply_to = replyTo;
    return api(`/db/${DATABASE}/rows/tweets`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  deleteTweet: (tweetId) =>
    api(`/db/${DATABASE}/rows/tweets/${tweetId}`, { method: 'DELETE' }),

  /**
   * Timeline — takip edilenlerin + kendi tweetleri.
   * SORUN #3, #4: Rows endpoint JOIN/subquery desteklemiyor → /query ile ham SQL.
   * query scope gerekiyor ama "editor" rolünde yok! "admin" rolüne gerek var.
   * Bu kritik bir tasarım çelişkisi — aşağıda detaylı not var.
   */
  getTimeline: (userId, offset = 0) => {
    // SORUN #11 (YENİ): query scope "editor" rolünde yok, sadece "admin"'de var.
    // Timeline için JOIN lazım → /query lazım → query scope lazım → admin rol lazım.
    // Yani normal bir kullanıcı kendi timeline'ını göremez!
    // Geçici çözüm: İki ayrı request — kendi tweetleri + follows tablosu → client-side merge.
    // Ya da: Her kullanıcıyı admin yapıyoruz (güvensiz).
    const sql = `
      SELECT
        t.id, t.content, t.image_url, t.reply_to, t.created_at,
        u.id AS user_id, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*)::int FROM likes l WHERE l.tweet_id = t.id) AS like_count,
        (SELECT COUNT(*)::int FROM likes l WHERE l.tweet_id = t.id AND l.user_id = '${userId}') AS liked_by_me
      FROM tweets t
      JOIN users u ON u.id = t.user_id
      WHERE t.user_id IN (SELECT following_id FROM follows WHERE follower_id = '${userId}')
         OR t.user_id = '${userId}'
      ORDER BY t.created_at DESC
      LIMIT 20 OFFSET ${offset}
    `;
    return api(`/db/${DATABASE}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },

  getUserTweets: (userId, offset = 0) => {
    const sql = `
      SELECT
        t.id, t.content, t.image_url, t.reply_to, t.created_at,
        u.id AS user_id, u.username, u.display_name, u.avatar_url,
        (SELECT COUNT(*)::int FROM likes l WHERE l.tweet_id = t.id) AS like_count,
        (SELECT COUNT(*)::int FROM likes l WHERE l.tweet_id = t.id AND l.user_id = '${userId}') AS liked_by_me
      FROM tweets t
      JOIN users u ON u.id = t.user_id
      WHERE t.user_id = '${userId}'
      ORDER BY t.created_at DESC
      LIMIT 20 OFFSET ${offset}
    `;
    return api(`/db/${DATABASE}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },

  // Beğeni — composite PK için /query kullanıyoruz (DELETE)
  likeTweet: (userId, tweetId) =>
    api(`/db/${DATABASE}/rows/likes`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, tweet_id: tweetId }),
    }),

  unlikeTweet: (userId, tweetId) =>
    api(`/db/${DATABASE}/query`, {
      method: 'POST',
      body: JSON.stringify({
        sql: `DELETE FROM likes WHERE user_id = '${userId}' AND tweet_id = '${tweetId}'`,
      }),
    }),

  // Takip
  followUser: (followerId, followingId) =>
    api(`/db/${DATABASE}/rows/follows`, {
      method: 'POST',
      body: JSON.stringify({ follower_id: followerId, following_id: followingId }),
    }),

  unfollowUser: (followerId, followingId) =>
    api(`/db/${DATABASE}/query`, {
      method: 'POST',
      body: JSON.stringify({
        sql: `DELETE FROM follows WHERE follower_id = '${followerId}' AND following_id = '${followingId}'`,
      }),
    }),

  getFollowStats: (userId) => {
    const sql = `
      SELECT
        (SELECT COUNT(*)::int FROM follows WHERE follower_id = '${userId}') AS following_count,
        (SELECT COUNT(*)::int FROM follows WHERE following_id = '${userId}') AS follower_count,
        (SELECT COUNT(*)::int FROM tweets WHERE user_id = '${userId}') AS tweet_count
    `;
    return api(`/db/${DATABASE}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },

  isFollowing: async (followerId, followingId) => {
    const res = await api(
      `/db/${DATABASE}/rows/follows?where=follower_id.eq.${followerId}&limit=100`
    );
    const rows = res?.rows || [];
    return rows.some(r => r.following_id === followingId);
  },
};

// ─── Render: Auth Ekranı ──────────────────────────────────────────────────────
function renderAuth() {
  const isLogin = state.authTab === 'login';
  return `
    <div class="auth-panel">
      <h1>🐦 Tweeter</h1>
      <p>Postgrify ile çalışan Twitter klonu test projesi</p>

      <div class="issue-note">
        ⚠️ Bu bir test projesidir. Postgrify sorunlarını belgelemek için yazılmıştır.
        <a href="https://github.com/postgrify" style="color:inherit">database-issues.md</a>'ye bakın.
      </div>

      <div class="tabs">
        <div class="tab ${isLogin ? 'active' : ''}" data-tab="login">Giriş Yap</div>
        <div class="tab ${!isLogin ? 'active' : ''}" data-tab="signup">Hesap Aç</div>
      </div>

      ${state.error ? `<div class="message message-error">${state.error}</div>` : ''}

      ${isLogin ? `
        <form id="login-form">
          <div class="form-group">
            <label>E-posta</label>
            <input type="email" id="login-email" placeholder="ornek@mail.com" required />
          </div>
          <div class="form-group">
            <label>Şifre</label>
            <input type="password" id="login-password" placeholder="••••••••" required />
          </div>
          <button type="submit" class="btn btn-primary btn-full" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? '<span class="spinner"></span>' : 'Giriş Yap'}
          </button>
        </form>
      ` : `
        <form id="signup-form">
          <div class="form-group">
            <label>Kullanıcı Adı</label>
            <input type="text" id="signup-username" placeholder="kullanici_adi" required
              pattern="[a-zA-Z0-9_]+" title="Sadece harf, rakam ve alt çizgi" />
          </div>
          <div class="form-group">
            <label>Görünen Ad</label>
            <input type="text" id="signup-displayname" placeholder="Ad Soyad" required />
          </div>
          <div class="form-group">
            <label>E-posta</label>
            <input type="email" id="signup-email" placeholder="ornek@mail.com" required />
          </div>
          <div class="form-group">
            <label>Şifre</label>
            <input type="password" id="signup-password" placeholder="En az 8 karakter" required minlength="8" />
          </div>
          <button type="submit" class="btn btn-primary btn-full" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? '<span class="spinner"></span>' : 'Hesap Oluştur'}
          </button>
          <div class="message message-info" style="margin-top:12px">
            <strong>Not:</strong> Hesap açarken iki API isteği gerekiyor (SORUN #6):
            önce auth signup, sonra profil oluşturma. İki adım başarılı olmazsa
            hesap tutarsız kalabilir.
          </div>
        </form>
      `}
    </div>
  `;
}

// ─── Render: Tweet Kartı ─────────────────────────────────────────────────────
function renderTweet(tweet) {
  const isOwn = state.currentUser && tweet.user_id === state.currentUser.id;
  const liked = tweet.liked_by_me > 0;

  return `
    <div class="tweet" data-tweet-id="${tweet.id}">
      <div class="avatar" data-username="${tweet.username}">
        ${tweet.avatar_url
          ? `<img src="${escHtml(tweet.avatar_url)}" alt="${escHtml(tweet.display_name)}" />`
          : escHtml((tweet.display_name || '?')[0].toUpperCase())
        }
      </div>
      <div class="tweet-body">
        <div class="tweet-header">
          <span class="tweet-display-name" data-username="${tweet.username}">${escHtml(tweet.display_name)}</span>
          <span class="tweet-username">@${escHtml(tweet.username)}</span>
          <span class="tweet-time">${timeAgo(tweet.created_at)}</span>
        </div>
        <div class="tweet-content">${escHtml(tweet.content)}</div>
        ${tweet.image_url ? `<img class="tweet-image" src="${escHtml(tweet.image_url)}" alt="Tweet görseli" />` : ''}
        <div class="tweet-actions">
          <button class="tweet-action like-btn ${liked ? 'liked' : ''}" data-tweet-id="${tweet.id}" data-liked="${liked ? '1' : '0'}">
            ${liked ? '❤️' : '🤍'} ${tweet.like_count}
          </button>
          ${isOwn ? `
            <button class="tweet-action delete-action" data-delete-tweet="${tweet.id}">
              🗑️ Sil
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Render: Tweet Yazma Kutusu ───────────────────────────────────────────────
function renderComposer() {
  const user = state.currentUser;
  const initial = user ? (user.display_name || '?')[0].toUpperCase() : '?';
  return `
    <div class="composer">
      <div class="avatar">
        ${user?.avatar_url
          ? `<img src="${escHtml(user.avatar_url)}" alt="${escHtml(user.display_name)}" />`
          : initial
        }
      </div>
      <div class="composer-body">
        <textarea id="tweet-content" placeholder="Neler oluyor?" maxlength="280"></textarea>
        ${state.imagePreview ? `
          <div class="image-preview">
            <img src="${escHtml(state.imagePreview)}" alt="Önizleme" />
            <button class="image-preview-remove" id="remove-image">✕</button>
          </div>
        ` : ''}
        <div class="composer-footer">
          <div class="composer-tools">
            <button class="composer-tool" id="add-image-btn" title="Görsel URL ekle (SORUN #2: Sadece URL)">🖼️</button>
          </div>
          <span class="char-count" id="char-count">280</span>
          <button class="btn btn-blue btn-sm" id="tweet-submit">Paylaş</button>
        </div>
      </div>
    </div>
    <div class="issue-note">
      📌 <strong>SORUN #11:</strong> Timeline ve tweet listesi için <code>/query</code>
      endpoint'i gerekiyor. Bu endpoint <strong>query scope</strong> istiyor.
      DB user token'larında query scope sadece <em>admin</em> rolünde var.
      Kullanıcı rolü <em>editor</em> ise timeline görünmüyor.
      <a href="#" id="show-role-note" style="color:inherit;text-decoration:underline">Daha fazla</a>
    </div>
  `;
}

// ─── Render: Ana Sayfa (Timeline) ────────────────────────────────────────────
function renderHome() {
  return `
    <div class="header">
      <span class="header-logo">🐦 Tweeter</span>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="profile-btn">Profil</button>
        <button class="btn btn-ghost btn-sm" id="logout-btn">Çıkış</button>
      </div>
    </div>
    ${renderComposer()}
    <div id="timeline">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>
  `;
}

// ─── Render: Profil ───────────────────────────────────────────────────────────
function renderProfile(user, stats) {
  const isOwn = state.currentUser && user.id === state.currentUser.id;
  return `
    <div class="header">
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" id="home-btn">← Ana Sayfa</button>
        ${isOwn ? `<button class="btn btn-danger btn-sm" id="delete-account-btn">Hesabı Sil</button>` : ''}
      </div>
    </div>
    <div class="profile-banner"></div>
    <div class="profile-info">
      <div class="profile-avatar-wrap">
        <div class="profile-avatar">
          ${user.avatar_url
            ? `<img src="${escHtml(user.avatar_url)}" alt="${escHtml(user.display_name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
            : escHtml((user.display_name || '?')[0].toUpperCase())
          }
        </div>
      </div>
      <div class="profile-name">${escHtml(user.display_name)}</div>
      <div class="profile-handle">@${escHtml(user.username)}</div>
      ${user.bio ? `<div class="profile-bio">${escHtml(user.bio)}</div>` : ''}
      <div class="profile-stats">
        <span><strong>${stats?.tweet_count ?? 0}</strong> Tweet</span>
        <span><strong>${stats?.following_count ?? 0}</strong> Takip</span>
        <span><strong>${stats?.follower_count ?? 0}</strong> Takipçi</span>
      </div>
      ${!isOwn ? `
        <div style="margin-top:12px">
          <button class="btn btn-ghost btn-sm" id="follow-btn" data-user-id="${user.id}">
            Takip Et
          </button>
        </div>
      ` : ''}
    </div>
    <div id="profile-tweets">
      <div class="loading-center"><div class="spinner"></div></div>
    </div>
  `;
}

// ─── HTML Güvenliği ───────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Render: Ana ─────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  switch (state.view) {
    case 'auth':
      app.innerHTML = renderAuth();
      attachAuthEvents();
      break;
    case 'home':
      app.innerHTML = renderHome();
      attachHomeEvents();
      loadTimeline();
      break;
    case 'profile':
      if (state.profileUser) {
        app.innerHTML = renderProfile(state.profileUser, state.profileStats);
        attachProfileEvents();
        loadProfileTweets();
      }
      break;
  }
}

// ─── Event Listeners: Auth ────────────────────────────────────────────────────
function attachAuthEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.authTab = tab.dataset.tab;
      state.error = null;
      render();
    });
  });

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.error = null;
      state.loading = true;
      render();

      try {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        const session = await Auth.login(email, password);

        // Auth session'ı kaydet
        state.authSession = session;

        // Kullanıcı profilini yükle — auth_id ile ara
        const userId = session.user?.id;
        if (userId) {
          const profileRes = await Data.getUserByAuthId(userId);
          const profiles = profileRes?.rows || profileRes || [];
          if (Array.isArray(profiles) && profiles.length > 0) {
            state.currentUser = profiles[0];
          } else {
            // Profil yoksa signup'ta oluşturulamamış olabilir (SORUN #6)
            throw new Error('Kullanıcı profili bulunamadı. Lütfen tekrar kayıt olun.');
          }
        }

        state.view = 'home';
        state.loading = false;
        render();
      } catch (err) {
        state.error = err.message;
        state.loading = false;
        render();
      }
    });
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.error = null;
      state.loading = true;
      render();

      try {
        const username = document.getElementById('signup-username').value.trim().toLowerCase();
        const displayName = document.getElementById('signup-displayname').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        // Adım 1: Auth signup (SORUN #6: full_name var ama username yok)
        const signupResult = await Auth.signup(email, password, displayName);

        if (signupResult?.email_verify_sent) {
          state.error = null;
          // E-posta doğrulama gerekiyor — devam edemeyiz (SORUN #12)
          // Auth sonrası profil oluşturmak için login gerekli ama verify olmadan login olmaz
          state.loading = false;
          state.authTab = 'login';
          // E-posta doğrulama durumunu state'e kaydet
          state.error = 'E-posta doğrulama linki gönderildi. E-postanızı doğruladıktan sonra giriş yapın.';
          render();
          return;
        }

        const authUserId = signupResult?.user?.id;
        if (!authUserId) throw new Error('Kayıt sonrası kullanıcı ID alınamadı');

        // Adım 2: Login yap — profil oluşturmak için token gerekli
        // SORUN #6: Signup direkt session döndürseydi bu extra step olmazdı
        const session = await Auth.login(email, password);
        state.authSession = session;

        // Adım 3: Profil oluştur (SORUN #6: iki adımlı kayıt)
        // SORUN #7 REVİZE: Viewer rolü sadece "read" — write scope yok.
        // Profil oluşturmak "write" scope gerektiriyor ama viewer bunu yapamaz.
        // Bu kritik — yeni kayıt olan kullanıcı kendi profilini bile oluşturamıyor!
        try {
          await Data.createProfile({
            auth_id: authUserId,
            username,
            display_name: displayName,
          });
        } catch (profileErr) {
          // SORUN #7 REVİZE: 403 Insufficient permissions — viewer rolü write yapamaz
          if (profileErr.status === 403) {
            throw new Error(
              `Profil oluşturulamadı: Kullanıcı rolü "viewer" olduğundan write scope'u yok. ` +
              `Postgrify'da yeni kayıt olan kullanıcılar varsayılan olarak "viewer" rolü alıyor ` +
              `ve bu rol write işlemi yapamıyor. Bu kritik bir tasarım sorunu (SORUN #7 REVİZE).`
            );
          }
          throw profileErr;
        }

        // Profil yükle
        const profileRes = await Data.getUserByAuthId(authUserId);
        const profiles = profileRes?.rows || profileRes || [];
        if (Array.isArray(profiles) && profiles.length > 0) {
          state.currentUser = profiles[0];
        }

        state.view = 'home';
        state.loading = false;
        render();
      } catch (err) {
        state.error = err.message;
        state.loading = false;
        render();
      }
    });
  }
}

// ─── Event Listeners: Ana Sayfa ───────────────────────────────────────────────
function attachHomeEvents() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await Auth.logout(); } catch { /* sessizce geç */ }
    state.authSession = null;
    state.currentUser = null;
    state.tweets = [];
    state.view = 'auth';
    render();
  });

  document.getElementById('profile-btn')?.addEventListener('click', () => {
    showProfile(state.currentUser);
  });

  const tweetContent = document.getElementById('tweet-content');
  const charCount = document.getElementById('char-count');
  tweetContent?.addEventListener('input', () => {
    const remaining = 280 - tweetContent.value.length;
    charCount.textContent = remaining;
    charCount.className = 'char-count' + (remaining < 20 ? ' danger' : remaining < 50 ? ' warning' : '');
  });

  document.getElementById('tweet-submit')?.addEventListener('click', submitTweet);
  document.getElementById('remove-image')?.addEventListener('click', () => {
    state.imagePreview = null;
    render();
    // render sonra event yeniden bağlanıyor — attachHomeEvents çağrılıyor
  });

  document.getElementById('add-image-btn')?.addEventListener('click', () => {
    // SORUN #2: Görsel yükleme yok — sadece URL alabiliriz
    const url = prompt(
      'Görsel URL\'si girin:\n\n' +
      '(Not: Postgrify dosya yükleme desteklemiyor — SORUN #2)\n' +
      'Sadece harici bir URL girebilirsiniz (örn: https://picsum.photos/600/300)'
    );
    if (url && url.trim()) {
      state.imagePreview = url.trim();
      render();
    }
  });

  // Timeline event delegation — tweet kartı tıklamaları
  document.getElementById('timeline')?.addEventListener('click', handleTimelineClick);
}

async function submitTweet() {
  const content = document.getElementById('tweet-content')?.value?.trim();
  if (!content) return;
  if (content.length > 280) {
    alert('Tweet 280 karakterden uzun olamaz');
    return;
  }

  const btn = document.getElementById('tweet-submit');
  if (btn) btn.disabled = true;

  try {
    await Data.createTweet(
      state.currentUser.id,
      content,
      state.imagePreview || ''
    );
    state.imagePreview = null;
    state.tweetOffset = 0;
    state.tweets = [];
    render();
    attachHomeEvents();
    await loadTimeline();
  } catch (err) {
    // SORUN #7 REVİZE: Viewer rolü write scope'u yok
    if (err.status === 403) {
      showError(`Tweet gönderilemedi: ${err.message}\n\nBu muhtemelen rol sorunundan kaynaklanıyor (SORUN #7 REVİZE).`);
    } else {
      showError(err.message);
    }
    if (btn) btn.disabled = false;
  }
}

async function handleTimelineClick(e) {
  const likeBtn = e.target.closest('.like-btn');
  const deleteBtn = e.target.closest('[data-delete-tweet]');
  const usernameEl = e.target.closest('[data-username]');

  if (likeBtn) {
    const tweetId = likeBtn.dataset.tweetId;
    const liked = likeBtn.dataset.liked === '1';
    try {
      if (liked) {
        await Data.unlikeTweet(state.currentUser.id, tweetId);
      } else {
        await Data.likeTweet(state.currentUser.id, tweetId);
      }
      // Tweet'i güncelle
      const tweet = state.tweets.find(t => t.id === tweetId);
      if (tweet) {
        tweet.liked_by_me = liked ? 0 : 1;
        tweet.like_count += liked ? -1 : 1;
        renderTimeline();
      }
    } catch (err) {
      showError(err.message);
    }
  }

  if (deleteBtn) {
    const tweetId = deleteBtn.dataset.deleteTweet;
    if (!confirm('Bu tweeti silmek istiyor musun?')) return;
    try {
      await Data.deleteTweet(tweetId);
      state.tweets = state.tweets.filter(t => t.id !== tweetId);
      renderTimeline();
    } catch (err) {
      showError(err.message);
    }
  }

  if (usernameEl && !likeBtn && !deleteBtn) {
    const username = usernameEl.dataset.username;
    if (username) {
      const res = await Data.getUserByUsername(username);
      const users = res?.rows || res || [];
      if (Array.isArray(users) && users.length > 0) {
        showProfile(users[0]);
      }
    }
  }
}

// ─── Timeline Yükleme ─────────────────────────────────────────────────────────
async function loadTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;

  if (!state.currentUser) {
    container.innerHTML = '<div class="empty"><h3>Kullanıcı bulunamadı</h3></div>';
    return;
  }

  try {
    const res = await Data.getTimeline(state.currentUser.id, state.tweetOffset);
    const newTweets = res?.rows || [];

    if (state.tweetOffset === 0) {
      state.tweets = newTweets;
    } else {
      state.tweets = [...state.tweets, ...newTweets];
    }
    state.hasMoreTweets = newTweets.length === 20;
    renderTimeline();
  } catch (err) {
    // SORUN #11: query scope yok ise 403 alınır
    let msg = err.message;
    if (err.status === 403) {
      msg = `Timeline yüklenemedi (403): ${err.message}\n\nBu büyük olasılıkla SORUN #11'dir: ` +
            `Timeline için /query endpoint'i gerekiyor, bu da "query" scope istiyor. ` +
            `"Editor" ve "viewer" rolleri query scope'una sahip değil — sadece "admin" rolü sahip.`;
    }
    container.innerHTML = `
      <div class="message message-error" style="margin:16px">
        ${escHtml(msg)}
      </div>
      <div class="issue-note" style="margin:0 16px 16px">
        <strong>SORUN #11 detayı:</strong> scopeGuard.ts'de editor rolü
        [read, write, delete] scope'larına sahip — "query" yok.
        Timeline JOIN içerdiğinden /query endpoint'i şart.
        Bu bir mimari çelişki: editor kullanıcılar kendi timeline'larını göremez.
      </div>
    `;
  }
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;

  if (state.tweets.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <h3>Henüz tweet yok</h3>
        <p>Birini takip et veya ilk tweeti at!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.tweets.map(renderTweet).join('') + (
    state.hasMoreTweets
      ? `<div style="text-align:center;padding:16px">
           <button class="btn btn-ghost" id="load-more">Daha fazla yükle</button>
         </div>`
      : ''
  );

  document.getElementById('load-more')?.addEventListener('click', () => {
    state.tweetOffset += 20;
    loadTimeline();
  });

  container.querySelectorAll('.like-btn, [data-delete-tweet], [data-username]').forEach(el => {
    // Event delegation zaten #timeline'da — ek listener gerekmiyor
  });
}

// ─── Profil Sayfası ───────────────────────────────────────────────────────────
async function showProfile(user) {
  state.profileUser = user;
  state.profileTweets = [];
  state.view = 'profile';

  // İstatistikleri al
  try {
    const statsRes = await Data.getFollowStats(user.id);
    state.profileStats = statsRes?.rows?.[0] || {};
  } catch {
    state.profileStats = {};
  }

  render();
}

function attachProfileEvents() {
  document.getElementById('home-btn')?.addEventListener('click', () => {
    state.view = 'home';
    render();
    attachHomeEvents();
    loadTimeline();
  });

  document.getElementById('follow-btn')?.addEventListener('click', async (e) => {
    const userId = e.target.dataset.userId;
    try {
      await Data.followUser(state.currentUser.id, userId);
      e.target.textContent = '✓ Takip Ediliyor';
      e.target.disabled = true;
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
    if (!confirm('Hesabınızı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) return;

    // SORUN #8: Cascade delete için birden fazla istek gerekiyor
    // Ayrıca auth user'ı silmek "schema" scope gerektiriyor — user token bunu yapamaz!
    try {
      // Adım 1: Public profil ve cascade ile tweetler silinecek
      await Data.deleteProfile(state.currentUser.id);
      // Adım 2: Auth user silme — SORUN #8: schema scope gerekiyor, user token'ında yok
      // Bu adım başarısız olacak
      alert(
        'Profil verileri silindi ancak auth hesabı silinemedi.\n\n' +
        'SORUN #8: Auth user silme işlemi "schema" scope gerektiriyor.\n' +
        'Normal kullanıcı token\'ı bu scope\'a sahip değil.\n' +
        'Hesabı tamamen silmek için admin müdahalesi gerekiyor.'
      );
      state.authSession = null;
      state.currentUser = null;
      state.view = 'auth';
      render();
    } catch (err) {
      showError(`Hesap silinemedi: ${err.message}`);
    }
  });

  // Tweet event delegation
  document.getElementById('profile-tweets')?.addEventListener('click', handleTimelineClick);
}

async function loadProfileTweets() {
  const container = document.getElementById('profile-tweets');
  if (!container || !state.profileUser) return;

  try {
    const res = await Data.getUserTweets(state.profileUser.id);
    state.profileTweets = res?.rows || [];

    if (state.profileTweets.length === 0) {
      container.innerHTML = '<div class="empty"><h3>Henüz tweet yok</h3></div>';
    } else {
      container.innerHTML = state.profileTweets.map(renderTweet).join('');
    }
  } catch (err) {
    container.innerHTML = `<div class="message message-error" style="margin:16px">${escHtml(err.message)}</div>`;
  }
}

// ─── Hata Gösterimi ───────────────────────────────────────────────────────────
function showError(msg) {
  // Mevcut view'ın üstüne geçici hata mesajı ekle
  const existing = document.getElementById('global-error');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'global-error';
  el.className = 'message message-error';
  el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:500px;z-index:999;';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ─── Başlat ───────────────────────────────────────────────────────────────────
render();