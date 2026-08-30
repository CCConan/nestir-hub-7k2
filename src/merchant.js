/*
 * NESTIR 商戶介面（原型）— Cafe Chico 餐點資料管理。
 * 讀取/更新透過 menu-api（Cloudflare D1 + R2）；原型權限為 X-Admin-Key，
 * 正式版將以唯一 SN Account（Venue Owner / Editor / Visitor 三角色）取代。
 */
(() => {
  const API_DOMAINS = ['https://poplist.studionestir.com', 'https://menu-api.conanchan0217.workers.dev'];
  let API = API_DOMAINS[API_DOMAINS.length - 1];
  let apiResolved = false;
  // 自訂網域（poplist.studionestir.com）生效後自動優先使用；否則退回 workers.dev
  async function resolveApi() {
    if (apiResolved) return API;
    for (const domain of API_DOMAINS) {
      try {
        const response = await fetch(`${domain}/api/health`, { cache: 'no-store' });
        if (response.ok) { API = domain; break; }
      } catch (error) { /* try next domain */ }
    }
    apiResolved = true;
    return API;
  }
  const VENUE = 'cafe-chico';
  const KEY_STORE = 'nestir-merchant-key';

  const authGate = document.querySelector('#authGate');
  const dashboard = document.querySelector('#dashboard');
  const keyInput = document.querySelector('#adminKey');
  const unlockBtn = document.querySelector('#unlockBtn');
  const authError = document.querySelector('#authError');
  const dishTable = document.querySelector('#dishTable');
  const refreshBtn = document.querySelector('#refreshBtn');

  let records = [];
  let key = localStorage.getItem(KEY_STORE) || '';

  const api = async (path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (key) headers['x-admin-key'] = key;
    if (options.body && typeof options.body !== 'string') headers['content-type'] = 'application/json';
    const response = await fetch(`${await resolveApi()}${path}`, { ...options, headers });
    return response;
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function showSaved(message) {
    let toast = document.querySelector('.merchant-saved');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'merchant-saved';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showSaved._t);
    showSaved._t = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  async function verifyKey() {
    const response = await api('/api/admin/verify');
    return response.ok;
  }

  async function unlock() {
    key = keyInput.value.trim();
    authError.hidden = true;
    if (!key) return;
    const ok = await verifyKey();
    if (!ok) {
      authError.textContent = '金鑰無效，請檢查後再試。';
      authError.hidden = false;
      return;
    }
    localStorage.setItem(KEY_STORE, key);
    authGate.hidden = true;
    dashboard.hidden = false;
    await loadMenu();
  }

  async function loadMenu() {
    const response = await fetch(`${await resolveApi()}/api/venues/${VENUE}/menu`, { cache: 'no-store' });
    if (!response.ok) {
      dishTable.innerHTML = '<p class="merchant-error">無法讀取餐點資料。</p>';
      return;
    }
    const payload = await response.json();
    records = payload.records || [];
    document.querySelector('#venueMeta').textContent =
      `${payload.venue?.name || 'Cafe Chico'} · 資料來源 ${payload.venue?.menu_version || '—'} · 更新 ${payload.venue ? '見各列' : '—'}`;
    document.querySelector('#statTotal').textContent = records.length;
    document.querySelector('#statImage').textContent = records.filter((r) => r.image).length;
    document.querySelector('#statNoImage').textContent = records.filter((r) => !r.image).length;
    document.querySelector('#statAvailable').textContent = records.filter((r) => r.available).length;
    renderRows();
  }

  function renderRows() {
    dishTable.innerHTML = records.map((record) => {
      const hasImage = Boolean(record.image);
      return `
        <div class="merchant-row" data-slug="${esc(record.slug)}">
          <div class="merchant-row__name">${esc(record.name)}<small>${esc(record.cat_name || '')} · ${esc(record.slug)}</small></div>
          <div class="merchant-row__field"><label class="merchant-row__label">價格 £</label><input type="number" step="0.05" min="0" data-field="price" value="${esc(record.price ?? '')}"/></div>
          <div class="merchant-row__field"><label class="merchant-row__label">可見描述</label><input type="text" data-field="description" value="${esc(record.desc || '')}"/></div>
          <div class="merchant-row__status">
            <label class="merchant-row__check"><input type="checkbox" data-field="available" ${record.available ? 'checked' : ''}/> 供應中</label>
            <span class="merchant-row__image ${hasImage ? 'has' : ''}">${hasImage ? '有圖片' : '暫無圖片'}</span>
            <button type="button" class="merchant-btn merchant-row__upload">上載圖片</button>
            <input type="file" accept="image/*" class="merchant-row__file" hidden/>
          </div>
          <div class="merchant-row__actions">
            <button type="button" class="merchant-btn merchant-btn--save">儲存</button>
            <span class="merchant-row__feedback"></span>
          </div>
        </div>`;
    }).join('');

    dishTable.querySelectorAll('.merchant-row').forEach((row) => {
      const slug = row.dataset.slug;
      const saveBtn = row.querySelector('.merchant-btn--save');
      const uploadBtn = row.querySelector('.merchant-row__upload');
      const fileInput = row.querySelector('.merchant-row__file');
      const feedback = row.querySelector('.merchant-row__feedback');

      saveBtn.addEventListener('click', async () => {
        const record = records.find((r) => r.slug === slug);
        if (!record) return;
        const body = {
          name: record.name,
          cat_name: record.cat_name,
          price: row.querySelector('[data-field="price"]').value === '' ? null : Number(row.querySelector('[data-field="price"]').value),
          description: row.querySelector('[data-field="description"]').value,
          available: row.querySelector('[data-field="available"]').checked,
        };
        feedback.textContent = '儲存中…';
        try {
          const response = await api(`/api/admin/venues/${VENUE}/dishes/${slug}`, { method: 'PUT', body: JSON.stringify(body) });
          if (!response.ok) throw new Error(await response.text());
          Object.assign(record, body);
          feedback.textContent = '✓ 已儲存';
          showSaved(`${record.name} 已更新`);
        } catch (error) {
          console.error(error);
          feedback.textContent = '✗ 儲存失敗';
        }
      });

      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const imageKey = `${VENUE}/${slug}.jpg`;
        feedback.textContent = '上載中…';
        try {
          const imageResponse = await api(`/api/admin/images/${imageKey}`, {
            method: 'PUT',
            body: file,
            headers: { 'content-type': file.type || 'image/jpeg' },
          });
          if (!imageResponse.ok) throw new Error(await imageResponse.text());
          const dishResponse = await api(`/api/admin/venues/${VENUE}/dishes/${slug}`, {
            method: 'PUT',
            body: JSON.stringify({ image_key: imageKey }),
          });
          if (!dishResponse.ok) throw new Error(await dishResponse.text());
          const record = records.find((r) => r.slug === slug);
          if (record) record.image = `api/images/${imageKey}`;
          feedback.textContent = '✓ 圖片已更新';
          showSaved(`${record?.name || slug} 圖片已更新`);
          renderRows();
        } catch (error) {
          console.error(error);
          feedback.textContent = '✗ 上載失敗';
        }
      });
    });
  }

  unlockBtn.addEventListener('click', unlock);
  keyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') unlock();
  });
  refreshBtn.addEventListener('click', loadMenu);

  // 已儲存金鑰時直接嘗試解鎖
  if (key) {
    (async () => {
      const ok = await verifyKey();
      if (ok) {
        keyInput.value = key;
        authGate.hidden = true;
        dashboard.hidden = false;
        await loadMenu();
      } else {
        localStorage.removeItem(KEY_STORE);
      }
    })();
  }
})();
