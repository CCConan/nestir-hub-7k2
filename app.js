(() => {
  const root = document.querySelector('#root');
  const cafeSourceRoot = '/cafe-chico-source';
  const cafeMenuSource = `${cafeSourceRoot}/menu.html`;
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
  let ocrTimer = null;
  let ocrInFlight = false;
  let ocrCanvas = null;
  let ocrNote = '';
  let ocrError = '';
  let candidate = { id: null, readings: 0, confidence: 0, evidence: '' };

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
  const sourceImageUrl = (imagePath) => `${cafeSourceRoot}/${String(imagePath || '').replace(/^\/+/, '')}`;
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
    return `<main class="page page--landing">${header()}<section class="landing-content"><div class="landing-copy"><h1>Explore the menu.</h1><p>Use your camera to find dishes, menu prices and their source descriptions.</p></div><article class="venue-card"><div class="venue-card__scene" aria-hidden="true"><span>CAFE<br/>CHICO</span></div><div class="venue-card__body"><div><h2>Cafe Chico</h2><p>${sourceMessage()}</p></div>${button(`${icon('camera')}Scan a menu`, 'scan', sourceStatus !== 'ready' ? 'button--loading' : '')}</div></article><p class="privacy-note">Menu frames stay on this device. The text reader runs locally in the browser.</p></section><footer>Powered by <strong>NESTIR</strong></footer></main>`;
  }

  function cameraBackdrop() {
    if (cameraStream) return '<video class="camera-feed" data-camera-feed autoplay muted playsinline aria-label="Live rear camera preview"></video>';
    return '<div class="paper-menu" aria-hidden="true"><span>CAFE CHICO</span><i></i><i></i><i></i><i></i><i></i></div>';
  }

  function cameraMessage(iconName, heading, message, actions = '') {
    return `<div class="camera-message">${icon(iconName)}<h1>${heading}</h1><p>${message}</p>${actions}</div>`;
  }

  function readyToScan() {
    const check = candidate.id ? `Checking “${escape(candidate.evidence)}” (${candidate.readings}/2)…` : (ocrNote || 'Looking for a Cafe Chico menu name…');
    return `<div class="scan-guide scan-guide--processing" aria-hidden="true"><span></span></div><div class="camera-action-tray"><p>${check}</p><span class="camera-wait" aria-live="polite">Reading text from the live camera automatically. Hold the menu steady.</span></div>`;
  }

  function scanResult() {
    return `<div class="scan-guide scan-guide--found" aria-hidden="true"><span></span></div><div class="ocr-box"><span>${escape(candidate.evidence || dish.name)}</span></div><article class="scan-result">${image(dish, 'scan-image')}<span class="field-label scan-result__test-note">Live camera text match</span><h1>${escape(dish.name)}</h1><p class="scan-result__evidence">Matched menu text: “${escape(candidate.evidence || dish.name)}”</p><span class="field-label">Menu price</span><strong>${escape(dish.price)}</strong><span class="field-label">Menu description</span><p>${escape(dish.description)}</p>${button('View dish', 'detail')}<button class="text-button scan-again" data-action="toggle">Keep scanning</button></article>`;
  }

  function scannerContent() {
    if (sourceStatus !== 'ready') {
      return cameraMessage(sourceStatus === 'error' ? 'warning' : 'camera', sourceStatus === 'error' ? 'Menu data unavailable' : 'Loading menu data', sourceStatus === 'error' ? 'The local Cafe Chico website source could not be read. Return home and retry.' : 'Reading the existing Cafe Chico website menu for this live OCR test.', sourceStatus === 'error' ? button('Return home', 'home') : '');
    }
    if (detected) return scanResult();
    if (cameraMode === 'requesting') return cameraMessage('camera', 'Waiting for camera access', 'Approve the browser prompt to use the rear camera. The preview stays on this device.');
    if (cameraMode === 'ready' && ocrStatus === 'loading') return cameraMessage('camera', 'Preparing text reader', 'The first use downloads an English reading model to this browser. Menu images are not uploaded.');
    if (cameraMode === 'ready' && (ocrStatus === 'ready' || ocrStatus === 'reading')) return readyToScan();
    if (cameraMode === 'ready' && ocrStatus === 'error') return cameraMessage('warning', 'Text reader could not start', escape(ocrError || 'Try again with a network connection for the first local model download.'), button('Retry text reader', 'ocr'));
    if (cameraMode === 'denied') return cameraMessage('warning', 'Camera permission was not granted', 'Enable camera access for this secure site in the browser, then try again.', button('Try camera again', 'camera'));
    if (cameraMode === 'insecure') return cameraMessage('warning', 'A secure link is required', 'Phone cameras only work on HTTPS. This local address is for layout testing only.');
    if (cameraMode === 'unsupported' || cameraMode === 'error') return cameraMessage('warning', 'Camera is unavailable here', 'This browser cannot start a camera preview for this test.');
    return cameraMessage('camera', 'Ready to use the rear camera', 'Start the camera once. After permission, PopList reads the menu automatically and only opens a card when live text matches one of the Cafe Chico pilot dishes.', button(`${icon('camera')}Use rear camera`, 'camera'));
  }

  function scannerStatus() {
    if (detected) return 'Live menu text matched';
    if (ocrStatus === 'loading') return 'Preparing on-device text reader';
    if (ocrStatus === 'reading') return 'Reading live menu text';
    if (ocrStatus === 'ready') return 'Automatic live scan';
    return 'Camera test';
  }

  function scanner() {
    if (detail && dish) return dishDetail();
    return `<main class="camera-page"><div class="camera-page__chrome"><button class="icon-button" data-go="/" aria-label="Close scan">${icon('close')}</button><span>Cafe Chico</span>${mark(true)}</div><section class="camera-viewport ${cameraStream ? 'camera-viewport--live' : ''}" aria-label="Menu camera viewport">${cameraBackdrop()}<div class="camera-vignette" aria-hidden="true"></div>${scannerContent()}</section><div class="camera-page__bottom"><p>${scannerStatus()}</p>${sourceStatus === 'ready' && !detected ? '<span>10-dish pilot · no manual dish selection</span>' : ''}</div></main>`;
  }

  function dishDetail() {
    return `<main class="page page--detail">${header(`<button class="icon-button icon-button--surface" data-action="back" aria-label="Back to scan">${icon('back')}</button>`)}<article class="detail-card matte-card">${image(dish, 'detail-image')}<span class="field-label">Cafe Chico · ${escape(dish.category)}</span><h1>${escape(dish.name)}</h1><section><span class="field-label">Menu price</span><strong class="detail-price">${escape(dish.price)}</strong></section><section><span class="field-label">Menu description</span><p>${escape(dish.description)}</p></section><p class="muted">This source does not provide structured ingredients or allergen information. Treat the menu description as reference only.</p></article></main>`;
  }

  function manager() {
    const records = pilotRecords.map((record) => `<div class="menu-row"><span>${escape(record.name)}</span><span>${escape(record.price)}</span><span>${escape(record.category)}</span><span class="status status--published">OCR pilot</span></div>`).join('');
    const body = sourceStatus === 'ready' ? records : `<div class="empty-row">${escape(sourceMessage())}</div>`;
    return `<main class="manager page">${header('<button class="quiet-link" data-go="/">Public view</button>')}<div class="manager-layout manager-layout--source"><section class="manager-list"><div class="section-heading"><div><h1>Live OCR pilot menu</h1><p>All ten records are eligible for automatic matching. This page cannot preselect the scanner result.</p></div>${icon('list')}</div><div class="matte-card menu-table"><div class="menu-table__header"><span>Dish</span><span>Price</span><span>Category</span><span>Status</span></div>${body}</div></section><aside class="editor matte-card source-note"><div class="section-heading"><div><span class="field-label">Source-connected test</span><h2>Read only</h2></div>${icon('edit')}</div><p>Names, prices, visible descriptions and image paths are read from the existing Cafe Chico menu page.</p><p>Live OCR only opens a result after two consecutive readings agree. Merchant editing and SN Account remain later features.</p></aside></div></main>`;
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
    const video = root.querySelector('[data-camera-feed]');
    if (!video || !cameraStream) return;
    video.srcObject = cameraStream;
    video.play().catch(() => {});
  }

  function stopAutoScan() {
    if (ocrTimer) clearInterval(ocrTimer);
    ocrTimer = null;
  }

  function resetRecognition() {
    detected = false;
    dish = null;
    candidate = { id: null, readings: 0, confidence: 0, evidence: '' };
    ocrNote = '';
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
      startAutoScan();
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
      ocrNote = 'Looking for a Cafe Chico menu name…';
      render();
      startAutoScan();
    } catch (error) {
      console.error('On-device OCR setup failed:', error);
      ocrWorker = null;
      ocrStatus = 'error';
      ocrError = 'The local text reader could not start. Check the connection once, then retry.';
      render();
    }
  }

  function frameForOcr() {
    const video = root.querySelector('[data-camera-feed]');
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

  async function scanFrame() {
    if (!ocrWorker || !cameraStream || detected || ocrInFlight || !isScanRoute()) return;
    const scanSession = cameraSession;
    const scanStream = cameraStream;
    const frame = frameForOcr();
    if (!frame) {
      ocrNote = 'Waiting for a clear camera frame…';
      return;
    }
    ocrInFlight = true;
    ocrStatus = 'reading';
    try {
      const result = await ocrWorker.recognize(frame);
      if (scanSession !== cameraSession || scanStream !== cameraStream || detected || !isScanRoute()) return;
      const text = result?.data?.text || '';
      const confidence = Number(result?.data?.confidence || 0);
      const match = findMenuMatch(text, confidence);
      if (!match) {
        candidate = { id: null, readings: 0, confidence: 0, evidence: '' };
        const preview = text.trim().replace(/\s+/g, ' ').slice(0, 72);
        ocrNote = preview ? `Menu text seen: “${preview}”` : 'Looking for a clear Cafe Chico menu name…';
      } else if (candidate.id === match.record.id) {
        candidate = { id: match.record.id, readings: candidate.readings + 1, confidence, evidence: match.evidence };
      } else {
        candidate = { id: match.record.id, readings: 1, confidence, evidence: match.evidence };
      }
      if (candidate.readings >= 2) {
        dish = match.record;
        detected = true;
        stopAutoScan();
      }
    } catch (error) {
      console.error('Live menu OCR failed:', error);
      ocrNote = 'The text reader missed this frame — keep the menu steady.';
    } finally {
      ocrInFlight = false;
      if (!detected && ocrStatus !== 'error') ocrStatus = 'ready';
      render();
    }
  }

  function startAutoScan() {
    if (!cameraStream || !ocrWorker || detected || ocrTimer) return;
    scanFrame();
    ocrTimer = setInterval(scanFrame, 1500);
  }

  function render() {
    root.innerHTML = path() === '/places/cafe-chico/manage' ? manager() : isScanRoute() ? scanner() : landing();
    root.querySelectorAll('[data-go]').forEach((element) => element.addEventListener('click', () => go(element.dataset.go)));
    root.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', () => action(element.dataset.action)));
    attachImageFallbacks();
    attachCameraFeed();
  }

  function stopCamera() {
    stopAutoScan();
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

  function keepScanning() {
    resetRecognition();
    startCamera();
  }

  function action(name) {
    if (name === 'scan') go('/places/cafe-chico/scan');
    if (name === 'home') go('/');
    if (name === 'camera') startCamera();
    if (name === 'ocr') prepareOcr();
    if (name === 'toggle') keepScanning();
    if (name === 'detail') { detail = true; stopCamera(); render(); }
    if (name === 'back') { detail = false; cameraMode = 'idle'; render(); }
  }

  async function loadCafeMenu() {
    try {
      const response = await fetch(cafeMenuSource, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu source returned ${response.status}`);
      const html = await response.text();
      const declaration = 'window.__menuData__ = ';
      const declarationStart = html.indexOf(declaration);
      const arrayStart = html.indexOf('[', declarationStart);
      const arrayEnd = html.indexOf('\n];', arrayStart);
      if (declarationStart < 0 || arrayStart < 0 || arrayEnd < 0) throw new Error('Menu data declaration is unavailable');
      const records = JSON.parse(html.slice(arrayStart, arrayEnd + 2));
      pilotRecords = selectPilotRecords(records);
      if (pilotRecords.length < 10) throw new Error('Fewer than ten usable source records were found');
      sourceStatus = 'ready';
    } catch (error) {
      sourceStatus = 'error';
      console.error('Cafe Chico source load failed:', error);
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
