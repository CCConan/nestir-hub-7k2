/*
 * NESTIR 店家後台（原型）— 雙模式：
 * 1. 店家模式（merchant.html?venue=slug&token=…）：QR 掃描進入，編輯自己店的餐點／圖片（X-Merchant-Token）。
 * 2. 營運模式（無參數）：輸入營運金鑰 → 開店（店家同意）→ 產生店家 token + QR。
 * 正式版將以唯一 SN Account 取代 token 機制。
 */
(() => {
  const API_DOMAINS = ['https://poplist.studionestir.com'];
  let API = API_DOMAINS[API_DOMAINS.length - 1];
  let apiResolved = false;

  async function resolveApi() {
    if (apiResolved) return API;
    for (const domain of API_DOMAINS) {
      try {
        const response = await fetch(`${domain}/api/health`, { cache: 'no-store' });
        if (response.ok) { API = domain; break; }
      } catch (error) { /* next */ }
    }
    apiResolved = true;
    return API;
  }

  const params = new URLSearchParams(location.search);
  const venueSlug = params.get('venue');
  const merchantToken = params.get('token');
  const isMerchant = Boolean(venueSlug && merchantToken);

  const operatorGate = document.querySelector('#operatorGate');
  const operatorDash = document.querySelector('#operatorDash');
  const merchantDash = document.querySelector('#merchantDash');
  const modeBadge = document.querySelector('#modeBadge');

  let key = localStorage.getItem('nestir-merchant-key') || '';
  let records = [];

  function esc(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function showToast(message) {
    let toast = document.querySelector('.merchant-saved');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'merchant-saved';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ---- 店家模式 ----
  async function merchantApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    headers['x-merchant-token'] = merchantToken;
    if (options.body && typeof options.body !== 'string') headers['content-type'] = 'application/json';
    const base = await resolveApi();
    return fetch(`${base}${path}`, { ...options, headers });
  }

  async function loadMerchant() {
    const me = await merchantApi('/api/merchant/me');
    if (!me.ok) {
      document.querySelector('#venueTitle').textContent = '登入失效';
      document.querySelector('#venueMeta').textContent = 'QR 連結無效或已過期。';
      return;
    }
    const meData = await me.json();
    const venue = meData.venue;
    modeBadge.textContent = `${venue.name} · 店家後台`;
    document.querySelector('#venueTitle').textContent = venue.name;
    document.querySelector('#venueMeta').textContent = `網址 slug：${venue.slug} · 資料來源 ${venue.menu_version || '—'}`;

    const res = await fetch(`${await resolveApi()}/api/venues/${venue.slug}/menu`, { cache: 'no-store' });
    if (!res.ok) return;
    const payload = await res.json();
    records = payload.records || [];
    document.querySelector('#statTotal').textContent = records.length;
    document.querySelector('#statImage').textContent = records.filter((r) => r.image).length;
    document.querySelector('#statNoImage').textContent = records.filter((r) => !r.image).length;
    document.querySelector('#statAvailable').textContent = records.filter((r) => r.available).length;
    renderRows(venue.slug, 'merchant');
  }

  function renderRows(slug, scope) {
    const table = document.querySelector('#dishTable');
    table.innerHTML = records.map((record) => {
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

    table.querySelectorAll('.merchant-row').forEach((row) => {
      const rowSlug = row.dataset.slug;
      const saveBtn = row.querySelector('.merchant-btn--save');
      const uploadBtn = row.querySelector('.merchant-row__upload');
      const fileInput = row.querySelector('.merchant-row__file');
      const feedback = row.querySelector('.merchant-row__feedback');

      saveBtn.addEventListener('click', async () => {
        const record = records.find((r) => r.slug === rowSlug);
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
          const response = await merchantApi(`/api/merchant/dishes/${rowSlug}`, { method: 'PUT', body: JSON.stringify(body) });
          if (!response.ok) throw new Error(await response.text());
          Object.assign(record, body);
          feedback.textContent = '✓ 已儲存';
          showToast(`${record.name} 已更新`);
        } catch (error) {
          console.error(error);
          feedback.textContent = '✗ 儲存失敗';
        }
      });

      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const imageKey = `${slug}/${rowSlug}.jpg`;
        feedback.textContent = '上載中…';
        try {
          const imageResponse = await merchantApi(`/api/merchant/images/${imageKey}`, {
            method: 'PUT', body: file, headers: { 'content-type': file.type || 'image/jpeg' },
          });
          if (!imageResponse.ok) throw new Error(await imageResponse.text());
          await merchantApi(`/api/merchant/dishes/${rowSlug}`, { method: 'PUT', body: JSON.stringify({ image_key: imageKey }) });
          const rec = records.find((r) => r.slug === rowSlug);
          await merchantApi(`/api/merchant/items/${rowSlug}`, { method: 'PUT', body: JSON.stringify({ name: rec.name, price: rec.price, description: rec.description, image_key: imageKey }) });
          if (rec) rec.image = `api/images/${imageKey}`;
          feedback.textContent = '✓ 圖片已更新';
          showToast(`${rec?.name || rowSlug} 圖片已更新（含物品庫）`);
          renderRows(slug, scope);
        } catch (error) {
          console.error(error);
          feedback.textContent = '✗ 上載失敗';
        }
      });
    });
  }

  // ---- 營運模式 ----
  async function opApi(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (key) headers['x-admin-key'] = key;
    if (options.body && typeof options.body !== 'string') headers['content-type'] = 'application/json';
    const base = await resolveApi();
    return fetch(`${base}${path}`, { ...options, headers });
  }

  async function unlock() {
    key = document.querySelector('#adminKey').value.trim();
    const err = document.querySelector('#authError');
    err.hidden = true;
    if (!key) return;
    const ok = await opApi('/api/admin/verify');
    if (!ok.ok) {
      err.textContent = '金鑰無效，請檢查後再試。';
      err.hidden = false;
      return;
    }
    localStorage.setItem('nestir-merchant-key', key);
    operatorGate.hidden = true;
    operatorDash.hidden = false;
    await loadVenueList();
  }

  async function loadVenueList() {
    const res = await fetch(`${await resolveApi()}/api/venues`);
    if (!res.ok) return;
    const { venues } = await res.json();
    document.querySelector('#venueList').innerHTML = (venues || []).map((v) =>
      `<div class="merchant-stat"><strong>${esc(v.name)}</strong><span>${esc(v.slug)} · 餐點 ${v.dishes_count} · 物品 ${v.items_count}</span></div>`
    ).join('');
  }

  async function onboard() {
    const venueName = document.querySelector('#venueName').value.trim();
    const venueSlug = document.querySelector('#venueSlug').value.trim();
    const consent = document.querySelector('#consent').checked;
    if (!venueName) { showToast('請輸入店名'); return; }
    if (!consent) { showToast('請確認店家已同意'); return; }
    const body = { venue_name: venueName };
    if (venueSlug) body.venue_slug = venueSlug;
    const res = await opApi('/api/admin/onboard', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { showToast(`開店失敗：${data.error || res.status}`); return; }

    document.querySelector('#onboardResult').hidden = false;
    document.querySelector('#merchantUrl').textContent = data.merchant_url;
    const qrBox = document.querySelector('#qr');
    qrBox.innerHTML = '';
    if (window.qrcode) {
      const qr = window.qrcode(0, 'M');
      qr.addData(data.merchant_url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2 });
    } else {
      qrBox.textContent = '（QR 函式庫未載入，請直接使用上方網址）';
    }
    document.querySelector('#copyUrl').onclick = () => {
      navigator.clipboard?.writeText(data.merchant_url);
      showToast('網址已複製');
    };
    showToast('店家帳號已建立');
    await loadVenueList();
  }

  // ---- 啟動 ----
  function start() {
    if (isMerchant) {
      merchantDash.hidden = false;
      loadMerchant();
    } else {
      operatorGate.hidden = false;
      document.querySelector('#unlockBtn').addEventListener('click', unlock);
      document.querySelector('#adminKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
      document.querySelector('#onboardBtn').addEventListener('click', onboard);
      if (key) {
        document.querySelector('#adminKey').value = key;
        unlock();
      }
    }
    const refreshBtn = document.querySelector('#refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => isMerchant ? loadMerchant() : loadVenueList());
  }

  start();
})();
