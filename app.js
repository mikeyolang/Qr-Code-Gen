const PACKAGE_NAME = 'com.ma3app';
const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;

const promoInput = document.querySelector('#promoCode');
const titleInput = document.querySelector('#cardTitle');
const foregroundInput = document.querySelector('#foregroundColor');
const backgroundInput = document.querySelector('#backgroundColor');
const foregroundLabel = document.querySelector('#foregroundLabel');
const backgroundLabel = document.querySelector('#backgroundLabel');
const plainCanvas = document.querySelector('#plainCanvas');
const storeCanvas = document.querySelector('#storeCanvas');
const plainValue = document.querySelector('#plainValue');
const storeValue = document.querySelector('#storeValue');
const downloadPlain = document.querySelector('#downloadPlain');
const downloadStore = document.querySelector('#downloadStore');
const statusMessage = document.querySelector('#statusMessage');
const titleSlots = document.querySelectorAll('[data-title]');
const previewCards = document.querySelectorAll('[data-preview]');
const emptyStates = document.querySelectorAll('[data-empty]');

let renderToken = 0;

function getPromoCode() {
  return promoInput.value.trim().toUpperCase();
}

function normalizePromoInput() {
  const uppercaseValue = promoInput.value.toUpperCase();

  if (promoInput.value !== uppercaseValue) {
    const cursorPosition = promoInput.selectionStart;
    promoInput.value = uppercaseValue;
    promoInput.setSelectionRange(cursorPosition, cursorPosition);
  }
}

function getTitle() {
  return titleInput.value.trim();
}

function getColors() {
  return {
    foreground: foregroundInput.value,
    background: backgroundInput.value
  };
}

function buildPlayStoreReferrerUrl(promoCode) {
  const referrer = encodeURIComponent(`coupon=${promoCode}`);
  return `${PLAY_STORE_URL}&referrer=${referrer}`;
}

function getQrValues() {
  const promoCode = getPromoCode();
  return {
    plain: promoCode,
    store: promoCode ? buildPlayStoreReferrerUrl(promoCode) : ''
  };
}

function setCanvasBlank(canvas, background) {
  const context = canvas.getContext('2d');
  canvas.width = 320;
  canvas.height = 320;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function setStatus(message) {
  statusMessage.textContent = message;
  statusMessage.hidden = !message;
}

async function drawQr(canvas, value) {
  const { foreground, background } = getColors();

  if (!value) {
    setCanvasBlank(canvas, background);
    return;
  }

  if (!window.QRCode) {
    throw new Error('QR generator did not load. Keep local-qrcode.js in the same folder as index.html.');
  }

  await window.QRCode.toCanvas(canvas, value, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: foreground,
      light: background
    }
  });
}

async function render() {
  const currentToken = ++renderToken;
  const promoCode = getPromoCode();
  const title = getTitle();
  const { foreground, background } = getColors();
  const values = getQrValues();

  foregroundLabel.textContent = foreground.toUpperCase();
  backgroundLabel.textContent = background.toUpperCase();

  titleSlots.forEach((slot) => {
    slot.textContent = title;
    slot.style.color = foreground;
  });

  previewCards.forEach((card) => {
    card.style.backgroundColor = background;
  });

  plainValue.textContent = values.plain || 'Promo code appears here';
  storeValue.textContent = values.store || 'Play Store URL appears here';

  downloadPlain.disabled = !promoCode;
  downloadStore.disabled = !promoCode;
  emptyStates.forEach((state) => {
    state.hidden = Boolean(promoCode);
  });
  setStatus('');

  try {
    await Promise.all([
      drawQr(plainCanvas, values.plain),
      drawQr(storeCanvas, values.store)
    ]);
  } catch (error) {
    downloadPlain.disabled = true;
    downloadStore.disabled = true;
    setCanvasBlank(plainCanvas, background);
    setCanvasBlank(storeCanvas, background);
    setStatus(error.message || 'QR generation failed.');
  }

  if (currentToken !== renderToken) {
    return;
  }
}

function wrapText(context, text, maxWidth, font) {
  if (!text || !context) {
    return [];
  }

  context.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }

    if (line) {
      lines.push(line);
    }

    if (context.measureText(word).width <= maxWidth) {
      line = word;
      return;
    }

    const pieces = breakLongWord(context, word, maxWidth);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1] || '';
  });

  if (line) {
    lines.push(line);
  }

  return lines;
}

function breakLongWord(context, word, maxWidth) {
  const pieces = [];
  let piece = '';

  Array.from(word).forEach((char) => {
    const candidate = `${piece}${char}`;
    if (context.measureText(candidate).width <= maxWidth) {
      piece = candidate;
      return;
    }

    if (piece) {
      pieces.push(piece);
    }
    piece = char;
  });

  if (piece) {
    pieces.push(piece);
  }

  return pieces;
}

async function createExportCanvas(value) {
  if (!window.QRCode) {
    throw new Error('QR generator did not load. Keep local-qrcode.js in the same folder as index.html.');
  }

  const { foreground, background } = getColors();
  const title = getTitle();
  const width = 1400;
  const padding = 140;
  const qrSize = 900;
  const titleFont = '700 76px Arial, sans-serif';
  const lineHeight = 92;

  const measuringCanvas = document.createElement('canvas');
  const measuringContext = measuringCanvas.getContext('2d');
  const titleLines = wrapText(measuringContext, title, width - padding * 2, titleFont);
  const titleHeight = titleLines.length ? titleLines.length * lineHeight + 70 : 0;
  const height = padding + titleHeight + qrSize + padding;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  let cursorY = padding;
  if (titleLines.length) {
    context.fillStyle = foreground;
    context.font = titleFont;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    titleLines.forEach((line, index) => {
      context.fillText(line, width / 2, cursorY + index * lineHeight);
    });
    cursorY += titleLines.length * lineHeight + 70;
  }

  const qrCanvas = document.createElement('canvas');
  await window.QRCode.toCanvas(qrCanvas, value, {
    width: qrSize,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: foreground,
      light: background
    }
  });

  context.drawImage(qrCanvas, (width - qrSize) / 2, cursorY, qrSize, qrSize);
  return canvas;
}

function makeFileName(kind) {
  const slug = getPromoCode()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'promo-code';
  const prefix = kind === 'plain' ? 'plain-promo' : 'play-store-referrer';
  return `ma3app-${prefix}-${slug}.png`;
}

async function downloadCard(kind) {
  const values = getQrValues();
  const value = kind === 'plain' ? values.plain : values.store;

  if (!value) {
    return;
  }

  try {
    const canvas = await createExportCanvas(value);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = makeFileName(kind);
    link.rel = 'noopener';
    link.click();
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'PNG download failed.');
  }
}

promoInput.addEventListener('input', () => {
  normalizePromoInput();
  render();
});
titleInput.addEventListener('input', render);
foregroundInput.addEventListener('input', render);
backgroundInput.addEventListener('input', render);
downloadPlain.addEventListener('click', () => downloadCard('plain'));
downloadStore.addEventListener('click', () => downloadCard('store'));
window.addEventListener('load', render);
render();
