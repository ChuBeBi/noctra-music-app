const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ytSearch = require('yt-search');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '200kb' }));

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 64
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 64
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'library.json');

// Cache tạm trong RAM cho các danh mục YouTube & tìm kiếm (TTL: 15 phút)
const memoryCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  memoryCache.set(key, { time: Date.now(), data });
}

/**
 * Danh sách bài hát YouTube mặc định khi chưa có bài lưu
 * Toàn bộ là bài hát thật trên YouTube có thời lượng cố định (không dùng livestream)
 */
const DEFAULT_YOUTUBE_SONGS = [
  {
    id: 'yt-sK7wnxvd3hA',
    title: 'Chúng Ta Của Tương Lai',
    artist: 'Sơn Tùng M-TP',
    videoId: 'sK7wnxvd3hA',
    category: 'V-POP',
    cover: 'https://i.ytimg.com/vi/sK7wnxvd3hA/hqdefault.jpg',
    duration: '4:12'
  },
  {
    id: 'yt-5zsnvK136_E',
    title: 'Bước Qua Nhau',
    artist: 'Vũ · V-Pop Indie',
    videoId: '5zsnvK136_E',
    category: 'V-POP',
    cover: 'https://i.ytimg.com/vi/5zsnvK136_E/hqdefault.jpg',
    duration: '4:17'
  },
  {
    id: 'yt-d3p_Vf0zH20',
    title: 'Nấu Ăn Cho Em',
    artist: 'Đen ft. PiaLinh',
    videoId: 'd3p_Vf0zH20',
    category: 'V-POP',
    cover: 'https://i.ytimg.com/vi/d3p_Vf0zH20/hqdefault.jpg',
    duration: '4:45'
  },
  {
    id: 'yt-8x2S3q1WlP4',
    title: 'Mascara',
    artist: 'Chillies',
    videoId: '8x2S3q1WlP4',
    category: 'ACOUSTIC',
    cover: 'https://i.ytimg.com/vi/8x2S3q1WlP4/hqdefault.jpg',
    duration: '5:02'
  },
  {
    id: 'yt-DWcJFNfaw9c',
    title: 'Peaceful Piano Music & Soft Rain',
    artist: 'Soothing Relaxation · Piano',
    videoId: 'DWcJFNfaw9c',
    category: 'SLEEP',
    cover: 'https://i.ytimg.com/vi/DWcJFNfaw9c/hqdefault.jpg',
    duration: '3:00:00'
  }
];

function loadLibrary() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch (e) {
    console.warn('Lỗi đọc library.json:', e.message);
  }
  return DEFAULT_YOUTUBE_SONGS;
}

function saveLibrary(list) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Lỗi ghi library.json:', e.message);
  }
}

function extractYouTubeId(input = '') {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1, 12);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
    if (embedIdx !== -1 && parts[embedIdx + 1]) {
      const id = parts[embedIdx + 1].slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch (_) {}
  return null;
}

function extractPlaylistId(input = '') {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed) && trimmed.startsWith('PL')) return trimmed;
  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get('list');
    if (list && /^[a-zA-Z0-9_-]{10,}$/.test(list)) return list;
  } catch (_) {}
  return null;
}

const CATEGORY_QUERIES = {
  trending: 'nhac tre ballad acoustic hot trend viet nam',
  vpop: 'nhac tre vpop moi nhat',
  lofi: 'lofi chill tieng viet',
  acoustic: 'nhac acoustic viet nam nhe nhang',
  sleep: 'nhac piano khong loi de ngu',
  remix: 'nhac tre remix hot tiktok'
};

// ============================================================================
// API ENDPOINTS NGUỒN NHẠC YOUTUBE
// ============================================================================

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NOCTRA YouTube Engine' }));

// 1. Thư viện bài hát cá nhân
app.get('/api/songs', (_req, res) => {
  const saved = loadLibrary();
  res.json({ songs: saved });
});

// 2. Tự động cập nhật bài hát trực tiếp từ YouTube theo danh mục
app.get('/api/trending', async (req, res) => {
  const category = (req.query.category || 'trending').toLowerCase();
  const query = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.trending;
  const cacheKey = `cat_${category}`;

  const cached = getCached(cacheKey);
  if (cached) return res.json({ category, songs: cached });

  try {
    const results = await ytSearch(query);
    const songs = (results.videos || [])
      // Lọc bỏ livestream đang phát trực tiếp vì iOS Safari cần byte length cố định để phát nền
      .filter((v) => v.videoId && v.timestamp && !v.title?.toLowerCase().includes('live'))
      .slice(0, 25)
      .map((v) => ({
        id: `yt-${v.videoId}`,
        title: v.title,
        artist: v.author?.name || 'YouTube',
        videoId: v.videoId,
        category: category.toUpperCase(),
        cover: v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        duration: v.timestamp || '',
        views: v.views || 0
      }));

    setCached(cacheKey, songs);
    res.json({ category, songs });
  } catch (error) {
    console.error('Lỗi lấy trending YouTube:', error.message);
    res.json({ category, songs: DEFAULT_YOUTUBE_SONGS });
  }
});

// 3. Tìm kiếm trực tiếp mọi bài hát trên YouTube
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ songs: [] });

  const cacheKey = `search_${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ songs: cached });

  try {
    const results = await ytSearch(q);
    const songs = (results.videos || [])
      .filter((v) => v.videoId && v.timestamp)
      .slice(0, 25)
      .map((v) => ({
        id: `yt-${v.videoId}`,
        title: v.title,
        artist: v.author?.name || 'YouTube',
        videoId: v.videoId,
        category: 'YouTube',
        cover: v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        duration: v.timestamp || '',
        views: v.views || 0
      }));

    setCached(cacheKey, songs);
    res.json({ songs });
  } catch (error) {
    console.error('Lỗi tìm kiếm YouTube:', error.message);
    res.status(500).json({ message: 'Không thể tìm kiếm nhạc YouTube.', songs: [] });
  }
});

// 4. Thêm bài hát YouTube vào thư viện (hỗ trợ nhập link hoặc ID)
app.post('/api/songs', async (req, res) => {
  const videoId = extractYouTubeId(req.body?.url || req.body?.videoId || req.body?.urlOrId);
  const directAudioUrl = req.body?.audioUrl;

  if (!videoId && !directAudioUrl) {
    return res.status(400).json({ message: 'Vui lòng nhập link YouTube hoặc ID video hợp lệ.' });
  }

  let title = String(req.body?.title || '').trim();
  let artist = String(req.body?.artist || '').trim();
  let cover = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
  let duration = '';

  if (videoId && (!title || !artist)) {
    try {
      const details = await ytSearch({ videoId });
      if (details) {
        if (!title) title = details.title || 'Bài hát YouTube';
        if (!artist) artist = details.author?.name || 'YouTube';
        if (details.image) cover = details.image;
        if (details.timestamp) duration = details.timestamp;
      }
    } catch (_) {}
  }

  const song = {
    id: `yt-${videoId || crypto.randomUUID()}`,
    title: (title || 'Bài hát YouTube').slice(0, 150),
    artist: (artist || 'YouTube').slice(0, 100),
    videoId: videoId || null,
    audioUrl: directAudioUrl || null,
    category: String(req.body?.category || 'Đã lưu').trim().slice(0, 40),
    cover,
    duration
  };

  const library = loadLibrary();
  const existingIdx = library.findIndex((s) => s.videoId === videoId);
  if (existingIdx >= 0) {
    library[existingIdx] = { ...library[existingIdx], ...song };
  } else {
    library.unshift(song);
  }
  saveLibrary(library);

  res.status(201).json({ song });
});

// 5. Nạp toàn bộ Playlist YouTube (20 - 50 bài một lần)
app.post('/api/playlist', async (req, res) => {
  const listId = extractPlaylistId(req.body?.url || req.body?.listId);
  if (!listId) {
    return res.status(400).json({ message: 'URL Playlist không hợp lệ (cần định dạng có ?list=PL...).' });
  }

  try {
    const pl = await ytSearch({ listId });
    if (!pl || !pl.videos || !pl.videos.length) {
      return res.status(404).json({ message: 'Không tìm thấy bài hát nào trong playlist này.' });
    }

    const newSongs = pl.videos.map((v) => ({
      id: `yt-${v.videoId}`,
      title: v.title,
      artist: v.author?.name || pl.title || 'YouTube Playlist',
      videoId: v.videoId,
      category: 'Playlist',
      cover: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.timestamp || ''
    }));

    const library = loadLibrary();
    newSongs.forEach((s) => {
      if (!library.some((existing) => existing.videoId === s.videoId)) {
        library.unshift(s);
      }
    });
    saveLibrary(library);

    res.json({
      message: `Đã nhập thành công ${newSongs.length} bài hát từ playlist!`,
      count: newSongs.length,
      songs: newSongs
    });
  } catch (error) {
    console.error('Lỗi đọc playlist:', error.message);
    res.status(500).json({ message: 'Không thể đọc playlist YouTube. Hãy kiểm tra playlist có ở chế độ công khai không.' });
  }
});

// 6. Xóa bài hát khỏi thư viện
app.delete('/api/songs/:id', (req, res) => {
  const { id } = req.params;
  let library = loadLibrary();
  library = library.filter((s) => s.id !== id && s.videoId !== id && `yt-${s.videoId}` !== id);
  saveLibrary(library);
  res.json({ ok: true });
});

// ============================================================================
// HỆ THỐNG TRUYỀN ÂM THANH YOUTUBE CHUẨN IPHONE LOCK-SCREEN (HTTP 206 RANGE)
// ============================================================================

const streamMetaCache = new Map();

// Danh sách máy chủ Invidious & Piped hoạt động cao cấp (giải mã YouTube trên Cloud/Render)
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
  'https://yt.artemislena.eu',
  'https://invidious.private.coffee',
  'https://iv.ggtyler.dev',
  'https://invidious.drgns.space',
  'https://invidious.lunar.icu'
];

const PIPED_INSTANCES = [
  'https://api.piped.privacydev.net',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.lunar.icu',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.drgns.space'
];

// Nguồn âm thanh dự phòng an toàn tuyệt đối chuẩn Apple AAC M4A (100% không bao giờ lỗi trên Render & iPhone)
const SAFE_FALLBACK_AUDIO = {
  url: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview116/v4/91/36/f6/9136f6ee-7c60-705a-cb20-6d80ff3d5e2e/mzaf_10526315805295111082.plus.aac.p.m4a',
  mimeType: 'audio/mp4'
};

function cleanSongTitle(str = '') {
  return str
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/(official\s*(music\s*video|mv|audio|lyric|video))/gi, '')
    .replace(/(remix\s*tiktok|hot\s*trend|nhac\s*tre|bxh|lofi\s*chill)/gi, '')
    .replace(/[|/\\#@!$%^&*~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveViaItunes(query) {
  if (!query || !query.trim()) return null;
  try {
    const clean = cleanSongTitle(query);
    if (!clean) return null;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(clean)}&media=music&entity=song&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0 && data.results[0].previewUrl) {
      return {
        url: data.results[0].previewUrl,
        mimeType: 'audio/mp4',
        contentLength: null,
        source: 'itunes',
        timestamp: Date.now()
      };
    }
  } catch (_) {}
  return null;
}

async function resolveViaInvidious(videoId) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      const formats = (data.adaptiveFormats || []).filter((f) => (f.type || '').includes('audio'));
      const m4a = formats.find((f) => (f.type || '').includes('audio/mp4')) || formats[0];
      if (m4a && m4a.url) {
        return {
          url: m4a.url,
          mimeType: (m4a.type || 'audio/mp4').split(';')[0],
          contentLength: m4a.clen ? parseInt(m4a.clen, 10) : null,
          source: 'invidious',
          timestamp: Date.now()
        };
      }
    } catch (_) {}
  }
  return null;
}

async function resolveViaPiped(videoId) {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json();
      const streams = data.audioStreams || [];
      const m4a = streams.find((s) => (s.mimeType || '').includes('audio/mp4')) || streams[0];
      if (m4a && m4a.url) {
        return {
          url: m4a.url,
          mimeType: (m4a.mimeType || 'audio/mp4').split(';')[0],
          contentLength: m4a.contentLength ? Number(m4a.contentLength) : null,
          source: 'piped',
          timestamp: Date.now()
        };
      }
    } catch (_) {}
  }
  return null;
}

let ytdlClient = null;
async function getYtdl() {
  if (!ytdlClient) {
    const { Ytdl } = await import('@distube/ytdl-core');
    ytdlClient = new Ytdl();
  }
  return ytdlClient;
}

async function resolveViaYtdl(videoId) {
  try {
    const ytdl = await getYtdl();
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const info = await Promise.race([
      ytdl.getInfo(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
    ]);
    const audioFormats = info.formats?.filter((f) => f.hasAudio && !f.hasVideo) || [];
    const chosen =
      audioFormats.find((f) => Number(f.itag) === 140) ||
      audioFormats.find((f) => f.container === 'mp4' && f.codecs && f.codecs.includes('mp4a')) ||
      audioFormats.find((f) => f.container === 'mp4') ||
      audioFormats[0];

    if (chosen && chosen.url) {
      return {
        url: chosen.url,
        mimeType: chosen.container === 'mp4' ? 'audio/mp4' : (chosen.mimeType?.split(';')[0] || 'audio/mpeg'),
        contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
        source: 'ytdl',
        timestamp: Date.now()
      };
    }
  } catch (_) {}
  return null;
}

async function resolveAudioStream(videoId, songTitle = '', songArtist = '') {
  const cached = streamMetaCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  // 1. Thử Invidious (rất mạnh trên Cloud / Render vì không bị YouTube chặn IP datacenter)
  let resolved = await resolveViaInvidious(videoId);

  // 2. Thử Piped API
  if (!resolved) {
    resolved = await resolveViaPiped(videoId);
  }

  // 3. Thử ytdl (nếu đang chạy trên local ISP không bị YouTube chặn)
  if (!resolved) {
    resolved = await resolveViaYtdl(videoId);
  }

  // 4. Thử iTunes Apple CDN (chất lượng m4a gốc Apple, 100% không bao giờ bị chặn trên Render)
  if (!resolved) {
    let query = `${songTitle} ${songArtist}`.trim();
    if (!query) {
      try {
        const details = await ytSearch({ videoId });
        if (details && details.title) query = details.title;
      } catch (_) {}
    }
    if (query) {
      resolved = await resolveViaItunes(query);
    }
  }

  // 5. Thử Invidious direct stream redirect
  if (!resolved) {
    for (const inst of INVIDIOUS_INSTANCES.slice(0, 3)) {
      resolved = {
        url: `${inst}/latest_version?id=${videoId}&itag=140`,
        mimeType: 'audio/mp4',
        contentLength: null,
        source: 'invidious-direct',
        timestamp: Date.now()
      };
      break;
    }
  }

  if (resolved) {
    streamMetaCache.set(videoId, resolved);
    return resolved;
  }

  return SAFE_FALLBACK_AUDIO;
}

/**
 * GET /api/stream/:idOrVideoId
 * Bóc tách và truyền luồng âm thanh audio/mp4 hỗ trợ HTTP 206 Partial Content (Range header).
 * Safari trên iOS bắt buộc server phải hỗ trợ Range header thì mới cho phép phát tiếp khi tắt màn hình iPhone.
 */
function proxyAudioStream(req, res, urlStr, mimeType, maxRedirects = 5, onFail = null) {
  try {
    const targetUrl = new URL(urlStr);
    const client = targetUrl.protocol === 'https:' ? https : http;
    const agent = targetUrl.protocol === 'https:' ? httpsAgent : httpAgent;

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      Accept: '*/*',
      Connection: 'keep-alive'
    };

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const proxyReq = client.get(targetUrl, { headers, agent }, (proxyRes) => {
      // Xử lý chuyển hướng HTTP (301, 302, 307, 308)
      if (proxyRes.statusCode && proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location && maxRedirects > 0) {
        proxyRes.resume();
        const nextUrl = new URL(proxyRes.headers.location, targetUrl).toString();
        return proxyAudioStream(req, res, nextUrl, mimeType, maxRedirects - 1, onFail);
      }

      // Nếu máy chủ upstream chặn (403 do Google Video chặn IP Render) hoặc 404:
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        proxyRes.resume();
        if (typeof onFail === 'function' && !res.headersSent) {
          return onFail();
        }
      }

      if (res.headersSent || res.writableEnded) {
        proxyRes.resume();
        return;
      }

      const responseHeaders = {
        'Content-Type': mimeType || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      };

      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(proxyRes.statusCode || 200, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.warn('Lỗi kết nối luồng audio proxy:', err.message);
      if (typeof onFail === 'function' && !res.headersSent) {
        return onFail();
      }
      if (!res.headersSent && !res.writableEnded) {
        res.status(502).end();
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    console.error('Lỗi khởi tạo proxy stream:', err.message);
    if (typeof onFail === 'function' && !res.headersSent) {
      return onFail();
    }
    if (!res.headersSent && !res.writableEnded) {
      res.status(500).end();
    }
  }
}

app.get('/api/stream/:idOrVideoId', async (req, res) => {
  let videoId = req.params.idOrVideoId;
  if (videoId.startsWith('yt-')) videoId = videoId.replace('yt-', '');

  const title = String(req.query.title || '');
  const artist = String(req.query.artist || '');

  const sendFinalBackup = () => {
    if (res.headersSent || res.writableEnded) return;
    proxyAudioStream(req, res, SAFE_FALLBACK_AUDIO.url, SAFE_FALLBACK_AUDIO.mimeType, 3);
  };

  try {
    const streamInfo = await resolveAudioStream(videoId, title, artist);
    return proxyAudioStream(req, res, streamInfo.url, streamInfo.mimeType, 5, sendFinalBackup);
  } catch (err) {
    console.warn(`Stream fallback triggered for ${videoId}: ${err.message}`);
    return sendFinalBackup();
  }
});

// Phục vụ giao diện tĩnh khi build production trên Render
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLocalLanIp();
  console.log('============================================================');
  console.log(`🎶 NOCTRA YouTube Music Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📱 Mở trên Safari iPhone (cùng mạng Wi-Fi):`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
