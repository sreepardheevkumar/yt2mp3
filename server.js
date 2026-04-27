// ============================================
//  YT2MP3 Backend Server
//  Requirements: Node.js, yt-dlp installed
//  Install deps: npm install
//  Run: node server.js
// ============================================

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 }  = require('uuid');
const Razorpay = require('razorpay');

// ---- Razorpay Config ----
// Get these from https://dashboard.razorpay.com/app/keys
const razorpay = new Razorpay({
  key_id: 'rzp_test_Sics6hsTw1CSfw', // Your actual Key ID
  key_secret: '6CqAvcL9RC40fPnw04XV3hYg', // Your actual Key Secret
});

const app  = express();
const PORT = process.env.PORT || 3001;

// ---- Resolve yt-dlp and ffmpeg paths ----
const isLinux = os.platform() === 'linux';

// Windows-specific paths (your local machine)
const WINGET_BASE = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
const YTDLP_WIN = path.join(WINGET_BASE, 'yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe');
const FFMPEG_WIN = path.join(WINGET_BASE, 'yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-N-123778-g3b55818764-win64-gpl', 'bin', 'ffmpeg.exe');

// Set binaries based on OS
let YTDLP_BIN  = 'yt-dlp';
let FFMPEG_BIN = 'ffmpeg';

if (!isLinux) {
  if (fs.existsSync(YTDLP_WIN)) YTDLP_BIN = YTDLP_WIN;
  if (fs.existsSync(FFMPEG_WIN)) FFMPEG_BIN = FFMPEG_WIN;
}

console.log(`[Config] OS: ${os.platform()}`);
console.log(`[Config] yt-dlp: ${YTDLP_BIN}`);
console.log(`[Config] ffmpeg: ${FFMPEG_BIN}`);

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// ---- Output Directory ----
const OUTPUT_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ---- Serve static frontend ----
app.use(express.static(path.join(__dirname)));

// ---- Job Store (in-memory) ----
const jobs = {};

// ============================================================
//  Helper: check if yt-dlp is available
// ============================================================
function checkYtDlp() {
  return new Promise((resolve) => {
    exec(`"${YTDLP_BIN}" --version`, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

// ============================================================
//  Helper: get video info (fast, no download)
// ============================================================
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const args = [
      '--dump-json',
      '-f', 'ba/b',
      '--no-playlist',
      '--no-warnings',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player-client=web,mweb,web_music,ios;player-skip=webpage,configs',
      url
    ];

    // Priority 1: Use cookies.txt if it exists (Best for Cloud/Render)
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    } 
    // Priority 2: Use local browser cookies (Best for local Windows testing)
    else if (!isLinux) {
      args.push('--cookies-from-browser', 'chrome');
    }

    const proc = spawn(YTDLP_BIN, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp info failed: ${stderr.slice(0, 300)}`));
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title:     info.title,
          duration:  info.duration,
          thumbnail: info.thumbnail,
          uploader:  info.uploader || info.channel,
          id:        info.id
        });
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });
  });
}

// ============================================================
//  Helper: sanitize filename
// ============================================================
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 120);
}

// ============================================================
//  POST /api/convert  — Submit conversion job
// ============================================================
app.post('/api/convert', async (req, res) => {
  const { url, quality = '320' } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate YouTube URL
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/;
  if (!ytRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  // Check yt-dlp
  const ytDlpVersion = await checkYtDlp();
  if (!ytDlpVersion) {
    return res.status(500).json({
      error: 'yt-dlp is not installed. Please install it: https://github.com/yt-dlp/yt-dlp'
    });
  }

  const jobId = uuidv4();
  jobs[jobId] = { status: 'info', progress: 0, error: null };

  res.json({ jobId, message: 'Job started' });

  // Run job in background
  runConversionJob(jobId, url, quality);
});

// ============================================================
//  Conversion Job Runner
// ============================================================
async function runConversionJob(jobId, url, quality) {
  const job = jobs[jobId];

  try {
    // Step 1: Get info
    job.status = 'info';
    const info = await getVideoInfo(url);
    job.info = info;

    const safeTitle = sanitizeFilename(info.title || 'audio');
    const filename  = `${safeTitle}_${jobId.split('-')[0]}.mp3`;
    const outPath   = path.join(OUTPUT_DIR, filename);

    job.status   = 'downloading';
    job.filename = filename;

    // Step 2: Download + convert with yt-dlp
    await downloadAndConvert(url, outPath, quality, job);

    // Step 3: Verify file
    if (!fs.existsSync(outPath)) {
      throw new Error('Output file not found after conversion');
    }

    const stat = fs.statSync(outPath);
    job.filesize = stat.size;
    job.status   = 'done';

    // Auto-delete after 15 minutes
    setTimeout(() => {
      try { fs.unlinkSync(outPath); } catch {}
      delete jobs[jobId];
    }, 15 * 60 * 1000);

  } catch (err) {
    console.error(`[Job ${jobId}] Error:`, err.message);
    job.status = 'error';
    job.error  = err.message;
  }
}

// ============================================================
//  Helper: yt-dlp download + ffmpeg convert
// ============================================================
function downloadAndConvert(url, outPath, quality, job) {
  return new Promise((resolve, reject) => {
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const args = [
      '-x',
      '-f', 'ba/b',
      '--audio-format', 'mp3',
      '--audio-quality', quality === '320' ? '0' : quality === '192' ? '3' : '5',
      '--no-playlist',
      '--no-warnings',
      '--progress',
      '--ffmpeg-location', path.dirname(FFMPEG_BIN),
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--extractor-args', 'youtube:player-client=web,mweb,web_music,ios;player-skip=webpage,configs',
      '-o', outPath,
      url
    ];

    // Priority 1: Use cookies.txt if it exists
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    }
    // Priority 2: Use local browser cookies
    else if (!isLinux) {
      args.push('--cookies-from-browser', 'chrome');
    }

    console.log(`[yt-dlp] Starting: "${YTDLP_BIN}" ${args.join(' ')}`);
    const proc = spawn(YTDLP_BIN, args);

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      console.log('[yt-dlp stdout]', line.trim());

      // Parse progress
      const dlMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (dlMatch) {
        const pct = parseFloat(dlMatch[1]);
        if (pct < 100) {
          job.status   = 'downloading';
          job.progress = pct;
        } else {
          job.status   = 'converting';
          job.progress = 100;
        }
      }

      if (line.includes('[ExtractAudio]') || line.includes('Converting')) {
        job.status = 'converting';
      }
    });

    proc.stderr.on('data', data => {
      const line = data.toString();
      console.warn('[yt-dlp stderr]', line.trim());

      // Some builds write progress to stderr
      const dlMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (dlMatch) {
        const pct = parseFloat(dlMatch[1]);
        job.progress = pct;
        job.status   = pct < 100 ? 'downloading' : 'converting';
      }
    });

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });

    proc.on('error', err => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`));
    });
  });
}

// ============================================================
//  GET /api/status/:jobId  — Poll job status
// ============================================================
app.get('/api/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs[jobId];

  if (!job) {
    return res.status(404).json({ error: 'Job not found or expired' });
  }

  res.json({
    status:   job.status,
    progress: job.progress,
    error:    job.error,
    filename: job.filename,
    filesize: job.filesize,
    info:     job.info
  });
});

// ============================================================
//  GET /api/download/:filename  — Serve the MP3 file
// ============================================================
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;

  // Security: prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(OUTPUT_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(filePath);
});

// ============================================================
//  GET /api/health  — Health check
// ============================================================
app.get('/api/health', async (req, res) => {
  const ytDlpVersion = await checkYtDlp();
  res.json({
    status:       'ok',
    ytDlp:        ytDlpVersion || 'NOT INSTALLED',
    ytDlpReady:   !!ytDlpVersion
  });
});

// ============================================================
//  POST /api/donate  — Create Razorpay Order
// ============================================================
app.post('/api/donate', async (req, res) => {
  const { amount = 100 } = req.body; // default 100 INR

  const options = {
    amount: amount * 100, // amount in smallest currency unit (paise for INR)
    currency: "INR",
    receipt: `receipt_${uuidv4().split('-')[0]}`,
  };

  try {
    const order = await razorpay.orders.create(options);
    res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      key_id: razorpay.key_id // Send key_id to frontend for checkout
    });
  } catch (error) {
    console.error('[Razorpay Order Error]:', error);
    res.status(500).json({ error: 'Failed to create donation order' });
  }
});

// ============================================================
//  Start Server
// ============================================================
app.listen(PORT, async () => {
  console.log('\n╔════════════════════════════════════╗');
  console.log(`║  YT2MP3 Server running on :${PORT}  ║`);
  console.log('╚════════════════════════════════════╝\n');

  const ytDlpVer = await checkYtDlp();
  if (ytDlpVer) {
    console.log(`✅  yt-dlp: ${ytDlpVer}`);
  } else {
    console.warn('⚠️  yt-dlp NOT found! Install it from: https://github.com/yt-dlp/yt-dlp');
    console.warn('    Windows: winget install yt-dlp  OR  pip install yt-dlp');
  }

  console.log(`\n🌐 Open in browser: http://localhost:${PORT}`);
  console.log('📁 MP3 files saved to: ./downloads/\n');
});
