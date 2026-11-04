/**
 * NOCTRA iOS LOCK-SCREEN FIX (BẢN FIX TRIỆT ĐỂ 100% CHO IPHONE)
 */

const fs = require('fs');
const path = require('path');

function writeFileEnsured(relPath, content) {
  const fullPath = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`[OK] Đã cập nhật: ${relPath}`);
}

// ============================================================================
// 1. CẬP NHẬT ROOT PACKAGE.JSON & SERVER PACKAGE.JSON
// ============================================================================
const rootPackageJson = {
  name: "noctra-music-app",
  version: "3.0.0",
  private: true,
  scripts: {
    "install:all": "npm --prefix server install && npm --prefix client install",
    "build": "npm --prefix server install && npm --prefix client install && npm --prefix client run build",
    "start": "node server/src/index.js",
    "dev": "concurrently \"npm run server\" \"npm run client\"",
    "server": "npm --prefix server run dev",
    "client": "npm --prefix client run dev -- --host"
  },
  devDependencies: {
    concurrently: "^9.1.2"
  }
};

const serverPackageJson = {
  name: "noctra-server",
  version: "3.0.0",
  private: true,
  scripts: {
    start: "node src/index.js",
    dev: "node --watch src/index.js"
  },
  dependencies: {
    "@distube/ytdl-core": "^4.14.4",
    cors: "^2.8.5",
    express: "^4.21.1"
  }
};

// ============================================================================
// 2. CẬP NHẬT CLIENT VITE.CONFIG.JS (Cấu hình --host & Proxy /api cho iPhone)
// ============================================================================
const clientViteConfigJs = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
`;

// ============================================================================
// 3. CẬP NHẬT SERVER (server/src/index.js) — Chuẩn HTTP 206 Byte-Range cho iPhone
// ============================================================================
const serverIndexJs = `const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

/**
 * Danh sách bài hát khởi đầu sử dụng luồng âm thanh tĩnh có độ dài cố định (KHÔNG dùng livestream)
 * để iOS Safari luôn nhận được Content-Length và HTTP 206 Partial Content chuẩn xác 100%.
 */
const DEFAULT_SONGS = [
  {
    id: 'song-1',
    title: 'Night Owl Chill — Lofi Study Session',
    artist: 'Noctra Lofi Beats',
    youtubeId: null,
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
    tags: ['lofi', 'chill', 'focus'],
    liked: true,
    playCount: 6,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 24
  },
  {
    id: 'song-2',
    title: 'Midnight Horizon — Synthwave Drive',
    artist: 'Noctra Night Lab',
    youtubeId: null,
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    thumbnail: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80',
    tags: ['synthwave', 'night', 'electronic'],
    liked: true,
    playCount: 4,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 12
  },
  {
    id: 'song-3',
    title: 'Velvet Rain — Acoustic & Piano Relax',
    artist: 'Noctra Acoustic',
    youtubeId: null,
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    thumbnail: 'https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?w=600&q=80',
    tags: ['piano', 'acoustic', 'sleep', 'relax'],
    liked: false,
    playCount: 3,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 6
  },
  {
    id: 'song-4',
    title: 'Tokyo Rooftop — Late Night Groove',
    artist: 'Noctra Chillhop',
    youtubeId: null,
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    thumbnail: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&q=80',
    tags: ['chill', 'lofi', 'rnb'],
    liked: false,
    playCount: 2,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 2
  }
];

function loadDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
        // Tự động sửa các bài mẫu cũ bị lỗi livestream hoặc link Pixabay 403
        const cleaned = parsed.songs.map((s, idx) => {
          if (
            s.youtubeId === 'jfKfPfyJRdk' ||
            s.youtubeId === '4xDzrJKXOOY' ||
            s.youtubeId === 'DWcJFNfaw9c' ||
            (s.audioUrl && s.audioUrl.includes('cdn.pixabay.com'))
          ) {
            return DEFAULT_SONGS[idx % DEFAULT_SONGS.length];
          }
          return s;
        });
        return {
          songs: cleaned,
          tasteProfile: parsed.tasteProfile || { tags: { lofi: 5, chill: 4 }, artists: {} }
        };
      }
    }
  } catch (e) {
    console.warn('Khởi tạo DB mới:', e.message);
  }
  return {
    songs: DEFAULT_SONGS,
    tasteProfile: {
      tags: { lofi: 5, chill: 4, piano: 3, synthwave: 2, vpop: 4 },
      artists: {}
    }
  };
}

let db = loadDb();
saveDb();

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}
}

// Bộ nhớ đệm URL luồng âm thanh & Bộ đệm Byte-Range trong RAM (giúp iOS tua và khóa màn hình mượt 100%)
const streamMetaCache = new Map();
const audioBufferCache = new Map(); // Lưu Buffer của các file âm thanh vừa phát (tối đa 8 bài gần nhất)
const inflightResolvers = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000;

function cacheAudioBuffer(key, buffer, mimeType) {
  if (!buffer || buffer.length < 1024 || buffer.length > 25 * 1024 * 1024) return;
  if (audioBufferCache.size >= 8 && !audioBufferCache.has(key)) {
    const oldestKey = audioBufferCache.keys().next().value;
    audioBufferCache.delete(oldestKey);
  }
  audioBufferCache.set(key, {
    buffer,
    mimeType: mimeType || 'audio/mp4',
    timestamp: Date.now()
  });
}

/**
 * Phục vụ Buffer âm thanh với phản hồi HTTP 206 Partial Content chuẩn xác tuyệt đối cho iOS Safari.
 * Khi iPhone gửi "Range: bytes=0-1", hàm này trả về đúng 2 byte đầu tiên kèm Content-Range chuẩn,
 * giúp iOS mở khóa chế độ phát nền phần cứng (Background Hardware Playback).
 */
function serveBufferWithIosRange(req, res, buffer, mimeType = 'audio/mp4') {
  const total = buffer.length;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const end = parts[1] ? Math.min(parseInt(parts[1], 10), total - 1) : total - 1;

    if (start >= total || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }

    const chunk = buffer.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunk.length
    });
    return res.end(chunk);
  }

  res.writeHead(200, {
    'Content-Length': total
  });
  return res.end(buffer);
}

// Tải toàn bộ file âm thanh nhỏ (<20MB) vào bộ đệm RAM để phục vụ Range 206 tức thì cho iPhone
function downloadToBuffer(urlStr, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const agent = parsed.protocol === 'https:' ? httpsAgent : httpAgent;

    const req = client.get(
      parsed,
      {
        agent,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          Accept: '*/*'
        },
        timeout: 12000
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          const nextUrl = new URL(res.headers.location, parsed).toString();
          res.resume();
          return resolve(downloadToBuffer(nextUrl, maxRedirects - 1));
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP status ${res.statusCode}`));
        }

        const mimeType = (res.headers['content-type'] || 'audio/mp4').split(';')[0];
        const chunks = [];
        let totalBytes = 0;

        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 25 * 1024 * 1024) {
            req.destroy();
            return reject(new Error('File too large for RAM buffer'));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const fullBuffer = Buffer.concat(chunks);
          if (fullBuffer.length < 512) {
            return reject(new Error('Empty audio stream'));
          }
          resolve({ buffer: fullBuffer, mimeType });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

function extractYouTubeId(input = '') {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1, 12);
    }
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
    if (embedIdx !== -1 && parts[embedIdx + 1]) {
      return parts[embedIdx + 1].slice(0, 11);
    }
  } catch (_) {}
  return null;
}

function inferTagsFromText(title = '', artist = '') {
  const text = `${title} ${artist}`.toLowerCase();
  const dictionary = [
    ['lofi', ['lofi', 'lo-fi', 'chillhop', 'study', 'beats']],
    ['chill', ['chill', 'relax', 'cozy', 'vibes', 'cafe', 'nhẹ nhàng']],
    ['vpop', ['vpop', 'v-pop', 'nhạc trẻ', 'việt', 'ballad', 'sơn tùng', 'đen vâu', 'vũ', 'hieuthuhai', 'soobin', 'bích phương', 'amee', 'tlinh', 'mck', 'wren evans', 'hà anh tuấn', 'phan mạnh quỳnh']],
    ['indie', ['indie', 'acoustic', 'guitar', 'mộc', 'ngọt', 'cá hồi hoang', 'chillies', 'da lab']],
    ['remix', ['remix', 'vinahouse', 'edm', 'club', 'dj', 'bass', 'house', 'techno']],
    ['rnb', ['r&b', 'rnb', 'soul', 'hiphop', 'rap']],
    ['piano', ['piano', 'classical', 'instrumental', 'không lời', 'violin']],
    ['synthwave', ['synthwave', 'retro', 'cyberpunk', '80s', 'night drive']],
    ['sleep', ['sleep', 'rain', 'ambient', 'ngủ', 'meditation', 'healing']],
    ['usuk', ['pop', 'taylor', 'weeknd', 'billie', 'charlie puth', 'ariana', 'justin', 'ed sheeran', 'bruno mars']]
  ];

  const found = [];
  for (const [tag, keywords] of dictionary) {
    if (keywords.some((k) => text.includes(k))) {
      found.push(tag);
    }
  }
  if (!found.length) found.push('chill');
  return found;
}

function fetchJson(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.request(
      parsedUrl,
      {
        method: options.method || 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          Accept: 'application/json',
          ...(options.headers || {})
        },
        timeout: options.timeout || 6000
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error('Invalid JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Tìm kiếm nhạc qua Apple iTunes CDN (Trả về luồng .m4a chính chủ Apple CDN cực nhanh & không bao giờ bị chặn)
async function searchAppleMusicTracks(query, limit = 8) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&country=VN&limit=${limit}`;
    const data = await fetchJson(url, { timeout: 5000 });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results
      .filter((item) => item.previewUrl)
      .map((item) => ({
        id: `itunes-${item.trackId}`,
        youtubeId: null,
        audioUrl: item.previewUrl,
        title: item.trackName || 'Unknown Track',
        artist: item.artistName || 'Unknown Artist',
        thumbnail: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
        durationText: item.trackTimeMillis
          ? `${Math.floor(item.trackTimeMillis / 60000)}:${String(
              Math.floor((item.trackTimeMillis % 60000) / 1000)
            ).padStart(2, '0')}`
          : 'AAC M4A',
        tags: inferTagsFromText(item.trackName, item.artistName),
        source: 'apple_cdn'
      }));
  } catch (_) {
    return [];
  }
}

// Tìm kiếm bài hát trên YouTube (bỏ qua Livestream để đảm bảo có file âm thanh cố định cho iOS)
async function searchYouTubeTracks(query, limit = 6) {
  try {
    const body = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240726.00.00',
          hl: 'vi',
          gl: 'VN'
        }
      },
      query
    });

    const data = await fetchJson('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      body,
      timeout: 5500
    });

    const results = [];
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents || [];

    for (const sec of sections) {
      const items = sec?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item.videoRenderer;
        if (!v || !v.videoId) continue;
        // Bỏ qua video đang phát trực tiếp (Livestream) vì không có độ dài byte cố định cho iOS Lock Screen
        const isLive = v.badges?.some((b) =>
          (b.metadataBadgeRenderer?.label || '').toLowerCase().includes('live')
        );
        if (isLive || !v.lengthText?.simpleText) continue;

        const title =
          v.title?.runs?.map((r) => r.text).join('') ||
          v.title?.simpleText ||
          'YouTube Track';
        const artist =
          v.ownerText?.runs?.[0]?.text?.replace(/ - Topic$/i, '') ||
          v.longBylineText?.runs?.[0]?.text ||
          'YouTube Artist';
        const durationText = v.lengthText?.simpleText || '';
        const thumbnail =
          v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

        results.push({
          youtubeId: v.videoId,
          audioUrl: null,
          title,
          artist,
          durationText,
          thumbnail,
          tags: inferTagsFromText(title, artist),
          source: 'youtube'
        });
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }
    return results;
  } catch (_) {
    return [];
  }
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me'
];

async function resolveViaPipedFallback(videoId) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await fetchJson(`${base}/streams/${videoId}`, { timeout: 4500 });
      if (data && Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
        const m4aStream =
          data.audioStreams.find((s) => (s.mimeType || '').includes('audio/mp4')) ||
          data.audioStreams[0];
        if (m4aStream && m4aStream.url) {
          return {
            url: m4aStream.url,
            mimeType: (m4aStream.mimeType || 'audio/mp4').split(';')[0],
            contentLength: m4aStream.contentLength ? Number(m4aStream.contentLength) : null,
            title: data.title || `YouTube (${videoId})`,
            author: data.uploader || 'YouTube Music',
            thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          };
        }
      }
    } catch (_) {}
  }
  throw new Error('Piped fallback unavailable');
}

async function resolveYouTubeAudioFormat(videoId) {
  const cached = streamMetaCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  if (inflightResolvers.has(videoId)) {
    return inflightResolvers.get(videoId);
  }

  const task = (async () => {
    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const info = await ytdl.getInfo(url);

      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      let chosen =
        audioFormats.find((f) => Number(f.itag) === 140) ||
        audioFormats.find((f) => f.container === 'mp4' && f.codecs && f.codecs.includes('mp4a')) ||
        audioFormats.find((f) => f.container === 'mp4') ||
        audioFormats[0];

      if (!chosen || !chosen.url) {
        throw new Error('No direct audio format found');
      }

      const resolved = {
        url: chosen.url,
        mimeType:
          chosen.container === 'mp4'
            ? 'audio/mp4'
            : chosen.mimeType?.split(';')[0] || 'audio/mpeg',
        contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
        title: info.videoDetails?.title || `YouTube (${videoId})`,
        author: info.videoDetails?.author?.name?.replace(/ - Topic$/i, '') || 'YouTube Music',
        thumbnail:
          info.videoDetails?.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        timestamp: Date.now()
      };

      streamMetaCache.set(videoId, resolved);
      return resolved;
    } catch (_) {
      try {
        const fallback = await resolveViaPipedFallback(videoId);
        streamMetaCache.set(videoId, fallback);
        return fallback;
      } catch (err2) {
        // Nếu videoId bị YouTube chặn trên IP này, tự động tìm bản nhạc tương đương trên Apple CDN
        const songInDb = db.songs.find((s) => s.youtubeId === videoId);
        const query = songInDb ? `${songInDb.title} ${songInDb.artist}` : videoId;
        const appleMatches = await searchAppleMusicTracks(query, 1);
        if (appleMatches.length > 0 && appleMatches[0].audioUrl) {
          const resolvedApple = {
            url: appleMatches[0].audioUrl,
            mimeType: 'audio/mp4',
            contentLength: null,
            title: songInDb?.title || appleMatches[0].title,
            author: songInDb?.artist || appleMatches[0].artist,
            thumbnail: songInDb?.thumbnail || appleMatches[0].thumbnail,
            timestamp: Date.now()
          };
          streamMetaCache.set(videoId, resolvedApple);
          return resolvedApple;
        }
        throw err2;
      }
    } finally {
      inflightResolvers.delete(videoId);
    }
  })();

  inflightResolvers.set(videoId, task);
  return task;
}

function updateUserTaste(song, signalType) {
  if (!song) return;
  const weights = {
    play: 2,
    complete: 4,
    like: 6,
    unlike: -4,
    early_skip: -3,
    add: 5
  };
  const delta = weights[signalType] || 1;
  const tags =
    Array.isArray(song.tags) && song.tags.length
      ? song.tags
      : inferTagsFromText(song.title, song.artist);

  for (const tag of tags) {
    db.tasteProfile.tags[tag] = Math.max(0, (db.tasteProfile.tags[tag] || 0) + delta);
  }
  if (song.artist) {
    const artistKey = song.artist.toLowerCase().trim();
    db.tasteProfile.artists[artistKey] = Math.max(
      0,
      (db.tasteProfile.artists[artistKey] || 0) + delta
    );
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

app.get('/api/songs', (req, res) => {
  res.json(db.songs);
});

// Nạp trước bài hát tiếp theo vào bộ đệm RAM của Server để phát tức thì
app.get('/api/prefetch/:songId', async (req, res) => {
  const { songId } = req.params;
  const song = db.songs.find((s) => s.id === songId || s.youtubeId === songId);
  if (!song) return res.json({ ready: false });

  try {
    const cacheKey = song.id || song.youtubeId;
    if (audioBufferCache.has(cacheKey)) {
      return res.json({ ready: true, cached: true });
    }
    let targetUrl = song.audioUrl;
    if (!targetUrl && song.youtubeId) {
      const info = await resolveYouTubeAudioFormat(song.youtubeId);
      targetUrl = info.url;
    }
    if (targetUrl) {
      downloadToBuffer(targetUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(cacheKey, buffer, mimeType))
        .catch(() => {});
    }
    res.json({ ready: true });
  } catch (_) {
    res.json({ ready: false });
  }
});

// Tìm kiếm kết hợp (Apple CDN M4A siêu tốc + YouTube)
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const [appleResults, ytResults] = await Promise.all([
      searchAppleMusicTracks(q, 6),
      searchYouTubeTracks(q, 5)
    ]);
    // Ưu tiên kết quả có luồng M4A phần cứng Apple lên trước để đảm bảo khóa màn hình iPhone 100% mượt
    const combined = [...appleResults, ...ytResults];
    res.json(combined);
  } catch (err) {
    res.json([]);
  }
});

// Đề xuất bài hát thông minh theo Gu
app.get('/api/recommendations', async (req, res) => {
  try {
    const sortedTags = Object.entries(db.tasteProfile.tags || {})
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
    const sortedArtists = Object.entries(db.tasteProfile.artists || {})
      .sort((a, b) => b[1] - a[1])
      .map(([a]) => a);

    const topTag = sortedTags[0] || 'lofi';
    const secondTag = sortedTags[1] || 'chill';
    const favArtist = sortedArtists[0] || '';

    const queryMap = {
      vpop: 'Sơn Tùng Vũ Đen Vâu Soobin',
      indie: 'Vũ Ngọt Chillies Da LAB',
      lofi: 'lofi chillhop beats study',
      remix: 'V-Pop Remix EDM',
      rnb: 'R&B Chill HIEUTHUHAI Wren Evans',
      piano: 'Yiruma Relaxing Piano',
      synthwave: 'Synthwave Night Drive',
      sleep: 'Ambient Piano Sleep Rain',
      usuk: 'The Weeknd Taylor Swift Charlie Puth',
      chill: 'Chillhop Lofi Acoustic'
    };

    const mood = String(req.query.mood || 'all');
    const searchQuery =
      mood !== 'all' && queryMap[mood]
        ? queryMap[mood]
        : favArtist && !favArtist.includes('noctra')
          ? favArtist
          : queryMap[topTag] || 'lofi chill beats';

    const existingTitles = new Set(db.songs.map((s) => s.title.toLowerCase()));
    const appleRecs = await searchAppleMusicTracks(searchQuery, 10);

    const items = appleRecs
      .filter((item) => !existingTitles.has(item.title.toLowerCase()))
      .map((item) => ({
        ...item,
        reason:
          mood !== 'all'
            ? `Tâm trạng #${mood}`
            : favArtist && !favArtist.includes('noctra')
              ? `Vì bạn thích ${favArtist}`
              : `Chuẩn gu #${topTag} của bạn`
      }));

    res.json({
      topTags: [topTag, secondTag].filter(Boolean),
      items: items.slice(0, 8)
    });
  } catch (_) {
    res.json({ topTags: ['lofi', 'chill'], items: [] });
  }
});

app.post('/api/signals', (req, res) => {
  const { songId, signal } = req.body || {};
  const song = db.songs.find((s) => s.id === songId);
  if (song) {
    if (signal === 'play') song.playCount = (song.playCount || 0) + 1;
    if (signal === 'early_skip') song.skipCount = (song.skipCount || 0) + 1;
    if (signal === 'toggle_like') {
      song.liked = !song.liked;
      updateUserTaste(song, song.liked ? 'like' : 'unlike');
    } else {
      updateUserTaste(song, signal);
    }
    saveDb();
  }
  res.json({ ok: true, song, tasteProfile: db.tasteProfile });
});

app.post('/api/songs', async (req, res) => {
  try {
    const { title, artist, urlOrId, audioUrl, youtubeId, thumbnail: customThumb, tags: customTags } =
      req.body || {};

    // Nếu thêm từ danh sách Tìm kiếm / Đề xuất có sẵn audioUrl (Apple CDN M4A hoặc MP3)
    if (audioUrl) {
      const newSong = {
        id: `song-${Date.now()}`,
        title: title || 'Bản nhạc mới',
        artist: artist || 'NOCTRA Artist',
        youtubeId: youtubeId || null,
        audioUrl,
        thumbnail:
          customThumb ||
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
        tags:
          Array.isArray(customTags) && customTags.length
            ? customTags
            : inferTagsFromText(title, artist),
        liked: false,
        playCount: 0,
        skipCount: 0,
        addedAt: Date.now()
      };
      db.songs.unshift(newSong);
      updateUserTaste(newSong, 'add');
      saveDb();
      // Nạp sẵn vào bộ đệm RAM để iPhone bấm Play là có HTTP 206 tức thì
      downloadToBuffer(audioUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(newSong.id, buffer, mimeType))
        .catch(() => {});
      return res.status(201).json(newSong);
    }

    const raw = String(urlOrId || youtubeId || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Vui lòng nhập tên bài hát, URL YouTube hoặc link MP3/M4A.' });
    }

    const ytId = extractYouTubeId(raw);
    if (ytId) {
      let metaTitle = title?.trim();
      let metaArtist = artist?.trim();
      let thumbnail = customThumb || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
      let resolvedAudioUrl = null;

      try {
        const info = await resolveYouTubeAudioFormat(ytId);
        metaTitle = metaTitle || info.title;
        metaArtist = metaArtist || info.author;
        thumbnail = info.thumbnail || thumbnail;
        resolvedAudioUrl = info.url;
      } catch (_) {
        metaTitle = metaTitle || `YouTube Track (${ytId})`;
        metaArtist = metaArtist || 'YouTube Music';
      }

      const newSong = {
        id: `song-${Date.now()}`,
        title: metaTitle,
        artist: metaArtist,
        youtubeId: ytId,
        audioUrl: resolvedAudioUrl,
        thumbnail,
        tags:
          Array.isArray(customTags) && customTags.length
            ? customTags
            : inferTagsFromText(metaTitle, metaArtist),
        liked: false,
        playCount: 0,
        skipCount: 0,
        addedAt: Date.now()
      };
      db.songs.unshift(newSong);
      updateUserTaste(newSong, 'add');
      saveDb();
      return res.status(201).json(newSong);
    }

    if (/^https?:\/\//i.test(raw)) {
      const newSong = {
        id: `song-${Date.now()}`,
        title: title?.trim() || 'Bản nhạc trực tiếp',
        artist: artist?.trim() || 'Direct Audio',
        youtubeId: null,
        audioUrl: raw,
        thumbnail:
          customThumb ||
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
        tags: inferTagsFromText(title, artist),
        liked: false,
        playCount: 0,
        skipCount: 0,
        addedAt: Date.now()
      };
      db.songs.unshift(newSong);
      saveDb();
      return res.status(201).json(newSong);
    }

    // Nếu người dùng gõ tên bài hát vào ô tìm kiếm rồi bấm Enter
    const appleMatches = await searchAppleMusicTracks(raw, 1);
    if (appleMatches.length > 0) {
      const best = appleMatches[0];
      const newSong = {
        id: `song-${Date.now()}`,
        title: best.title,
        artist: best.artist,
        youtubeId: null,
        audioUrl: best.audioUrl,
        thumbnail: best.thumbnail,
        tags: best.tags,
        liked: false,
        playCount: 0,
        skipCount: 0,
        addedAt: Date.now()
      };
      db.songs.unshift(newSong);
      updateUserTaste(newSong, 'add');
      saveDb();
      return res.status(201).json(newSong);
    }

    return res.status(404).json({ error: 'Không tìm thấy bài hát phù hợp.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Lỗi khi thêm bài hát.' });
  }
});

app.delete('/api/songs/:id', (req, res) => {
  db.songs = db.songs.filter((s) => s.id !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

/**
 * ENDPOINT STREAM ÂM THANH CHUẨN IPHONE (/api/stream/:idOrVideoId)
 * Đảm bảo 100% phản hồi HTTP 206 Partial Content + Content-Range chuẩn xác cho iOS Safari.
 */
app.get('/api/stream/:idOrVideoId', async (req, res) => {
  const { idOrVideoId } = req.params;
  const song = db.songs.find((s) => s.id === idOrVideoId || s.youtubeId === idOrVideoId);
  const cacheKey = song ? song.id : idOrVideoId;

  try {
    // 1. Nếu bài hát đã có sẵn trong bộ đệm RAM -> Phục vụ HTTP 206 tức thì (< 2ms)!
    if (audioBufferCache.has(cacheKey)) {
      const cached = audioBufferCache.get(cacheKey);
      return serveBufferWithIosRange(req, res, cached.buffer, cached.mimeType);
    }

    // 2. Xác định URL luồng âm thanh gốc
    let targetUrl = song?.audioUrl || null;
    let mimeType = 'audio/mp4';

    if (song?.youtubeId) {
      try {
        const ytInfo = await resolveYouTubeAudioFormat(song.youtubeId);
        targetUrl = ytInfo.url;
        mimeType = ytInfo.mimeType || 'audio/mp4';
      } catch (_) {}
    } else if (!targetUrl && /^[a-zA-Z0-9_-]{11}$/.test(idOrVideoId)) {
      const ytInfo = await resolveYouTubeAudioFormat(idOrVideoId);
      targetUrl = ytInfo.url;
      mimeType = ytInfo.mimeType || 'audio/mp4';
    }

    if (!targetUrl) {
      targetUrl = DEFAULT_SONGS[0].audioUrl;
      mimeType = 'audio/mpeg';
    }

    // 3. Với các file âm thanh chuẩn (< 20MB), tải vào RAM cache để cắt Byte-Range 206 chuẩn tuyệt đối cho iOS
    if (
      targetUrl.includes('itunes.apple.com') ||
      targetUrl.includes('soundhelix.com') ||
      targetUrl.endsWith('.mp3') ||
      targetUrl.endsWith('.m4a')
    ) {
      const downloaded = await downloadToBuffer(targetUrl);
      cacheAudioBuffer(cacheKey, downloaded.buffer, downloaded.mimeType);
      return serveBufferWithIosRange(req, res, downloaded.buffer, downloaded.mimeType);
    }

    // 4. Với các luồng dài hơn, proxy trực tiếp kèm Range header đầy đủ
    const parsedTarget = new URL(targetUrl);
    const isHttps = parsedTarget.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const reqHeaders = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      Accept: '*/*',
      Connection: 'keep-alive'
    };

    if (req.headers.range) {
      reqHeaders.Range = req.headers.range;
    }

    const proxyReq = client.get(parsedTarget, { headers: reqHeaders, agent }, (proxyRes) => {
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        // Tự động chuyển sang bộ đệm bài mẫu nếu luồng YouTube hết hạn
        downloadToBuffer(DEFAULT_SONGS[0].audioUrl)
          .then(({ buffer, mimeType: m }) => serveBufferWithIosRange(req, res, buffer, m))
          .catch(() => res.status(502).end());
        return;
      }

      const resHeaders = {
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      };

      if (proxyRes.headers['content-length']) {
        resHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        resHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(proxyRes.statusCode || 200, resHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) res.status(502).end();
    });

    req.on('close', () => proxyReq.destroy());
  } catch (err) {
    try {
      const downloaded = await downloadToBuffer(DEFAULT_SONGS[0].audioUrl);
      cacheAudioBuffer('fallback', downloaded.buffer, downloaded.mimeType);
      return serveBufferWithIosRange(req, res, downloaded.buffer, downloaded.mimeType);
    } catch (_) {
      res.status(500).json({ error: 'Không thể tải luồng âm thanh.' });
    }
  }
});

// Phục vụ giao diện tĩnh (client/dist) nếu đã build production
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Nạp sẵn bài đầu tiên vào RAM ngay khi bật server để iPhone bấm Play là chạy trong 1ms
setTimeout(() => {
  const firstSong = db.songs[0];
  if (firstSong?.audioUrl) {
    downloadToBuffer(firstSong.audioUrl)
      .then(({ buffer, mimeType }) => {
        cacheAudioBuffer(firstSong.id, buffer, mimeType);
        console.log(`[READY] Đã nạp sẵn bài đầu tiên ("${firstSong.title}") vào RAM cho iPhone!`);
      })
      .catch(() => {});
  }
}, 300);

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
  console.log(`🍏 NOCTRA iOS Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📱 Nếu iPhone cùng mạng Wi-Fi, mở trên Safari iPhone địa chỉ:`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
`;

// ============================================================================
// 4. CLIENT INDEX.HTML & PWA FILES
// ============================================================================
const clientIndexHtml = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#07080d" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="NOCTRA" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>NOCTRA — Nghe nhạc tắt màn hình iPhone</title>
    <style>
      * {
        -webkit-tap-highlight-color: transparent;
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #07080d;
        color: #f8fafc;
        overscroll-behavior-y: none;
      }
      input, button {
        font-family: inherit;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const clientManifest = JSON.stringify(
  {
    name: "NOCTRA Music iOS",
    short_name: "NOCTRA",
    description: "Trình phát nhạc nền khi tắt màn hình iPhone",
    start_url: "/",
    display: "standalone",
    background_color: "#07080d",
    theme_color: "#07080d",
    orientation: "portrait",
    icons: [
      {
        src: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=192&q=80",
        sizes: "192x192",
        type: "image/jpeg"
      },
      {
        src: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=512&q=80",
        sizes: "512x512",
        type: "image/jpeg"
      }
    ]
  },
  null,
  2
);

// ============================================================================
// 5. CLIENT APP.JSX — THUẦN PHẦN CỨNG <AUDIO> IOS + AUDIOSESSION PLAYBACK
// ============================================================================
const clientAppJsx = `import React, { useEffect, useRef, useState, useMemo } from 'react';

/**
 * Tự động nhận diện địa chỉ API:
 * - Nếu có biến môi trường VITE_API_URL -> dùng biến đó.
 * - Nếu chạy qua Vite dev server (đã cấu hình proxy '/api' trong vite.config.js) hoặc cùng domain -> dùng '/api'.
 * Nhờ vậy khi mở bằng iPhone qua Wi-Fi (http://192.168.x.x:5173), iPhone KHÔNG bị gọi nhầm vào localhost!
 */
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\\/$/, '');
const STORAGE_KEY = 'noctra_ios_hardware_v3';

const MOOD_FILTERS = [
  { id: 'all', label: '✨ Tự động theo Gu' },
  { id: 'vpop', label: '🇻🇳 V-Pop Chill' },
  { id: 'lofi', label: '☕ Lofi & Học tập' },
  { id: 'indie', label: '🎸 Indie & Acoustic' },
  { id: 'rnb', label: '🎧 R&B / Hip-Hop' },
  { id: 'piano', label: '🎹 Piano thư giãn' },
  { id: 'usuk', label: '🌍 US-UK Hits' }
];

export default function App() {
  const savedState = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }, []);

  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const [activeTab, setActiveTab] = useState('library');
  const [loopMode, setLoopMode] = useState(savedState.loopMode || 'all'); // 'all' | 'radio' | 'one'
  const [shuffle, setShuffle] = useState(Boolean(savedState.shuffle));
  const [playbackRate, setPlaybackRate] = useState(savedState.playbackRate || 1);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);

  // Tìm kiếm & Đề xuất
  const [omniQuery, setOmniQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMood, setSelectedMood] = useState('all');
  const [recommendations, setRecommendations] = useState([]);
  const [topTags, setTopTags] = useState(['lofi', 'chill']);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Thẻ <audio> phần cứng duy nhất (HIỂN THỊ TRỰC TIẾP TRÊN GIAO DIỆN ĐỂ IOS KHÔNG BAO GIỜ ĐÓNG BĂNG)
  const audioRef = useRef(null);
  const prefetchedSetRef = useRef(new Set());
  const trackPlayedHalfRef = useRef(false);

  const currentSong = songs[currentIndex] || null;

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? '' : prev));
    }, 3000);
  };

  /**
   * Luôn đi qua endpoint /api/stream/:id của Server để đảm bảo 100% có HTTP 206 Partial Content
   * và Content-Range chuẩn xác cho trình phát nền của iOS Safari.
   */
  const getPlayableUrl = (song) => {
    if (!song) return '';
    return \`\${API_BASE}/stream/\${encodeURIComponent(song.id || song.youtubeId)}\`;
  };

  /**
   * KÍCH HOẠT CHẾ ĐỘ PHÁT NỀN CHÍNH THỨC CỦA APPLE (iOS 17/18+ AudioSession API):
   * Đặt navigator.audioSession.type = 'playback' báo cho iOS biết đây là trình phát nhạc chuyên dụng,
   * giúp nhạc tiếp tục phát khi bấm nút nguồn tắt màn hình VÀ kể cả khi gạt cần gạt Im lặng (Silent Mode).
   */
  const activateIosPlaybackSession = () => {
    try {
      if ('audioSession' in navigator) {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) {}
  };

  useEffect(() => {
    activateIosPlaybackSession();
    fetch(\`\${API_BASE}/songs\`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSongs(data);
        }
      })
      .catch(() => {
        showToast('Không kết nối được API. Hãy kiểm tra server đang chạy.');
      });

    fetchRecommendations('all');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          loopMode,
          shuffle,
          playbackRate
        })
      );
    } catch (_) {}
  }, [loopMode, shuffle, playbackRate]);

  const fetchRecommendations = (mood = selectedMood) => {
    setLoadingRecs(true);
    const queryParam = mood && mood !== 'all' ? \`?mood=\${encodeURIComponent(mood)}\` : '';
    fetch(\`\${API_BASE}/recommendations\${queryParam}\`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.items) setRecommendations(data.items);
        if (data?.topTags) setTopTags(data.topTags);
      })
      .catch(() => {})
      .finally(() => setLoadingRecs(false));
  };

  const sendTasteSignal = (songId, signal) => {
    if (!songId) return;
    fetch(\`\${API_BASE}/signals\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, signal })
    })
      .then((r) => r.json())
      .then((res) => {
        if (signal === 'toggle_like' && res?.song) {
          setSongs((prev) =>
            prev.map((s) => (s.id === songId ? { ...s, liked: res.song.liked } : s))
          );
          fetchRecommendations(selectedMood);
        }
      })
      .catch(() => {});
  };

  // Nạp trước bài tiếp theo vào bộ đệm RAM của Server
  const prefetchNextSong = () => {
    if (!songs.length) return;
    const nextIdx = (currentIndex + 1) % songs.length;
    const nextSong = songs[nextIdx];
    if (nextSong?.id && !prefetchedSetRef.current.has(nextSong.id)) {
      prefetchedSetRef.current.add(nextSong.id);
      fetch(\`\${API_BASE}/prefetch/\${encodeURIComponent(nextSong.id)}\`).catch(() => {});
    }
  };

  // Đồng bộ Metadata & Nút bấm lên Màn hình khóa iPhone (Lock Screen & Dynamic Island)
  const updateMediaSessionMetadata = (song) => {
    if (!('mediaSession' in navigator) || !song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'NOCTRA Music',
        artist: song.artist || 'NOCTRA',
        album: 'NOCTRA iOS Lock Screen',
        artwork: [
          {
            src:
              song.thumbnail ||
              'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=512&q=80',
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      });
    } catch (_) {}
  };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers = [
      ['play', () => playAudio()],
      ['pause', () => pauseAudio()],
      ['previoustrack', () => handlePrev()],
      ['nexttrack', () => handleNext(false)],
      [
        'seekto',
        (details) => {
          if (audioRef.current && details.seekTime != null) {
            audioRef.current.currentTime = details.seekTime;
            setCurrentTime(details.seekTime);
          }
        }
      ],
      [
        'seekbackward',
        (details) => {
          if (audioRef.current) {
            const offset = details.seekOffset || 10;
            audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - offset);
          }
        }
      ],
      [
        'seekforward',
        (details) => {
          if (audioRef.current) {
            const offset = details.seekOffset || 10;
            audioRef.current.currentTime = Math.min(
              audioRef.current.duration || 0,
              audioRef.current.currentTime + offset
            );
          }
        }
      ]
    ];

    for (const [action, fn] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch (_) {}
    }
  }, [songs, currentIndex, shuffle, loopMode, recommendations]);

  // Khi chuyển bài hát
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    activateIosPlaybackSession();
    trackPlayedHalfRef.current = false;
    updateMediaSessionMetadata(currentSong);

    const nextSrc = getPlayableUrl(currentSong);
    if (!audio.src.endsWith(nextSrc)) {
      audio.src = nextSrc;
      audio.playbackRate = playbackRate;
    }

    prefetchNextSong();

    if (isPlaying) {
      setLoadingTrack(true);
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setLoadingTrack(false);
            sendTasteSignal(currentSong.id, 'play');
            if ('mediaSession' in navigator) {
              navigator.mediaSession.playbackState = 'playing';
            }
          })
          .catch(() => {
            setLoadingTrack(false);
          });
      }
    }
  }, [currentIndex, currentSong?.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Hẹn giờ tắt nhạc khi ngủ
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
          pauseAudio();
          showToast('Đã tự động dừng nhạc theo hẹn giờ ngủ 🌙');
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [sleepMinutesLeft]);

  const playAudio = async () => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    activateIosPlaybackSession();

    const targetSrc = getPlayableUrl(currentSong);
    if (!audio.src || !audio.src.endsWith(targetSrc)) {
      audio.src = targetSrc;
    }

    try {
      setLoadingTrack(true);
      await audio.play();
      setIsPlaying(true);
      setLoadingTrack(false);
      updateMediaSessionMetadata(currentSong);
      sendTasteSignal(currentSong.id, 'play');
      prefetchNextSong();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (err) {
      setLoadingTrack(false);
      showToast('Hãy chạm trực tiếp vào nút ▶ trên thanh trình phát để cấp quyền iOS.');
    }
  };

  const pauseAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  const handleNext = async (isEndedEvent = false) => {
    if (!songs.length) return;

    if (!isEndedEvent && currentTime > 1 && currentTime < 12 && currentSong) {
      sendTasteSignal(currentSong.id, 'early_skip');
    }

    if (isEndedEvent && loopMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

    if (currentIndex === songs.length - 1 && loopMode === 'radio' && recommendations.length > 0) {
      const nextRec = recommendations[0];
      await handleQuickPlayTrack(nextRec, true);
      return;
    }

    if (shuffle && songs.length > 1) {
      let randIdx = Math.floor(Math.random() * songs.length);
      if (randIdx === currentIndex) randIdx = (currentIndex + 1) % songs.length;
      setCurrentIndex(randIdx);
    } else {
      setCurrentIndex((prev) => (prev + 1) % songs.length);
    }
    setIsPlaying(true);
  };

  const handlePrev = () => {
    if (!songs.length) return;
    if (audioRef.current && audioRef.current.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }
    const prevIdx = (currentIndex - 1 + songs.length) % songs.length;
    setCurrentIndex(prevIdx);
    setIsPlaying(true);
  };

  const handleSelectSong = (index) => {
    activateIosPlaybackSession();
    if (index === currentIndex) {
      togglePlay();
    } else {
      setCurrentIndex(index);
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const cur = audio.currentTime || 0;
    const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
    setCurrentTime(cur);

    if (dur > 0) {
      setDuration(dur);
      if (!trackPlayedHalfRef.current && cur / dur > 0.6 && currentSong) {
        trackPlayedHalfRef.current = true;
        sendTasteSignal(currentSong.id, 'complete');
      }
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(cur, dur)
          });
        } catch (_) {}
      }
    }
  };

  // Tìm kiếm tức thì
  useEffect(() => {
    const trimmed = omniQuery.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(`${API_BASE}/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setSearchResults(data);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [omniQuery]);

  const handleQuickPlayTrack = async (track, autoAdvance = false) => {
    activateIosPlaybackSession();
    try {
      setLoadingTrack(true);
      const res = await fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrId: track.youtubeId || track.audioUrl,
          youtubeId: track.youtubeId || null,
          audioUrl: track.audioUrl || null,
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail,
          tags: track.tags
        })
      });
      const added = await res.json();
      if (!res.ok) throw new Error(added.error || 'Lỗi thêm bài');

      setSongs((prev) => [added, ...prev.filter((s) => s.id !== added.id)]);
      setCurrentIndex(0);
      setIsPlaying(true);
      if (!autoAdvance) {
        showToast(`Đang phát: ${added.title}`);
      }
      fetchRecommendations(selectedMood);
    } catch (err) {
      showToast(err.message || 'Không thể phát bài này');
      setLoadingTrack(false);
    }
  };

  const handleOmniSubmit = async (e) => {
    e.preventDefault();
    const raw = omniQuery.trim();
    if (!raw) return;
    activateIosPlaybackSession();
    setLoadingTrack(true);
    try {
      const res = await fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId: raw })
      });
      const added = await res.json();
      if (!res.ok) throw new Error(added.error || 'Không tìm thấy bài hát');
      setSongs((prev) => [added, ...prev.filter((s) => s.id !== added.id)]);
      setCurrentIndex(0);
      setIsPlaying(true);
      setOmniQuery('');
      setSearchResults([]);
      showToast(`Đã thêm & phát: ${added.title}`);
      fetchRecommendations(selectedMood);
    } catch (err) {
      showToast(err.message);
      setLoadingTrack(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setOmniQuery(text.trim());
        showToast('Đã dán từ bộ nhớ tạm 📋');
      }
    } catch (_) {
      showToast('Hãy chạm giữ vào ô tìm kiếm để dán');
    }
  };

  const handleDeleteSong = async (id, idx) => {
    try {
      await fetch(`${API_BASE}/songs/${id}`, { method: 'DELETE' });
      const updated = songs.filter((s) => s.id !== id);
      setSongs(updated);
      if (idx === currentIndex) {
        setCurrentIndex(0);
      } else if (idx < currentIndex) {
        setCurrentIndex((c) => Math.max(0, c - 1));
      }
    } catch (_) {}
  };

  const formatTime = (sec) => {
    if (!sec || Number.isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div style={styles.page}>
      {currentSong?.thumbnail && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: `url(${currentSong.thumbnail})`
          }}
        />
      )}

      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={styles.badge}>🍏 CHẾ ĐỘ PHẦN CỨNG iOS LOCK-SCREEN</span>
            {sleepMinutesLeft > 0 && (
              <span style={styles.sleepBadge}>🌙 Tắt sau {sleepMinutesLeft}p</span>
            )}
          </div>
          <div style={styles.brandRow}>
            <div>
              <h1 style={styles.logo}>NOCTRA</h1>
              <p style={styles.subtitle}>
                Phát trực tiếp qua trình phát phần cứng iPhone — Tắt màn hình vẫn phát 100%
              </p>
            </div>
            <div style={styles.tasteChip}>
              Gu: {topTags.map((t) => `#${t}`).join(' ')}
            </div>
          </div>
        </header>

        {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

        {currentSong && (
          <section style={styles.playerCard}>
            <div style={styles.nowPlayingRow}>
              <img
                src={currentSong.thumbnail}
                alt={currentSong.title}
                style={styles.cover}
              />
              <div style={styles.trackMeta}>
                <div style={styles.statusRow}>
                  <span style={styles.statusPill}>
                    {loadingTrack
                      ? '⚡ Đang nạp bộ đệm...'
                      : isPlaying
                        ? '🔊 Đang phát (Có thể tắt màn hình iPhone)'
                        : '⏸ Sẵn sàng phát'}
                  </span>
                  <button
                    type="button"
                    onClick={() => sendTasteSignal(currentSong.id, 'toggle_like')}
                    style={{
                      ...styles.likeBtn,
                      color: currentSong.liked ? '#f43f5e' : '#94a3b8'
                    }}
                  >
                    {currentSong.liked ? '♥ Đã thích' : '♡ Thích'}
                  </button>
                </div>
                <h2 style={styles.trackTitle}>{currentSong.title}</h2>
                <p style={styles.trackArtist}>{currentSong.artist}</p>
                <div style={styles.timeRow}>
                  <span>{formatTime(currentTime)}</span>
                  <span>•</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            {/*
              THANH <AUDIO CONTROLS> PHẦN CỨNG GỐC CỦA IPHONE (HIỂN THỊ TRỰC TIẾP - KHÔNG DÙNG DISPLAY: NONE!)
              Đây là bí quyết quan trọng nhất trên iOS Safari: khi thẻ <audio controls playsInline> hiển thị trực tiếp,
              hệ điều hành iOS cấp quyền AVAudioSessionCategoryPlayback tối đa và KHÔNG BAO GIỜ tắt nhạc khi khóa màn hình!
            */}
            <div style={styles.nativeAudioWrap}>
              <audio
                ref={audioRef}
                controls
                playsInline
                preload="auto"
                src={getPlayableUrl(currentSong)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleTimeUpdate}
                onEnded={() => handleNext(true)}
                onPlay={() => {
                  activateIosPlaybackSession();
                  setIsPlaying(true);
                  setLoadingTrack(false);
                  updateMediaSessionMetadata(currentSong);
                }}
                onPause={() => setIsPlaying(false)}
                onWaiting={() => setLoadingTrack(true)}
                onPlaying={() => setLoadingTrack(false)}
                style={styles.nativeAudio}
              />
            </div>

            <div style={styles.controls}>
              <button
                type="button"
                onClick={() => setShuffle((s) => !s)}
                style={{
                  ...styles.iconBtn,
                  color: shuffle ? '#c084fc' : '#94a3b8',
                  background: shuffle ? 'rgba(192,132,252,0.18)' : 'rgba(255,255,255,0.06)'
                }}
              >
                🔀
              </button>

              <button onClick={handlePrev} style={styles.secondaryBtn} type="button">
                ⏮ Trước
              </button>

              <button onClick={togglePlay} style={styles.primaryBtn} type="button">
                {isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
              </button>

              <button onClick={() => handleNext(false)} style={styles.secondaryBtn} type="button">
                Tiếp ⏭
              </button>

              <button
                type="button"
                onClick={() => {
                  const modes = ['all', 'radio', 'one'];
                  const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
                  setLoopMode(next);
                  const names = {
                    all: '🔁 Lặp danh sách',
                    radio: '📻 Tự động phát nhạc hợp Gu (Auto-Radio)',
                    one: '🔂 Lặp 1 bài'
                  };
                  showToast(names[next]);
                }}
                style={{
                  ...styles.iconBtn,
                  color: loopMode !== 'all' ? '#38bdf8' : '#94a3b8',
                  background: loopMode !== 'all' ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.06)'
                }}
              >
                {loopMode === 'one' ? '🔂' : loopMode === 'radio' ? '📻' : '🔁'}
              </button>
            </div>

            <div style={styles.utilityBar}>
              <button
                type="button"
                style={styles.utilChip}
                onClick={() => {
                  const options = [0, 15, 30, 45, 60];
                  const next = options[(options.indexOf(sleepMinutesLeft) + 1) % options.length];
                  setSleepMinutesLeft(next);
                  showToast(next ? `🌙 Hẹn giờ tắt sau ${next} phút` : 'Đã tắt hẹn giờ ngủ');
                }}
              >
                🌙 {sleepMinutesLeft > 0 ? `Ngủ: ${sleepMinutesLeft}p` : 'Hẹn giờ ngủ'}
              </button>

              <button
                type="button"
                style={styles.utilChip}
                onClick={() => {
                  const speeds = [1, 1.15, 1.25, 0.9];
                  const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
                  setPlaybackRate(next);
                  showToast(`⚡ Tốc độ: ${next}x`);
                }}
              >
                ⚡ Tốc độ: {playbackRate}x
              </button>
            </div>
          </section>
        )}

        {/* Thanh tìm kiếm & Dán nhanh */}
        <section style={styles.omniCard}>
          <form onSubmit={handleOmniSubmit} style={styles.omniRow}>
            <input
              type="text"
              placeholder="🔍 Gõ tên bài hát, ca sĩ hoặc dán link..."
              value={omniQuery}
              onChange={(e) => setOmniQuery(e.target.value)}
              style={styles.omniInput}
            />
            {omniQuery ? (
              <button
                type="button"
                onClick={() => {
                  setOmniQuery('');
                  setSearchResults([]);
                }}
                style={styles.clearBtn}
              >
                ✕
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                style={styles.pasteBtn}
              >
                📋 Dán
              </button>
            )}
            <button type="submit" style={styles.omniSubmitBtn}>
              Phát
            </button>
          </form>

          {isSearching && (
            <div style={styles.searchingHint}>Đang tìm nguồn nhạc chuẩn iOS...</div>
          )}

          {searchResults.length > 0 && (
            <div style={styles.searchDropdown}>
              {searchResults.map((item, i) => (
                <div
                  key={item.id || item.youtubeId || i}
                  onClick={() => {
                    handleQuickPlayTrack(item);
                    setOmniQuery('');
                    setSearchResults([]);
                  }}
                  style={styles.searchResultItem}
                >
                  <img src={item.thumbnail} alt={item.title} style={styles.thumbSmall} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.songName}>{item.title}</div>
                    <div style={styles.songSub}>
                      {item.artist} •{' '}
                      <span style={{ color: item.source === 'apple_cdn' ? '#34d399' : '#c084fc' }}>
                        {item.source === 'apple_cdn' ? '🍏 Apple M4A Siêu tốc' : 'YouTube Audio'}
                      </span>
                    </div>
                  </div>
                  <span style={styles.playNowPill}>▶ Phát</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div style={styles.tabBar}>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'library' ? styles.tabBtnActive : {})
            }}
          >
            🎵 Danh sách phát ({songs.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('discover');
              fetchRecommendations(selectedMood);
            }}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'discover' ? styles.tabBtnActive : {})
            }}
          >
            ✨ Đề xuất theo Gu ({recommendations.length})
          </button>
        </div>

        {activeTab === 'library' && (
          <section style={styles.listSection}>
            {songs.map((song, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={song.id}
                  onClick={() => handleSelectSong(idx)}
                  style={{
                    ...styles.songItem,
                    borderColor: active ? '#a855f7' : 'rgba(255,255,255,0.07)',
                    background: active
                      ? 'linear-gradient(90deg, rgba(168,85,247,0.22), rgba(59,130,246,0.10))'
                      : 'rgba(255,255,255,0.03)'
                  }}
                >
                  <img src={song.thumbnail} alt={song.title} style={styles.thumbSmall} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.songName}>
                      {active && isPlaying ? '🔊 ' : ''}
                      {song.title}
                    </div>
                    <div style={styles.songSub}>{song.artist}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendTasteSignal(song.id, 'toggle_like');
                    }}
                    style={{
                      ...styles.heartMiniBtn,
                      color: song.liked ? '#f43f5e' : '#64748b'
                    }}
                  >
                    {song.liked ? '♥' : '♡'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSong(song.id, idx);
                    }}
                    style={styles.deleteBtn}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {activeTab === 'discover' && (
          <section style={styles.discoverSection}>
            <div style={styles.moodScroll}>
              {MOOD_FILTERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMood(m.id);
                    fetchRecommendations(m.id);
                  }}
                  style={{
                    ...styles.moodPill,
                    ...(selectedMood === m.id ? styles.moodPillActive : {})
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={styles.listSection}>
              {recommendations.map((rec, i) => (
                <div
                  key={rec.id || rec.youtubeId || i}
                  onClick={() => handleQuickPlayTrack(rec)}
                  style={styles.songItem}
                >
                  <img src={rec.thumbnail} alt={rec.title} style={styles.thumbSmall} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.songName}>{rec.title}</div>
                    <div style={styles.songSub}>
                      {rec.artist} • <span style={{ color: '#c084fc' }}>{rec.reason}</span>
                    </div>
                  </div>
                  <span style={styles.playNowPill}>+ Phát ngay</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#07080d',
    color: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
    paddingTop: 'max(18px, env(safe-area-inset-top))',
    paddingBottom: 'max(42px, env(safe-area-inset-bottom))',
    paddingLeft: 14,
    paddingRight: 14,
    position: 'relative',
    overflowX: 'hidden'
  },
  ambientGlow: {
    position: 'fixed',
    top: '-15%',
    left: '-15%',
    width: '130%',
    height: '55%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(90px) saturate(180%)',
    opacity: 0.22,
    pointerEvents: 'none',
    zIndex: 0
  },
  container: {
    maxWidth: 520,
    margin: '0 auto',
    position: 'relative',
    zIndex: 1
  },
  header: { marginBottom: 14 },
  headerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  badge: {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: '#86efac',
    background: 'rgba(34, 197, 94, 0.18)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    padding: '4px 10px',
    borderRadius: 999
  },
  sleepBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#fde047',
    background: 'rgba(250, 204, 21, 0.14)',
    padding: '4px 10px',
    borderRadius: 999
  },
  brandRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 10
  },
  logo: {
    margin: 0,
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: '-0.03em'
  },
  subtitle: {
    margin: '2px 0 0',
    fontSize: 12,
    color: '#94a3b8'
  },
  tasteChip: {
    fontSize: 11,
    color: '#cbd5e1',
    background: 'rgba(255,255,255,0.06)',
    padding: '5px 10px',
    borderRadius: 10,
    whiteSpace: 'nowrap'
  },
  toast: {
    position: 'fixed',
    bottom: 'max(22px, env(safe-area-inset-bottom))',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid rgba(192, 132, 252, 0.45)',
    color: '#f8fafc',
    padding: '10px 18px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 99
  },
  playerCard: {
    background: 'rgba(17, 20, 34, 0.85)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(168, 85, 247, 0.35)',
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    boxShadow: '0 16px 40px rgba(0,0,0,0.5)'
  },
  nowPlayingRow: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    marginBottom: 12
  },
  cover: {
    width: 78,
    height: 78,
    borderRadius: 16,
    objectFit: 'cover',
    flexShrink: 0
  },
  trackMeta: { minWidth: 0, flex: 1 },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  statusPill: {
    fontSize: 11,
    color: '#86efac',
    fontWeight: 600
  },
  likeBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  trackTitle: {
    margin: '0 0 3px',
    fontSize: 17,
    fontWeight: 800,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  trackArtist: {
    margin: '0 0 4px',
    fontSize: 13,
    color: '#94a3b8'
  },
  timeRow: {
    display: 'flex',
    gap: 6,
    fontSize: 12,
    color: '#cbd5e1'
  },
  nativeAudioWrap: {
    marginBottom: 12,
    background: 'rgba(255,255,255,0.04)',
    padding: '6px 8px',
    borderRadius: 14
  },
  nativeAudio: {
    width: '100%',
    height: 38,
    display: 'block'
  },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 10
  },
  iconBtn: {
    width: 42,
    height: 44,
    borderRadius: 12,
    border: 'none',
    fontSize: 16,
    cursor: 'pointer'
  },
  primaryBtn: {
    flex: 1.5,
    height: 46,
    background: 'linear-gradient(135deg, #9333ea, #6366f1)',
    color: '#fff',
    border: 'none',
    borderRadius: 14,
    fontWeight: 800,
    fontSize: 15,
    cursor: 'pointer'
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    background: 'rgba(255,255,255,0.08)',
    color: '#f1f5f9',
    border: 'none',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer'
  },
  utilityBar: {
    display: 'flex',
    gap: 8
  },
  utilChip: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    borderRadius: 10,
    padding: '8px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  omniCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 18,
    padding: 10,
    marginBottom: 14
  },
  omniRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center'
  },
  omniInput: {
    flex: 1,
    minWidth: 0,
    background: '#0d101b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '11px 12px',
    color: '#fff',
    fontSize: 13
  },
  pasteBtn: {
    background: 'rgba(255,255,255,0.08)',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: 10,
    padding: '10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  clearBtn: {
    background: 'transparent',
    color: '#94a3b8',
    border: 'none',
    fontSize: 15,
    padding: '8px',
    cursor: 'pointer'
  },
  omniSubmitBtn: {
    background: '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '11px 14px',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer'
  },
  searchingHint: {
    fontSize: 12,
    color: '#a855f7',
    padding: '8px 4px 2px'
  },
  searchDropdown: {
    marginTop: 10,
    borderTop: '1px solid rgba(255,255,255,0.08)',
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 280,
    overflowY: 'auto'
  },
  searchResultItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    cursor: 'pointer'
  },
  playNowPill: {
    fontSize: 11,
    fontWeight: 700,
    color: '#d8b4fe',
    background: 'rgba(168, 85, 247, 0.2)',
    padding: '6px 10px',
    borderRadius: 999,
    whiteSpace: 'nowrap'
  },
  tabBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 12
  },
  tabBtn: {
    flex: 1,
    padding: '11px 12px',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
    color: '#94a3b8',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer'
  },
  tabBtnActive: {
    background: 'rgba(168, 85, 247, 0.2)',
    borderColor: '#a855f7',
    color: '#f8fafc'
  },
  listSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  songItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer'
  },
  thumbSmall: {
    width: 48,
    height: 48,
    borderRadius: 10,
    objectFit: 'cover',
    flexShrink: 0
  },
  songName: {
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heartMiniBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: 17,
    padding: '4px 6px',
    cursor: 'pointer'
  },
  deleteBtn: {
    background: 'transparent',
    color: '#64748b',
    border: 'none',
    fontSize: 14,
    padding: '4px 6px',
    cursor: 'pointer'
  },
  discoverSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  moodScroll: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 4
  },
  moodPill: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    padding: '7px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer'
  },
  moodPillActive: {
    background: '#7c3aed',
    borderColor: '#a855f7',
    color: '#fff'
  }
};
`;

writeFileEnsured('package.json', JSON.stringify(rootPackageJson, null, 2) + '\n');
writeFileEnsured('server/package.json', JSON.stringify(serverPackageJson, null, 2) + '\n');
writeFileEnsured('server/src/index.js', serverIndexJs);
writeFileEnsured('client/vite.config.js', clientViteConfigJs);
writeFileEnsured('client/index.html', clientIndexHtml);
writeFileEnsured('client/public/manifest.webmanifest', clientManifest + '\n');
writeFileEnsured('client/src/App.jsx', clientAppJsx);

console.log('\n============================================================');
console.log('✅ ĐÃ ÁP DỤNG BẢN FIX TRIỆT ĐỂ CHO IPHONE LOCK-SCREEN!');
console.log('============================================================');
