// ============================================
//  YT2MP3 — Frontend Script
//  Communicates with local Node.js server
// ============================================

const SERVER_BASE = window.location.origin;

// ---- DOM References ----
const urlInput      = document.getElementById('youtubeUrl');
const convertBtn    = document.getElementById('convertBtn');
const pasteBtn      = document.getElementById('pasteBtn');
const progressSec   = document.getElementById('progressSection');
const progressFill  = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPct   = document.getElementById('progressPercent');
const videoPreview  = document.getElementById('videoPreview');
const previewThumb  = document.getElementById('previewThumb');
const previewTitle  = document.getElementById('previewTitle');
const previewDur    = document.getElementById('previewDuration');
const previewChan   = document.getElementById('previewChannel');
const previewSize   = document.getElementById('previewFilesize');
const downloadSec   = document.getElementById('downloadSection');
const downloadBtn   = document.getElementById('downloadBtn');
const convertAnotherBtn = document.getElementById('convertAnotherBtn');
const errorMsg      = document.getElementById('errorMessage');
const errorText     = document.getElementById('errorText');
const donateBtn     = document.getElementById('donateBtn');

const qualityBtns   = document.querySelectorAll('.quality-btn');
const steps         = [
  document.getElementById('step1'),
  document.getElementById('step2'),
  document.getElementById('step3'),
  document.getElementById('step4')
];
const stepLines     = document.querySelectorAll('.step-line');

let selectedQuality = '320';
let currentJobId    = null;
let pollTimer       = null;

// ---- Particles ----
function createParticles() {
  const container = document.getElementById('bgParticles');
  const colors    = ['#a855f7', '#ec4899', '#3b82f6', '#06b6d4'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size  = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    Object.assign(p.style, {
      width:     size + 'px',
      height:    size + 'px',
      left:      Math.random() * 100 + '%',
      top:       Math.random() * 100 + '%',
      background: color,
      '--dur':   (Math.random() * 6 + 5) + 's',
      '--delay': (Math.random() * 6) + 's',
    });
    container.appendChild(p);
  }
}
createParticles();

// ---- Quality Buttons ----
qualityBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    qualityBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedQuality = btn.dataset.quality;
  });
});

// ---- Paste Button ----
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text;
    urlInput.focus();
  } catch {
    urlInput.focus();
    urlInput.select();
  }
});

// ---- Input Enter Key ----
urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') convertBtn.click();
});

// ---- Convert Button ----
convertBtn.addEventListener('click', () => startConversion());

// ---- Convert Another ----
convertAnotherBtn.addEventListener('click', resetUI);

// ---- Donation Button ----
donateBtn.addEventListener('click', () => openRazorpay());

// ======================================================
//  MAIN: Start Conversion
// ======================================================
async function startConversion() {
  const url = urlInput.value.trim();

  if (!url) {
    showError('Please paste a YouTube URL.');
    return;
  }

  if (!isValidYouTubeUrl(url)) {
    showError('This doesn\'t look like a valid YouTube URL. Please check and try again.');
    return;
  }

  resetProgressUI();
  showProgress();

  try {
    // Step 1: Submit job
    setStep(0);
    setProgress(10, 'Fetching video info...');

    const res = await fetchWithTimeout(`${SERVER_BASE}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, quality: selectedQuality })
    }, 15000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || `Server returned ${res.status}`);
    }

    const data = await res.json();
    currentJobId = data.jobId;

    // Show video preview
    if (data.info) showVideoPreview(data.info);

    // Step 2: Poll progress
    setStep(1);
    setProgress(25, 'Downloading audio...');
    await pollJobStatus(currentJobId);

  } catch (err) {
    console.error(err);
    showError(err.message || 'Connection error. Is the server running on port 3001?');
  }
}

// ======================================================
//  POLL: Check job status every second
// ======================================================
async function pollJobStatus(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_BASE}/api/status/${jobId}`);
        if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
        const data = await res.json();

        handleStatusUpdate(data, interval, resolve, reject);
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 1000);
  });
}

function handleStatusUpdate(data, interval, resolve, reject) {
  switch (data.status) {
    case 'info':
      setStep(0);
      setProgress(15, 'Fetching video info...');
      break;

    case 'downloading':
      setStep(1);
      const dlPct = data.progress || 25;
      setProgress(25 + (dlPct * 0.4), `Downloading... ${dlPct}%`);
      break;

    case 'converting':
      setStep(2);
      setProgress(70, 'Converting to MP3...');
      break;

    case 'done':
      clearInterval(interval);
      setStep(3);
      setProgress(100, 'Done! Ready to download.');
      setTimeout(() => showDownload(data), 400);
      resolve(data);
      break;

    case 'error':
      clearInterval(interval);
      reject(new Error(data.error || 'Conversion failed'));
      break;
  }
}

// ======================================================
//  UI Helpers
// ======================================================

function isValidYouTubeUrl(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/.test(url);
}

async function fetchWithTimeout(url, options, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Request timed out. Is the server running?');
    throw err;
  }
}

function showProgress() {
  hideError();
  progressSec.style.display = 'block';
  videoPreview.style.display = 'none';
  downloadSec.style.display  = 'none';
  convertBtn.disabled        = true;
}

function setProgress(pct, label) {
  progressFill.style.width   = pct + '%';
  progressLabel.textContent  = label;
  progressPct.textContent    = Math.round(pct) + '%';
}

function setStep(activeIdx) {
  steps.forEach((step, i) => {
    const dot = step.querySelector('.step-dot');
    step.classList.remove('done', 'current');
    dot.classList.remove('active', 'done');

    if (i < activeIdx) {
      step.classList.add('done');
      dot.classList.add('done');
      if (stepLines[i]) stepLines[i].classList.add('done');
    } else if (i === activeIdx) {
      step.classList.add('current');
      dot.classList.add('active');
    }
  });
}

function showVideoPreview(info) {
  videoPreview.style.display = 'flex';
  previewTitle.textContent   = info.title || 'Unknown title';
  previewDur.textContent     = formatDuration(info.duration);
  previewChan.textContent    = info.uploader || info.channel || 'Unknown';
  if (info.thumbnail) previewThumb.src = info.thumbnail;
}

function showDownload(data) {
  downloadSec.style.display = 'flex';
  const fileUrl = `${SERVER_BASE}/api/download/${data.filename}`;
  downloadBtn.href     = fileUrl;
  downloadBtn.download = data.filename || 'audio.mp3';

  if (data.filesize) {
    previewSize.textContent = `File size: ${formatBytes(data.filesize)}`;
  }
}

function showError(msg) {
  hideProgress();
  errorMsg.style.display   = 'flex';
  errorText.textContent    = msg;
  convertBtn.disabled      = false;
}

function hideError()    { errorMsg.style.display  = 'none'; }
function hideProgress() { progressSec.style.display = 'none'; }

function resetProgressUI() {
  hideError();
  setProgress(0, 'Starting...');
  setStep(-1);
  stepLines.forEach(l => l.classList.remove('done'));
}

function resetUI() {
  urlInput.value             = '';
  downloadSec.style.display  = 'none';
  progressSec.style.display  = 'none';
  videoPreview.style.display = 'none';
  convertBtn.disabled        = false;
  hideError();
  resetProgressUI();
  urlInput.focus();
}

// ======================================================
//  DONATION: Razorpay
// ======================================================
async function openRazorpay() {
  try {
    donateBtn.disabled = true;
    donateBtn.textContent = 'Opening...';

    const res = await fetch(`${SERVER_BASE}/api/donate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100 }) // Default 100 INR
    });

    if (!res.ok) throw new Error('Failed to create donation order');
    const order = await res.json();

    const options = {
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: "YT2MP3 Support",
      description: "Buy me a coffee",
      image: "https://cdn-icons-png.flaticon.com/512/924/924514.png",
      order_id: order.id,
      handler: function (response) {
        alert("Thank you for your support! Payment ID: " + response.razorpay_payment_id);
      },
      prefill: {
        name: "",
        email: "",
        contact: ""
      },
      theme: {
        color: "#a855f7"
      }
    };

    const rzp1 = new Razorpay(options);
    rzp1.open();

  } catch (err) {
    console.error(err);
    alert('Could not open Razorpay. Error: ' + err.message);
  } finally {
    donateBtn.disabled = false;
    donateBtn.innerHTML = '<span class="coffee-icon">☕</span> Buy me a coffee';
  }
}

// ---- Formatters ----
function formatDuration(secs) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ---- Intersection Observer Animations ----
document.querySelectorAll('.step-card, .feature-card').forEach((el, i) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = `opacity 0.5s ease ${i * 0.07}s, transform 0.5s ease ${i * 0.07}s`;

  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
        obs.disconnect();
      }
    });
  }, { threshold: 0.1 });

  obs.observe(el);
});
