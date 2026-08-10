/**
 * api.js — Postgrify REST API Wrapper
 *
 * Bu modül Postgrify API ile iletişimi sarmalar. İki token tipi kullanılır:
 *
 * 1. dbToken  — read/write scope, data CRUD için (SORUN #7: güvensiz hardcode)
 * 2. authToken — per-DB auth user token, sadece /auth/* endpoint'leri için
 *
 * SORUN NOTU (#7): Per-DB auth token'ı (authToken) rows/query endpoint'lerine
 * erişemiyor. Bu yüzden dbToken ayrıca tutulmak zorunda.
 *
 * Bu dosya hem Node.js (serve.js) hem tarayıcıda (ESM) çalışır.
 */

/**
 * Postgrify API client factory.
 * @param {string} apiUrl - Postgrify base URL
 * @param {string} database - Veritabanı adı
 * @param {string} dbToken - Scope token (read/write/delete)
 */
export function createPostgrifyClient(apiUrl, database, dbToken) {
  const base = `${apiUrl}/db/${database}`;
  const authBase = `${apiUrl}/db/${database}/auth`;

  /**
   * Temel fetch helper — hata yönetimini merkezileştirir.
   */
  async function request(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.message || body.error || message;
      } catch {
        // JSON parse edilemezse ham text al
        message = await res.text().catch(() => message);
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }

    // 204 No Content gibi body olmayan response'lar için
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return null;
  }

  /**
   * DB scope token ile korunan istekler için helper.
   * SORUN #7: Bu token normalde frontend'de olmamalı.
   */
  function dbRequest(url, options = {}) {
    return request(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${dbToken}`,
        ...options.headers,
      },
    });
  }

  /**
   * Per-DB auth user token ile korunan istekler için helper.
   * Bu token sadece /auth/* endpoint'lerinde çalışır.
   */
  function authRequest(url, userToken, options = {}) {
    return request(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${userToken}`,
        ...options.headers,
      },
    });
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Yeni kullanıcı kaydı.
   * SORUN #6: Signup'a custom fields eklenemiyor.
   * username ve displayName için ayrı profil insert gerekiyor.
   */
  async function signup(email, password, username, displayName) {
    // Adım 1: Auth sisteme kayıt ol
    const authResult = await request(`${authBase}/signup`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // Adım 2: Kullanıcı profili oluştur (SORUN #6 geçici çözümü)
    // authResult.user.id burada _postgrify_auth.users.id — bunu auth_id olarak sakla
    // NOT: authResult'un yapısı signup.ts'e göre { user, session } veya sadece { message }
    // Email verification gerekiyorsa session olmayabilir.
    let authId = authResult?.user?.id || null;

    if (authId) {
      try {
        await dbRequest(`${base}/rows/users`, {
          method: 'POST',
          body: JSON.stringify({
            auth_id: authId,
            username,
            display_name: displayName,
          }),
        });
      } catch (profileErr) {
        // SORUN #6: Kısmi başarısızlık riski — auth user oluştu ama profil oluşmadı.
        // Rollback mekanizması yok.
        console.error('Profil oluşturma hatası (auth user oluştu ama profil yok):', profileErr.message);
        throw new Error(`Hesap oluşturuldu ama profil kaydedilemedi: ${profileErr.message}`);
      }
    }

    return authResult;
  }

  /**
   * Kullanıcı girişi.
   */
  function login(email, password) {
    return request(`${authBase}/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Oturumu kapat.
   */
  function logout(userToken) {
    return request(`${authBase}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }

  /**
   * Mevcut kullanıcı bilgilerini al.
   * SORUN #5: Her çağrıda network request yapılıyor — cache yok.
   */
  function getMe(userToken) {
    return authRequest(`${authBase}/me`, userToken, { method: 'GET' });
  }

  // ─── Kullanıcı Profili ─────────────────────────────────────────────────────

  /**
   * auth_id'ye göre kullanıcı profilini bulur.
   * SORUN #7: dbToken kullanmak zorundayız — authToken /rows'a erişemiyor.
   */
  function getUserByAuthId(authId) {
    return dbRequest(`${base}/rows/users?where=auth_id.eq.${encodeURIComponent(authId)}&limit=1`);
  }

  function getUserByUsername(username) {
    return dbRequest(`${base}/rows/users?where=username.eq.${encodeURIComponent(username)}&limit=1`);
  }

  function updateProfile(userId, updates) {
    return dbRequest(`${base}/rows/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ─── Tweetler ──────────────────────────────────────────────────────────────

  /**
   * Tweet oluştur.
   * SORUN #2: Görsel için sadece URL kabul ediliyor — binary upload yok.
   * SORUN #9: Tek tek insert — bulk insert yok.
   */
  function createTweet(userId, content, imageUrl = '', replyTo = null) {
    const body = { user_id: userId, content, image_url: imageUrl };
    if (replyTo) body.reply_to = replyTo;

    return dbRequest(`${base}/rows/tweets`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  function deleteTweet(tweetId) {
    return dbRequest(`${base}/rows/tweets/${tweetId}`, { method: 'DELETE' });
  }

  /**
   * Timeline — takip edilen kişilerin tweetleri + kullanıcı bilgisi.
   *
   * SORUN #3, #4: Rows endpoint'i JOIN ve subquery desteklemiyor.
   * Bu yüzden /query endpoint'ine ham SQL göndermek zorunda kaldık.
   * Query endpoint'i de dbToken gerektiriyor.
   *
   * SORUN #10: Cursor pagination yok — offset/limit kullanıyoruz.
   */
  function getTimeline(userId, limit = 20, offset = 0) {
    const sql = `
      SELECT
        t.id,
        t.content,
        t.image_url,
        t.reply_to,
        t.created_at,
        u.id        AS user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        (SELECT COUNT(*) FROM likes l WHERE l.tweet_id = t.id) AS like_count,
        (SELECT COUNT(*) FROM likes l WHERE l.tweet_id = t.id AND l.user_id = '${userId}') AS liked_by_me
      FROM tweets t
      JOIN users u ON u.id = t.user_id
      WHERE t.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = '${userId}'
      )
      OR t.user_id = '${userId}'
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // SORUN #7: dbToken kullanmak zorundayız
    return dbRequest(`${base}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  }

  /**
   * Kullanıcının tweetlerini getir.
   * SORUN #4: user bilgisiyle birlikte getirmek için JOIN gerekiyor → /query
   */
  function getUserTweets(userId, limit = 20, offset = 0) {
    const sql = `
      SELECT
        t.id,
        t.content,
        t.image_url,
        t.reply_to,
        t.created_at,
        u.id        AS user_id,
        u.username,
        u.display_name,
        u.avatar_url,
        (SELECT COUNT(*) FROM likes l WHERE l.tweet_id = t.id) AS like_count,
        (SELECT COUNT(*) FROM likes l WHERE l.tweet_id = t.id AND l.user_id = '${userId}') AS liked_by_me
      FROM tweets t
      JOIN users u ON u.id = t.user_id
      WHERE t.user_id = '${userId}'
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return dbRequest(`${base}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  }

  // ─── Beğeniler ─────────────────────────────────────────────────────────────

  function likeTweet(userId, tweetId) {
    return dbRequest(`${base}/rows/likes`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, tweet_id: tweetId }),
    });
  }

  function unlikeTweet(userId, tweetId) {
    // SORUN: Composite key ile DELETE yapmak için özel bir yol gerekiyor
    // Rows endpoint'i primary key üzerinden siler ama bu tablonun PK'si
    // composite (user_id, tweet_id). Postgrify'ın composite PK DELETE desteği
    // belirsiz — bu yüzden ham SQL kullanıyoruz.
    const sql = `DELETE FROM likes WHERE user_id = '${userId}' AND tweet_id = '${tweetId}'`;
    return dbRequest(`${base}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  }

  // ─── Takip ─────────────────────────────────────────────────────────────────

  function followUser(followerId, followingId) {
    return dbRequest(`${base}/rows/follows`, {
      method: 'POST',
      body: JSON.stringify({ follower_id: followerId, following_id: followingId }),
    });
  }

  function unfollowUser(followerId, followingId) {
    const sql = `DELETE FROM follows WHERE follower_id = '${followerId}' AND following_id = '${followingId}'`;
    return dbRequest(`${base}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  }

  // ─── Hesap Silme ────────────────────────────────────────────────────────────

  /**
   * Hesabı tamamen sil.
   * SORUN #8: Cascade delete yok auth user → public.users arasında.
   * Önce related data, sonra public profile, sonra auth user silinmeli.
   *
   * @param {string} userId - public.users.id
   * @param {string} authUserId - _postgrify_auth.users.id
   * @param {string} schemaToken - schema scope token (admin gerektirir)
   */
  async function deleteAccount(userId, authUserId, schemaToken) {
    // Adım 1: Tweetleri sil (CASCADE zaten siliyor ama explicit olalım)
    // Adım 2: Profili sil
    await dbRequest(`${base}/rows/users/${userId}`, { method: 'DELETE' });

    // Adım 3: Auth user sil — bu endpoint schema scope gerektiriyor
    // SORUN #8: Bunu yapmak için schema token almak zorundayız
    // Normal bir kullanıcı bunu kendi kendine yapamaz — admin gerekiyor!
    await request(`${authBase}/users/${authUserId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${schemaToken}` },
    });
  }

  return {
    // Auth
    signup,
    login,
    logout,
    getMe,
    // Profil
    getUserByAuthId,
    getUserByUsername,
    updateProfile,
    // Tweetler
    createTweet,
    deleteTweet,
    getTimeline,
    getUserTweets,
    // Beğeniler
    likeTweet,
    unlikeTweet,
    // Takip
    followUser,
    unfollowUser,
    // Hesap
    deleteAccount,
  };
}