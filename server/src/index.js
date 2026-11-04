const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'library.json');

app.use(cors());
app.use(express.json({ limit: '200kb' }));

// In-memory cache cho categories & search (TTL: 15 phút)
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, { time: Date.now(), data });
}

function loadLibrary() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error('Không đọc được library.json:', e.message);
  }
  return [];
}

function saveLibrary(list) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Không lưu được library.json:', e.message);
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
  trending: 'nhac hot tiktok trending viet nam',
  vpop: 'nhac tre vpop moi nhat',
  lofi: 'lofi chill tieng viet',
  acoustic: 'nhac acoustic viet nam nhe nhang',
  sleep: 'nhac piano khong loi de ngu',
  remix: 'nhac tre remix hot tiktok'
};

// GET /api/health
app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'NOCTRA API' }));

// GET /api/songs: Thư viện bài đã lưu
app.get('/api/songs', (_req, res) => {
  const saved = loadLibrary();
  res.json({ songs: saved });
});

// GET /api/trending?category=...: Tự động cập nhật nhạc theo danh mục từ YouTube
app.get('/api/trending', async (req, res) => {
  const category = (req.query.category || 'trending').toLowerCase();
  const query = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.trending;
  const cacheKey = `cat_${category}`;

  const cached = getCached(cacheKey);
  if (cached) return res.json({ category, songs: cached });

  try {
    const results = await ytSearch(query);
    const songs = (results.videos || []).slice(0, 24).map((v) => ({
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
    res.status(500).json({ message: 'Không thể tải nhạc thịnh hành từ YouTube.', songs: [] });
  }
});

// GET /api/search?q=...: Tìm kiếm mọi bài hát trực tiếp trên YouTube
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ songs: [] });

  const cacheKey = `search_${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ songs: cached });

  try {
    const results = await ytSearch(q);
    const songs = (results.videos || []).slice(0, 25).map((v) => ({
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
    res.status(500).json({ message: 'Không thể tìm kiếm nhạc YouTube.' });
  }
});

// POST /api/songs: Thêm 1 bài hát (tự động nhận diện tiêu đề, nghệ sĩ, ảnh từ YouTube)
app.post('/api/songs', async (req, res) => {
  const videoId = extractYouTubeId(req.body?.url || req.body?.videoId || req.body?.urlOrId);
  const directAudioUrl = req.body?.audioUrl;

  if (!videoId && !directAudioUrl) {
    return res.status(400).json({ message: 'Vui lòng nhập URL YouTube, ID video hoặc link MP3/M4A hợp lệ.' });
  }

  let title = String(req.body?.title || '').trim();
  let artist = String(req.body?.artist || '').trim();
  let cover = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80';
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
    id: crypto.randomUUID(),
    title: (title || 'Bản nhạc tùy chỉnh').slice(0, 150),
    artist: (artist || 'YouTube Audio').slice(0, 100),
    videoId: videoId || null,
    audioUrl: directAudioUrl || null,
    category: String(req.body?.category || 'Đã lưu').trim().slice(0, 40),
    cover,
    duration
  };

  const library = loadLibrary();
  const existingIdx = library.findIndex((s) => (videoId && s.videoId === videoId) || (directAudioUrl && s.audioUrl === directAudioUrl));
  if (existingIdx >= 0) {
    library[existingIdx] = { ...library[existingIdx], ...song };
  } else {
    library.unshift(song);
  }
  saveLibrary(library);

  res.status(201).json({ song });
});

// POST /api/playlist: Quét và nhập toàn bộ Playlist YouTube (20-50 bài một lần)
app.post('/api/playlist', async (req, res) => {
  const listId = extractPlaylistId(req.body?.url || req.body?.listId);
  if (!listId) {
    return res.status(400).json({ message: 'URL Playlist YouTube không hợp lệ (cần định dạng có ?list=PL...).' });
  }

  try {
    const pl = await ytSearch({ listId });
    if (!pl || !pl.videos || !pl.videos.length) {
      return res.status(404).json({ message: 'Không tìm thấy bài hát nào trong playlist này.' });
    }

    const newSongs = pl.videos.map((v) => ({
      id: crypto.randomUUID(),
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

// DELETE /api/songs/:id: Xóa bài khỏi thư viện
app.delete('/api/songs/:id', (req, res) => {
  const { id } = req.params;
  let library = loadLibrary();
  library = library.filter((s) => s.id !== id && s.videoId !== id);
  saveLibrary(library);
  res.json({ ok: true });
});

// Cache luồng âm thanh YouTube để tối ưu phản hồi Range request cho iOS
const streamUrlCache = new Map();

async function resolveAudioStream(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await ytdl.getInfo(url);
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

  const chosen =
    audioFormats.find((f) => f.container === 'mp4' && f.codecs && f.codecs.includes('mp4a')) ||
    audioFormats.find((f) => f.container === 'mp4') ||
    audioFormats[0];

  if (!chosen || !chosen.url) {
    throw new Error('Không tìm thấy luồng âm thanh cho video này.');
  }

  const resolved = {
    url: chosen.url,
    mimeType: chosen.container === 'mp4' ? 'audio/mp4' : (chosen.mimeType?.split(';')[0] || 'audio/mpeg'),
    contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
    timestamp: Date.now()
  };

  streamUrlCache.set(videoId, resolved);
  return resolved;
}

/**
 * GET /api/stream/:videoId
 * Bóc tách và truyền luồng âm thanh audio/mp4 hỗ trợ HTTP 206 Partial Content (Range header).
 * Safari trên iOS bắt buộc server phải hỗ trợ Range header thì mới cho phép phát tiếp khi tắt màn hình iPhone.
 */
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const streamInfo = await resolveAudioStream(videoId);
    const targetUrl = new URL(streamInfo.url);
    const client = targetUrl.protocol === 'https:' ? https : http;

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    };

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const proxyReq = client.get(targetUrl, { headers }, (proxyRes) => {
      const responseHeaders = {
        'Content-Type': streamInfo.mimeType || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
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
      console.error('Lỗi kết nối luồng audio proxy:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Không thể kết nối luồng âm thanh.' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    console.error(`Lỗi tách luồng YouTube (${videoId}):`, err.message);
    res.status(500).json({
      error: 'Không thể tách luồng âm thanh từ video này.'
    });
  }
});

// Phục vụ giao diện tĩnh khi triển khai online trên Render
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`NOCTRA Server (YouTube Live Sync + iOS Background Stream) đang chạy tại http://localhost:${PORT}`);
});
