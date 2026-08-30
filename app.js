(() => {
  const root = document.querySelector('#root');
  const cafeSourceRoot = '/cafe-chico-source';
  const cafeApiDomains = ['https://poplist.studionestir.com', 'https://menu-api.conanchan0217.workers.dev'];
  let cafeApiRoot = cafeApiDomains[cafeApiDomains.length - 1];
  let apiRootChecked = false;
  // 自訂網域（poplist.studionestir.com）生效後自動優先使用；否則退回 workers.dev
  async function ensureApiRoot() {
    if (apiRootChecked) return cafeApiRoot;
    for (const domain of cafeApiDomains) {
      try {
        const response = await fetch(`${domain}/api/health`, { cache: 'no-store' });
        if (response.ok) { cafeApiRoot = domain; break; }
      } catch (error) { /* try next domain */ }
    }
    apiRootChecked = true;
    return cafeApiRoot;
  }
  const cafeSourceFallback = 'https://ccconan.github.io/cafe-chico-website';
  let activeSourceRoot = cafeSourceRoot;
  const ocrLibraryUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const ocrLanguageUrl = 'https://tessdata.projectnaptha.com/4.0.0_fast';
  const pilotSlugs = [
    'full-english-breakfast', 'desi-breakfast', 'french-toast', 'crepe',
    'signature-sub', 'sub-meal-deal', 'kids-breakfast-meal', 'homemade-brownies',
    'hot-chocolate', 'fresh-orange-juice',
  ];
  let sourceStatus = 'loading';
  let pilotRecords = [];
  let dish = null;
  let detected = false;
  let detail = false;
  let cameraMode = 'idle';
  let cameraStream = null;
  let cameraSession = 0;
  let ocrStatus = 'idle';
  let ocrWorker = null;
  let ocrInFlight = false;
  let ocrCanvas = null;
  let ocrNote = '';
  let ocrError = '';
  let toolMode = 'menu'; // 'menu' | 'item'
  let scanState = 'idle'; // 'idle' | 'reading' | 'nomatch'
  let lastReadText = '';
  let itemSignatures = null;
  let itemCandidates = [];
  let itemRecords = [];
  let videoEl = null;

  const icon = (name) => {
    const paths = {
      camera: '<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7 9.5 4h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      edit: '<path d="m4 20 4.2-1 10.2-10.2a2.8 2.8 0 0 0-4-4L4.2 14.9 4 20Z M12.7 6.5l4 4"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.4"/><path d="m4 18 5-5 3.5 3.4 2.8-2.6L20 18"/>',
      back: '<path d="m15 18-6-6 6-6"/>',
      list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".7" fill="currentColor"/><circle cx="4" cy="12" r=".7" fill="currentColor"/><circle cx="4" cy="18" r=".7" fill="currentColor"/>',
      scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>',
      warning: '<path d="M12 3 2.9 19a1.4 1.4 0 0 0 1.2 2h15.8a1.4 1.4 0 0 0 1.2-2L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    };
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  };
  const mark = (small = false) => `<span class="compass ${small ? 'compass--small' : ''}" aria-hidden="true"><i></i></span>`;
  const escape = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const button = (label, action, extra = '') => `<button type="button" class="button ${extra}" data-action="${action}">${label}</button>`;
  const formatPrice = (value) => Number.isFinite(Number(value)) ? `£${Number(value).toFixed(2)}` : '未提供';
  const sourceImageUrl = (imagePath) => `${activeSourceRoot}/${String(imagePath || '').replace(/^\/+/, '')}`;
  const normalized = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  function image(item, className) {
    if (item?.imageUrl) return `<img class="${className}" src="${escape(item.imageUrl)}" alt="${escape(item.name)}" data-image-fallback="true"/>`;
    return fallbackImage(className);
  }

  function fallbackImage(className) {
    return `<div class="${className} image-fallback">${icon('image')}<span>暫無圖片</span></div>`;
  }

  function path() { return location.pathname; }
  function isScanRoute(next = path()) { return next === '/places/cafe-chico/scan'; }
  function go(next) {
    if (!isScanRoute(next)) stopCamera();
    history.pushState({}, '', next);
    render();
  }
  function header(action = '') { return `<header class="topbar"><button class="brand" data-go="/" aria-label="Go to NESTIR home">${mark(true)}<span>NESTIR</span></button>${action}</header>`; }

  function directRecord(item) {
    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      category: item.cat_name,
      description: item.desc || '未提供',
      price: formatPrice(item.price),
      imageUrl: item.image ? sourceImageUrl(item.image) : '',
      available: item.available === true,
    };
  }

  function selectPilotRecords(items) {
    const bySlug = new Map(items.filter((item) => item.available && item.image).map((item) => [item.slug, item]));
    const selected = pilotSlugs.map((slug) => bySlug.get(slug)).filter(Boolean);
    for (const item of items) {
      if (selected.length === 10) break;
      if (item.available && item.image && !selected.some((chosen) => chosen.id === item.id)) selected.push(item);
    }
    return selected.slice(0, 10).map(directRecord);
  }

  function sourceMessage() {
    if (sourceStatus === 'loading') return 'Loading Cafe Chico menu data…';
    if (sourceStatus === 'error') return 'Cafe Chico menu data is unavailable in this local test.';
    return `${pilotRecords.length} live OCR menu records are ready.`;
  }

  function landing() {
    return `<main class="page page--landing">${header()}<section class="landing-content"><div class="landing-copy"><h1>Explore the menu.</h1><p>Take a photo of a menu name to see the dish, its menu price and the source description. In item mode, PopList matches the item\u2019s appearance against the database.</p></div><article class="venue-card"><div class="venue-card__scene" aria-hidden="true"><span>CAFE<br/>CHICO</span></div><div class="venue-card__body"><div><h2>Cafe Chico</h2><p>${sourceMessage()}</p></div>${button(`${icon('camera')}Scan a menu`, 'scan', sourceStatus !== 'ready' ? 'button--loading' : '')}</div></article><p class="privacy-note">Captures stay on this device. The text reader and visual match run locally in the browser.</p></section><footer>Powered by <strong>NESTIR</strong></footer></main>`;
  }

  function cameraBackdrop() {
    if (cameraStream) return '';
    return '<div class="paper-menu" aria-hidden="true"><span>CAFE CHICO</span><i></i><i></i><i></i><i></i><i></i></div>';
  }

  function cameraMessage(iconName, heading, message, actions = '') {
    return `<div class="camera-message">${icon(iconName)}<h1>${heading}</h1><p>${message}</p>${actions}</div>`;
  }

  function captureReady() {
    const prompt = toolMode === 'menu'
      ? (ocrNote || '對準餐牌上的菜名，然後按「拍攝」')
      : (ocrNote || '把物品放在取景框中央，然後按「拍攝」— 比對場景物品庫');
    const privacy = toolMode === 'menu'
      ? '文字辨識在裝置內進行，不會上載相機影格。'
      : '視覺比對在裝置內進行，不會上載相機影格。';
    return `<div class="viewfinder" aria-hidden="true"></div><div class="camera-action-tray"><p>${escape(prompt)}</p><div class="camera-shutter-row"><button type="button" class="button button--shutter" data-action="capture" aria-label="拍攝">${icon('camera')}</button></div><span class="camera-wait">${privacy}</span></div>`;
  }

  function menuNoMatch() {
    const preview = lastReadText || '（沒有讀到清晰文字）';
    return `<div class="camera-action-tray"><p><strong>已讀到文字：</strong>“${escape(preview)}”</p><p class="camera-wait">這幀沒有對應到 Cafe Chico 的 ${pilotRecords.length} 道試點餐點（或信心不足）。</p><div class="camera-shutter-row">${button('重拍', 'capture', 'button--secondary')}<button class="text-button" data-go="/places/cafe-chico/manage">查看完整餐牌</button></div></div>`;
  }

  function itemNoMatch() {
    return `<div class="camera-action-tray"><p><strong>沒有外型相近的物品</strong></p><p class="camera-wait">這個場景的物品庫沒有對應的資料。把物品放在框中央、光線充足再試；或確認該場景已上載物品資料。</p><div class="camera-shutter-row">${button('重拍', 'capture', 'button--secondary')}</div></div>`;
  }

  function itemCandidatesView() {
    const list = itemCandidates.map(({ record, distance }) => `<button class="item-candidate" data-action="pick-item" data-slug="${escape(record.slug)}"><img src="${escape(record.imageUrl)}" alt="" data-image-fallback="true"/><span class="item-candidate__body"><strong>${escape(record.name)}</strong><span>${escape(record.price)} · ${escape(record.category)}</span></span><span class="item-candidate__match">${Math.max(0, Math.round((1 - distance) * 100))}%</span></button>`).join('');
    return `<div class="item-candidates"><p class="item-candidates__title">外型相近的物品（視覺比對）</p><div class="item-candidates__list">${list}</div><button class="text-button" data-action="capture">重拍</button></div>`;
  }

  function scanResult() {
    const evidence = dish.name;
    return `<div class="ocr-box"><span>${escape(evidence)}</span></div><article class="scan-result">${image(dish, 'scan-image')}<span class="field-label scan-result__test-note">Captured menu text match</span><h1>${escape(dish.name)}</h1><p class="scan-result__evidence">Matched menu text: “${escape(evidence)}”</p><span class="field-label">Menu price</span><strong>${escape(dish.price)}</strong><span class="field-label">Menu description</span><p>${escape(dish.description)}</p>${button('View dish', 'detail')}${button('拍攝下一道', 'capture', 'button--secondary')}</article>`;
  }

  function scannerContent() {
    if (sourceStatus !== 'ready') {
      return cameraMessage(sourceStatus === 'error' ? 'warning' : 'camera', sourceStatus === 'error' ? 'Menu data unavailable' : 'Loading menu data', sourceStatus === 'error' ? 'The Cafe Chico menu source could not be read. Return home and retry.' : 'Reading the Cafe Chico menu for this capture test.', sourceStatus === 'error' ? button('Return home', 'home') : '');
    }
    if (detected) return scanResult();
    if (scanState === 'reading') return cameraMessage('camera', toolMode === 'menu' ? 'Reading menu text…' : 'Comparing appearance…', 'Processing this capture on your device.');
    if (toolMode === 'item' && scanState === 'nomatch') return itemNoMatch();
    if (toolMode === 'item' && itemCandidates.length) return itemCandidatesView();
    if (scanState === 'nomatch') return menuNoMatch();
    if (cameraMode === 'requesting') return cameraMessage('camera', 'Waiting for camera access', 'Approve the browser prompt to use the rear camera. The preview stays on this device.');
    if (cameraMode === 'ready' && toolMode === 'menu' && ocrStatus === 'loading') return cameraMessage('camera', 'Preparing text reader', 'The first use downloads an English reading model to this browser. Menu images are not uploaded.');
    if (cameraMode === 'ready' && toolMode === 'menu' && ocrStatus === 'error') return cameraMessage('warning', 'Text reader could not start', escape(ocrError || 'Try again with a network connection for the first local model download.'), button('Retry text reader', 'ocr'));
    if (cameraMode === 'denied') return cameraMessage('warning', 'Camera permission was not granted', 'Enable camera access for this secure site in the browser, then try again.', button('Try camera again', 'camera'));
    if (cameraMode === 'insecure') return cameraMessage('warning', 'A secure link is required', 'Phone cameras only work on HTTPS. This local address is for layout testing only.');
    if (cameraMode === 'unsupported' || cameraMode === 'error') return cameraMessage('warning', 'Camera is unavailable here', 'This browser cannot start a camera preview for this test.');
    if (cameraMode === 'ready') return captureReady();
    return cameraMessage('camera', 'Ready to use the rear camera', 'Start the camera once, then press 拍攝 to read a menu name or match an item against the database.', button(`${icon('camera')}Use rear camera`, 'camera'));
  }

  function scannerStatus() {
    if (detected) return 'Captured menu text matched';
    if (scanState === 'reading') return toolMode === 'menu' ? 'Reading menu text' : 'Matching item appearance';
    if (scanState === 'nomatch') return toolMode === 'menu' ? 'Menu text read — no pilot match' : 'No close item match';
    if (toolMode === 'item') return 'Item visual match';
    if (ocrStatus === 'loading') return 'Preparing on-device text reader';
    if (ocrStatus === 'error') return 'Text reader unavailable';
    if (cameraMode === 'ready') return 'Manual capture mode';
    return 'Camera test';
  }

  function scanner() {
    if (detail && dish) return dish.item ? itemDetail() : dishDetail();
    const modeSwitch = cameraMode === 'ready' && !detected && scanState !== 'reading'
      ? `<div class="mode-switch" role="group" aria-label="Tool mode"><button type="button" data-mode="menu" class="${toolMode === 'menu' ? 'is-active' : ''}">餐牌</button><button type="button" data-mode="item" class="${toolMode === 'item' ? 'is-active' : ''}">物品</button></div>` : '';
    return `<main class="camera-page"><div class="camera-page__chrome"><button class="icon-button" data-go="/" aria-label="Close scan">${icon('close')}</button><span>Cafe Chico</span>${mark(true)}</div><section class="camera-viewport ${cameraStream ? 'camera-viewport--live' : ''}" aria-label="Menu camera viewport">${cameraBackdrop()}${modeSwitch}<div class="camera-vignette" aria-hidden="true"></div>${scannerContent()}</section><div class="camera-page__bottom"><p>${scannerStatus()}</p>${sourceStatus === 'ready' && !detected ? `<span>手動拍攝 · ${pilotRecords.length} 道試點餐點</span>` : ''}</div></main>`;
  }

  function dishDetail() {
    return `<main class="page page--detail">${header(`<button class="icon-button icon-button--surface" data-action="back" aria-label="Back to scan">${icon('back')}</button>`)}<article class="detail-card matte-card">${image(dish, 'detail-image')}<span class="field-label">Cafe Chico · ${escape(dish.category)}</span><h1>${escape(dish.name)}</h1><section><span class="field-label">Menu price</span><strong class="detail-price">${escape(dish.price)}</strong></section><section><span class="field-label">Menu description</span><p>${escape(dish.description)}</p></section><p class="muted">This source does not provide structured ingredients or allergen information. Treat the menu description as reference only.</p></article></main>`;
  }

  function itemDetail() {
    const priceSection = dish.price && dish.price !== '未提供'
      ? `<section><span class="field-label">Price</span><strong class="detail-price">${escape(dish.price)}</strong></section>` : '';
    return `<main class="page page--detail">${header(`<button class="icon-button icon-button--surface" data-action="back" aria-label="Back to scan">${icon('back')}</button>`)}<article class="detail-card matte-card">${image(dish, 'detail-image')}<span class="field-label">場景物品 · ${escape(dish.category)}</span><h1>${escape(dish.name)}</h1>${priceSection}<section><span class="field-label">Description</span><p>${escape(dish.description)}</p></section><p class="muted">Item data comes from the venue\u2019s item database. Visual matching is a prototype and does not replace official identification.</p></article></main>`;
  }

  function manager() {
    const records = pilotRecords.map((record) => `<div class="menu-row"><span>${escape(record.name)}</span><span>${escape(record.price)}</span><span>${escape(record.category)}</span><span class="status status--published">OCR pilot</span></div>`).join('');
    const body = sourceStatus === 'ready' ? records : `<div class="empty-row">${escape(sourceMessage())}</div>`;
    return `<main class="manager page">${header('<button class="quiet-link" data-go="/">Public view</button><a class="quiet-link" href="merchant.html">商戶介面</a>')}<div class="manager-layout manager-layout--source"><section class="manager-list"><div class="section-heading"><div><h1>Capture pilot menu</h1><p>All ten records are eligible for matching. This page cannot preselect the scanner result.</p></div>${icon('list')}</div><div class="matte-card menu-table"><div class="menu-table__header"><span>Dish</span><span>Price</span><span>Category</span><span>Status</span></div>${body}</div></section><aside class="editor matte-card source-note"><div class="section-heading"><div><span class="field-label">Source-connected test</span><h2>Read only</h2></div>${icon('edit')}</div><p>Names, prices, visible descriptions and image paths are read from the Cafe Chico menu data source.</p><p>One capture reads the menu text; a dish card only opens when the reading is confident. Merchant editing and SN Account remain later features.</p></aside></div></main>`;
  }

  function attachImageFallbacks() {
    root.querySelectorAll('img[data-image-fallback]').forEach((element) => element.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = `${element.className} image-fallback`;
      fallback.innerHTML = `${icon('image')}<span>暫無圖片</span>`;
      element.replaceWith(fallback);
    }, { once: true }));
  }

  function attachCameraFeed() {
    const viewport = root.querySelector('.camera-viewport');
    if (!viewport) return;
    if (cameraStream) {
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.className = 'camera-feed';
        videoEl.autoplay = true;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('aria-label', 'Live rear camera preview');
      }
      if (!videoEl.isConnected) viewport.prepend(videoEl);
      if (videoEl.srcObject !== cameraStream) videoEl.srcObject = cameraStream;
      videoEl.play().catch(() => {});
    } else if (videoEl) {
      videoEl.srcObject = null;
      videoEl.remove();
    }
  }

  function resetRecognition() {
    detected = false;
    dish = null;
    ocrNote = '';
    scanState = 'idle';
    lastReadText = '';
    itemCandidates = [];
  }

  function loadOcrLibrary() {
    if (window.Tesseract?.createWorker) return Promise.resolve(window.Tesseract);
    const pending = document.querySelector('script[data-tesseract-library]');
    if (pending) return new Promise((resolve, reject) => {
      pending.addEventListener('load', () => resolve(window.Tesseract), { once: true });
      pending.addEventListener('error', () => reject(new Error('The on-device text reader could not be downloaded.')), { once: true });
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.tesseractLibrary = 'true';
      script.src = ocrLibraryUrl;
      script.crossOrigin = 'anonymous';
      script.onload = () => window.Tesseract?.createWorker ? resolve(window.Tesseract) : reject(new Error('The text reader library did not load correctly.'));
      script.onerror = () => reject(new Error('The on-device text reader could not be downloaded.'));
      document.head.append(script);
    });
  }

  async function prepareOcr() {
    if (ocrWorker) {
      ocrStatus = 'ready';
      render();
      return;
    }
    if (ocrStatus === 'loading') return;
    ocrStatus = 'loading';
    ocrError = '';
    render();
    try {
      const library = await loadOcrLibrary();
      ocrWorker = await library.createWorker('eng', 1, { langPath: ocrLanguageUrl, cacheMethod: 'write' });
      await ocrWorker.setParameters({ tessedit_pageseg_mode: '11' });
      if (!cameraStream || !isScanRoute()) return;
      ocrStatus = 'ready';
      ocrNote = '對準餐牌上的菜名，然後按「拍攝」';
      render();
    } catch (error) {
      console.error('On-device OCR setup failed:', error);
      ocrWorker = null;
      ocrStatus = 'error';
      ocrError = 'The local text reader could not start. Check the connection once, then retry.';
      render();
    }
  }

  function frameForOcr() {
    const video = root.querySelector('.camera-feed');
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.min(1, 1280 / sourceWidth);
    const cropX = Math.round(sourceWidth * 0.04);
    const cropY = Math.round(sourceHeight * 0.10);
    const cropWidth = Math.round(sourceWidth * 0.92);
    const cropHeight = Math.round(sourceHeight * 0.78);
    if (!ocrCanvas) ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = Math.max(1, Math.round(cropWidth * scale));
    ocrCanvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = ocrCanvas.getContext('2d', { alpha: false });
    context.filter = 'grayscale(1) contrast(1.55)';
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, ocrCanvas.width, ocrCanvas.height);
    context.filter = 'none';
    return ocrCanvas;
  }

  function findMenuMatch(text, confidence) {
    const compactText = ` ${normalized(text)} `;
    const matches = [];
    for (const record of pilotRecords) {
      const name = normalized(record.name);
      const terms = name.split(' ').filter((term) => term.length > 2 && !['the', 'and', 'with'].includes(term));
      const exact = compactText.includes(` ${name} `);
      const allTermsPresent = terms.length > 1 && terms.every((term) => compactText.includes(` ${term} `));
      if (!exact && !allTermsPresent) continue;
      matches.push({ record, exact, score: exact ? 1 : terms.length, evidence: record.name, confidence });
    }
    matches.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || b.confidence - a.confidence);
    if (matches.length === 0) return null;
    const best = matches[0];
    const ambiguous = matches.length > 1 && matches[1].score === best.score && matches[1].confidence === best.confidence;
    if (ambiguous || (!best.exact && confidence < 60)) return null;
    return best;
  }

  function frameForCapture() {
    const video = root.querySelector('.camera-feed');
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.min(1, 640 / sourceWidth);
    const cropX = Math.round(sourceWidth * 0.20);
    const cropY = Math.round(sourceHeight * 0.18);
    const cropWidth = Math.round(sourceWidth * 0.60);
    const cropHeight = Math.round(sourceHeight * 0.64);
    if (!ocrCanvas) ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = Math.max(1, Math.round(cropWidth * scale));
    ocrCanvas.height = Math.max(1, Math.round(cropHeight * scale));
    const context = ocrCanvas.getContext('2d', { alpha: false });
    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, ocrCanvas.width, ocrCanvas.height);
    return ocrCanvas;
  }

  async function captureAndScan() {
    if (toolMode === 'item') return captureAndMatchItem();
    if (!ocrWorker || !cameraStream || ocrInFlight || detected || !isScanRoute()) return;
    const scanSession = cameraSession;
    const scanStream = cameraStream;
    const frame = frameForOcr();
    if (!frame) {
      ocrNote = '等待清晰的畫面…';
      render();
      return;
    }
    ocrInFlight = true;
    scanState = 'reading';
    ocrStatus = 'reading';
    render();
    try {
      const result = await ocrWorker.recognize(frame);
      if (scanSession !== cameraSession || scanStream !== cameraStream || !isScanRoute()) return;
      const text = result?.data?.text || '';
      const confidence = Number(result?.data?.confidence || 0);
      const match = findMenuMatch(text, confidence);
      if (match) {
        dish = match.record;
        detected = true;
        scanState = 'idle';
        ocrNote = '';
      } else {
        detected = false;
        lastReadText = text.trim().replace(/\s+/g, ' ').slice(0, 120);
        scanState = 'nomatch';
      }
    } catch (error) {
      console.error('Menu OCR failed:', error);
      lastReadText = '';
      scanState = 'nomatch';
      ocrError = '辨識這一幀失敗，請重拍。';
    } finally {
      ocrInFlight = false;
      if (!detected && ocrStatus !== 'error') ocrStatus = 'ready';
      render();
    }
  }

  // ---- 物品模式：外型簽名 → 資料庫視覺比對（RAG-like 擷取）----
  function itemSignatureFromCanvas(canvas) {
    const size = 32;
    const temp = document.createElement('canvas');
    temp.width = size;
    temp.height = size;
    const ctx = temp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const cells = 4;
    const cell = size / cells;
    const sig = new Float32Array(cells * cells * 4);
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        let r = 0, g = 0, b = 0, n = 0, e = 0;
        const y0 = Math.round(cy * cell);
        const y1 = Math.round((cy + 1) * cell);
        const x0 = Math.round(cx * cell);
        const x1 = Math.round((cx + 1) * cell);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * size + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
            if (y + 1 < size && x + 1 < size) {
              const j = ((y + 1) * size + x + 1) * 4;
              e += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
            }
          }
        }
        const idx = (cy * cells + cx) * 4;
        sig[idx] = r / n / 255;
        sig[idx + 1] = g / n / 255;
        sig[idx + 2] = b / n / 255;
        sig[idx + 3] = e / (n * 3) / 255;
      }
    }
    return sig;
  }

  function signatureDistance(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      d += diff * diff;
    }
    return Math.sqrt(d);
  }

  function loadSignatureImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function loadItems() {
    try {
      const response = await fetch(`${await ensureApiRoot()}/api/venues/cafe-chico/items`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Items API returned ${response.status}`);
      const payload = await response.json();
      const root = await ensureApiRoot();
      itemRecords = (payload.items || []).map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        price: formatPrice(item.price),
        description: item.desc || '未提供',
        imageUrl: item.image ? `${root}/${item.image}` : '',
        available: item.available !== false,
        category: '場景物品',
        item: true,
      }));
    } catch (error) {
      console.warn('Items API unavailable, falling back to menu dishes as items:', error);
      itemRecords = pilotRecords.map((record) => ({ ...record, category: '場景物品', item: true }));
    }
    itemSignatures = null;
  }

  async function buildItemSignatures() {
    if (!itemRecords.length) await loadItems();
    if (itemSignatures) return itemSignatures;
    const canvas = document.createElement('canvas');
    const out = [];
    for (const record of itemRecords) {
      try {
        const img = await loadSignatureImage(record.imageUrl);
        canvas.width = img.naturalWidth || 320;
        canvas.height = img.naturalHeight || 240;
        canvas.getContext('2d').drawImage(img, 0, 0);
        out.push({ record, sig: itemSignatureFromCanvas(canvas) });
      } catch (error) {
        console.warn('Signature image skipped:', record.name, error);
      }
    }
    itemSignatures = out;
    return out;
  }

  async function captureAndMatchItem() {
    if (ocrInFlight || !cameraStream || !isScanRoute()) return;
    const scanSession = cameraSession;
    const scanStream = cameraStream;
    const frame = frameForCapture();
    if (!frame) {
      ocrNote = '等待清晰的畫面…';
      render();
      return;
    }
    ocrInFlight = true;
    scanState = 'reading';
    itemCandidates = [];
    render();
    try {
      const signatures = await buildItemSignatures();
      if (scanSession !== cameraSession || scanStream !== cameraStream || !isScanRoute()) return;
      const query = itemSignatureFromCanvas(frame);
      const ranked = signatures
        .map(({ record, sig }) => ({ record, distance: signatureDistance(query, sig) }))
        .sort((a, b) => a.distance - b.distance);
      itemCandidates = ranked.slice(0, 3);
      const best = itemCandidates[0];
      if (best && best.distance < 0.55) {
        scanState = 'idle';
      } else {
        itemCandidates = [];
        scanState = 'nomatch';
      }
    } catch (error) {
      console.error('Item match failed:', error);
      itemCandidates = [];
      scanState = 'nomatch';
    } finally {
      ocrInFlight = false;
      render();
    }
  }

  function render() {
    root.innerHTML = path() === '/places/cafe-chico/manage' ? manager() : isScanRoute() ? scanner() : landing();
    root.querySelectorAll('[data-go]').forEach((element) => element.addEventListener('click', () => go(element.dataset.go)));
    root.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', () => action(element.dataset.action, element.dataset.slug)));
    root.querySelectorAll('[data-mode]').forEach((element) => element.addEventListener('click', () => {
      toolMode = element.dataset.mode === 'item' ? 'item' : 'menu';
      scanState = 'idle';
      lastReadText = '';
      itemCandidates = [];
      ocrNote = '';
      render();
    }));
    attachImageFallbacks();
    attachCameraFeed();
  }

  function stopCamera() {
    cameraSession += 1;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    if (cameraMode === 'ready') cameraMode = 'idle';
  }

  async function startCamera() {
    if (!window.isSecureContext) {
      cameraMode = 'insecure';
      render();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraMode = 'unsupported';
      render();
      return;
    }
    stopCamera();
    resetRecognition();
    cameraMode = 'requesting';
    render();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      cameraMode = 'ready';
      render();
      prepareOcr();
      return;
    } catch (error) {
      cameraMode = error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? 'denied' : 'error';
    }
    render();
  }

  function action(name, slug) {
    if (name === 'scan') go('/places/cafe-chico/scan');
    if (name === 'home') go('/');
    if (name === 'camera') startCamera();
    if (name === 'ocr') prepareOcr();
    if (name === 'capture') { resetRecognition(); captureAndScan(); }
    if (name === 'detail') { detail = true; stopCamera(); render(); }
    if (name === 'back') { detail = false; cameraMode = 'idle'; render(); }
    if (name === 'pick-item') {
      const found = itemRecords.find((record) => record.slug === slug);
      if (found) {
        dish = found;
        detail = true;
        stopCamera();
        render();
      }
    }
  }

  function parseMenuHtml(html) {
    const declaration = 'window.__menuData__ = ';
    const declarationStart = html.indexOf(declaration);
    const arrayStart = html.indexOf('[', declarationStart);
    const arrayEnd = html.indexOf('\n];', arrayStart);
    if (declarationStart < 0 || arrayStart < 0 || arrayEnd < 0) throw new Error('Menu data declaration is unavailable');
    return JSON.parse(html.slice(arrayStart, arrayEnd + 2));
  }

  function acceptRecords(records) {
    const selected = selectPilotRecords(records);
    if (selected.length < 10) throw new Error('Fewer than ten usable source records were found');
    pilotRecords = selected;
    sourceStatus = 'ready';
  }

  async function loadCafeMenu() {
    // 1) 本機 Cafe 網站資料夾（symlink，開發／Tailscale 測試）
    try {
      const response = await fetch(`${cafeSourceRoot}/menu.html`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu source returned ${response.status}`);
      const html = await response.text();
      const records = parseMenuHtml(html);
      activeSourceRoot = cafeSourceRoot;
      acceptRecords(records);
      render();
      return;
    } catch (error) {
      console.warn('Local cafe source unavailable:', error);
    }
    // 2) menu-api（Cloudflare D1 + R2 資料庫）
    try {
      const response = await fetch(`${await ensureApiRoot()}/api/venues/cafe-chico/menu`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu API returned ${response.status}`);
      const payload = await response.json();
      const records = (payload.records || []).map((item) => ({
        id: item.id,
        slug: item.slug,
        name: item.name,
        cat_name: item.cat_name,
        cat_slug: item.cat_slug,
        desc: item.desc,
        price: item.price,
        image: item.image,
        available: item.available === true,
      }));
      activeSourceRoot = cafeApiRoot;
      acceptRecords(records);
      render();
      return;
    } catch (error) {
      console.warn('Menu API unavailable:', error);
    }
    // 3) 公開 Cafe 網站（最後 fallback）
    try {
      const response = await fetch(`${cafeSourceFallback}/menu.html`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu source returned ${response.status}`);
      const html = await response.text();
      const records = parseMenuHtml(html);
      activeSourceRoot = cafeSourceFallback;
      acceptRecords(records);
      render();
      return;
    } catch (error) {
      sourceStatus = 'error';
      console.error('All cafe menu sources failed:', error);
    }
    render();
  }

  addEventListener('popstate', () => { if (!isScanRoute()) stopCamera(); render(); });
  addEventListener('beforeunload', () => {
    stopCamera();
    ocrWorker?.terminate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && cameraStream) {
      stopCamera();
      render();
    }
  });
  render();
  loadCafeMenu();
})();
