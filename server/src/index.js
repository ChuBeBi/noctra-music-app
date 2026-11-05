const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let ytdl = null;
try {
  ytdl = require('@distube/ytdl-core');
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type']
  })
);
app.use(express.json());

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 100
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 100
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'youtube_library_v5.json');

// Danh sách bài hát mặc định 100% từ YouTube (Các bản nhạc thật có độ dài cố định, hỗ trợ stream m4a)
const DEFAULT_YOUTUBE_SONGS = [
  {
    id: 'yt-lTRiuFIWV54',
    youtubeId: 'lTRiuFIWV54',
    title: '1 A.M Study Session — Lofi Hip Hop Chill Beats',
    artist: 'Lofi Girl',
    durationText: '1:01:14',
    thumbnail: 'https://i.ytimg.com/vi/lTRiuFIWV54/hqdefault.jpg',
    tags: ['lofi', 'chill', 'focus'],
    liked: true,
    playCount: 12,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 20
  },
  {
    id: 'yt-n61ULEU7CO0',
    youtubeId: 'n61ULEU7CO0',
    title: 'Best of Lofi Hip Hop — Beats to Relax / Study to',
    artist: 'Lofi Girl',
    durationText: '2:19:57',
    thumbnail: 'https://i.ytimg.com/vi/n61ULEU7CO0/hqdefault.jpg',
    tags: ['lofi', 'chill'],
    liked: true,
    playCount: 8,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 15
  },
  {
    id: 'yt-5qap5aO4i9A',
    youtubeId: 'rUxyKA_-grg',
    title: 'Sleepy Fish — My Room Becomes the Sea (Chillhop)',
    artist: 'Chillhop Music',
    durationText: '26:12',
    thumbnail: 'https://i.ytimg.com/vi/rUxyKA_-grg/hqdefault.jpg',
    tags: ['chill', 'lofi', 'sleep'],
    liked: false,
    playCount: 5,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 10
  }
];

const audioBufferCache = new Map();
const streamMetaCache = new Map();
const inflightResolvers = new Map();
const inflightDownloads = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheAudioBuffer(key, buffer, mimeType) {
  if (!buffer || buffer.length < 4096 || buffer.length > 28 * 1024 * 1024) return;
  if (audioBufferCache.size >= 10 && !audioBufferCache.has(key)) {
    const oldestKey = audioBufferCache.keys().next().value;
    audioBufferCache.delete(oldestKey);
  }
  audioBufferCache.set(key, {
    buffer,
    mimeType: mimeType || 'audio/mp4',
    timestamp: Date.now()
  });
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
          Accept: 'application/json',
          ...(options.headers || {})
        },
        timeout: options.timeout || 6500
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error('Invalid JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractYouTubeId(input = '') {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1, 12);
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live' || p === 'v');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1].slice(0, 11);
  } catch (_) {}
  return null;
}

function inferTagsFromText(title = '', artist = '') {
  const text = `${title} ${artist}`.toLowerCase();
  const dictionary = [
    ['vpop', ['vpop', 'v-pop', 'nhạc trẻ', 'việt', 'ballad', 'sơn tùng', 'đen vâu', 'vũ', 'hieuthuhai', 'soobin', 'bích phương', 'amee', 'tlinh', 'mck', 'wren evans', 'hà anh tuấn', 'phan mạnh quỳnh', 'bùi anh tuấn', 'noo', 'hoàng thùy linh', 'mono', 'tăng duy tân']],
    ['lofi', ['lofi', 'lo-fi', 'chillhop', 'study', 'beats', 'coffee']],
    ['indie', ['indie', 'acoustic', 'guitar', 'mộc', 'ngọt', 'cá hồi hoang', 'chillies', 'da lab', 'trang', 'thịnh suy']],
    ['remix', ['remix', 'vinahouse', 'edm', 'club', 'dj', 'bass', 'house', 'techno', 'nonstop']],
    ['rnb', ['r&b', 'rnb', 'soul', 'hiphop', 'rap', 'gerdnang', 'bray', 'karik', 'binz']],
    ['piano', ['piano', 'classical', 'instrumental', 'không lời', 'violin', 'yiruma', 'guitar']],
    ['synthwave', ['synthwave', 'retro', 'cyberpunk', '80s', 'night drive']],
    ['sleep', ['sleep', 'rain', 'ambient', 'ngủ', 'meditation', 'healing']],
    ['usuk', ['pop', 'taylor', 'weeknd', 'billie', 'charlie puth', 'ariana', 'justin', 'ed sheeran', 'bruno mars', 'coldplay', 'maroon 5']],
    ['chill', ['chill', 'relax', 'cozy', 'vibes', 'nhẹ nhàng']]
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

/**
 * GIẢI MÃ LUỒNG ÂM THANH YOUTUBE TRỰC TIẾP VỚI HEADER USER-AGENT KHỚP 100% CLIENT:
 * Khi lấy URL googlevideo.com bằng client ANDROID_VR hoặc IOS, bắt buộc phải gửi đúng User-Agent
 * của thiết bị đó ở cả bước lấy link lẫn bước tải luồng âm thanh thì YouTube mới không chặn 403!
 */
const YT_PLAYER_CLIENTS = [
  {
    name: 'ANDROID_VR',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    clientContext: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12L',
      androidSdkVersion: 32,
      hl: 'vi',
      gl: 'VN'
    }
  },
  {
    name: 'IOS',
    userAgent:
      'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; vi_VN)',
    clientContext: {
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '17.5.1.21F90',
      hl: 'vi',
      gl: 'VN'
    }
  },
  {
    name: 'ANDROID',
    userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14; vi_VN) gzip',
    clientContext: {
      clientName: 'ANDROID',
      clientVersion: '19.44.38',
      osName: 'Android',
      osVersion: '14',
      androidSdkVersion: 34,
      hl: 'vi',
      gl: 'VN'
    }
  }
];

async function resolveYouTubeViaInnerTube(videoId) {
  for (const cfg of YT_PLAYER_CLIENTS) {
    try {
      const body = JSON.stringify({
        videoId,
        context: {
          client: cfg.clientContext
        },
        contentCheckOk: true,
        racyCheckOk: true
      });

      const data = await fetchJson('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'User-Agent': cfg.userAgent,
          'Content-Type': 'application/json',
          'X-Goog-Api-Format-Version': '2',
          Origin: 'https://www.youtube.com'
        },
        body,
        timeout: 5500
      });

      const adaptive = data?.streamingData?.adaptiveFormats || [];
      const formats = data?.streamingData?.formats || [];
      const allFormats = [...adaptive, ...formats];

      const audioWithUrl = allFormats.filter(
        (f) => f.url && ((f.mimeType || '').startsWith('audio/') || Number(f.itag) === 18)
      );

      // Ưu tiên itag 140 (m4a / audio/mp4) giải mã phần cứng trực tiếp trên iPhone
      const chosen =
        audioWithUrl.find((f) => Number(f.itag) === 140) ||
        audioWithUrl.find((f) => (f.mimeType || '').includes('audio/mp4')) ||
        audioWithUrl.find((f) => (f.mimeType || '').startsWith('audio/')) ||
        audioWithUrl[0];

      if (chosen && chosen.url) {
        const durSec = Number(data?.videoDetails?.lengthSeconds || 0);
        const mins = Math.floor(durSec / 60);
        const secs = String(durSec % 60).padStart(2, '0');

        return {
          url: chosen.url,
          userAgent: cfg.userAgent,
          mimeType: (chosen.mimeType || 'audio/mp4').split(';')[0].replace('video/mp4', 'audio/mp4'),
          contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
          title: data?.videoDetails?.title || `YouTube (${videoId})`,
          author: (data?.videoDetails?.author || 'YouTube Music').replace(/ - Topic$/i, ''),
          durationText: durSec > 0 ? `${mins}:${secs}` : '',
          thumbnail:
            data?.videoDetails?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          timestamp: Date.now()
        };
      }
    } catch (_) {}
  }
  throw new Error('InnerTube clients failed');
}

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me'
];

async function resolveYouTubeViaPiped(videoId) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await fetchJson(`${base}/streams/${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 5000
      });
      if (data && Array.isArray(data.audioStreams) && data.audioStreams.length > 0) {
        const m4a =
          data.audioStreams.find((s) => (s.mimeType || '').includes('audio/mp4')) ||
          data.audioStreams[0];
        if (m4a && m4a.url) {
          return {
            url: m4a.url,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            mimeType: (m4a.mimeType || 'audio/mp4').split(';')[0],
            contentLength: m4a.contentLength ? Number(m4a.contentLength) : null,
            title: data.title || `YouTube (${videoId})`,
            author: (data.uploader || 'YouTube').replace(/ - Topic$/i, ''),
            durationText: '',
            thumbnail: data.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          };
        }
      }
    } catch (_) {}
  }
  throw new Error('Piped fallback failed');
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
      // Tầng 1: InnerTube ANDROID_VR / IOS / ANDROID với User-Agent khớp tuyệt đối
      const res1 = await resolveYouTubeViaInnerTube(videoId);
      streamMetaCache.set(videoId, res1);
      return res1;
    } catch (_) {}

    // Tầng 2: @distube/ytdl-core
    if (ytdl) {
      try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
        const chosen =
          audioFormats.find((f) => Number(f.itag) === 140) ||
          audioFormats.find((f) => f.container === 'mp4') ||
          audioFormats[0] ||
          info.formats.find((f) => f.hasAudio && f.url);

        if (chosen && chosen.url) {
          const res2 = {
            url: chosen.url,
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            mimeType: chosen.container === 'mp4' ? 'audio/mp4' : 'audio/mpeg',
            contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
            title: info.videoDetails?.title || `YouTube (${videoId})`,
            author: info.videoDetails?.author?.name?.replace(/ - Topic$/i, '') || 'YouTube Music',
            durationText: '',
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          };
          streamMetaCache.set(videoId, res2);
          return res2;
        }
      } catch (_) {}
    }

    // Tầng 3: Piped API
    const res3 = await resolveYouTubeViaPiped(videoId);
    streamMetaCache.set(videoId, res3);
    return res3;
  })().finally(() => {
    inflightResolvers.delete(videoId);
  });

  inflightResolvers.set(videoId, task);
  return task;
}

// Tìm kiếm bài hát 100% từ YouTube (loại bỏ livestream để đảm bảo phát nền khóa màn hình mượt mà)
async function searchYouTubeTracks(query, limit = 10) {
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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Content-Type': 'application/json'
    },
    body,
    timeout: 6000
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
        v.longBylineText?.runs?.[0]?.text?.replace(/ - Topic$/i, '') ||
        'YouTube Channel';
      const durationText = v.lengthText?.simpleText || '';
      const thumbnail =
        v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ||
        `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

      results.push({
        id: `yt-${v.videoId}`,
        youtubeId: v.videoId,
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
}

// Tải ngầm file âm thanh YouTube (<24MB) vào RAM với ĐÚNG User-Agent để phục vụ tua & chuyển bài 0ms
function downloadStreamToBuffer(urlStr, userAgent, maxRedirects = 4) {
  if (inflightDownloads.has(urlStr)) {
    return inflightDownloads.get(urlStr);
  }
  const promise = new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const agent = parsed.protocol === 'https:' ? httpsAgent : httpAgent;

    const req = client.get(
      parsed,
      {
        agent,
        headers: {
          'User-Agent':
            userAgent ||
            'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
          Accept: '*/*'
        },
        timeout: 15000
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
          return resolve(downloadStreamToBuffer(nextUrl, userAgent, maxRedirects - 1));
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const rawMime = (res.headers['content-type'] || 'audio/mp4').split(';')[0];
        const mimeType = rawMime.includes('video/mp4') ? 'audio/mp4' : rawMime;
        const chunks = [];
        let totalBytes = 0;

        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 26 * 1024 * 1024) {
            req.destroy();
            return reject(new Error('Stream larger than RAM cache limit'));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const fullBuffer = Buffer.concat(chunks);
          if (fullBuffer.length < 4096) return reject(new Error('Buffer too small'));
          resolve({ buffer: fullBuffer, mimeType });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  }).finally(() => {
    inflightDownloads.delete(urlStr);
  });

  inflightDownloads.set(urlStr, promise);
  return promise;
}

function serveBufferWithIosRange(req, res, buffer, mimeType = 'audio/mp4') {
  const total = buffer.length;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

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

  res.writeHead(200, { 'Content-Length': total });
  return res.end(buffer);
}

function loadDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
        return {
          songs: parsed.songs,
          tasteProfile: parsed.tasteProfile || {
            tags: { vpop: 5, lofi: 5, chill: 4, indie: 3 },
            artists: {}
          }
        };
      }
    }
  } catch (_) {}
  return {
    songs: [...DEFAULT_YOUTUBE_SONGS],
    tasteProfile: {
      tags: { vpop: 5, lofi: 5, chill: 4, indie: 3 },
      artists: {}
    }
  };
}

let db = loadDb();

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}
}

// Khi khởi động Server, tự động tìm các bản nhạc YouTube thịnh hành (3-5 phút) và giải mã sẵn vào RAM
async function warmupYouTubeLibrary() {
  try {
    // Nếu thư viện mới chỉ có 3 bài mặc định, tự động lấy thêm các bản nhạc YouTube đang hot
    if (db.songs.length <= 3) {
      const hotTracks = await searchYouTubeTracks('nhạc trẻ vpop lofi chill hay nhất official audio', 5);
      for (const t of hotTracks) {
        if (!db.songs.some((s) => s.youtubeId === t.youtubeId)) {
          db.songs.unshift({
            ...t,
            liked: false,
            playCount: 1,
            skipCount: 0,
            addedAt: Date.now()
          });
        }
      }
      saveDb();
    }

    // Giải mã sẵn 2 bài đầu tiên trong danh sách để bấm Play trên iPhone là phát ngay lập tức
    for (const s of db.songs.slice(0, 2)) {
      if (s.youtubeId) {
        resolveYouTubeAudioFormat(s.youtubeId)
          .then((info) => {
            if (info.contentLength && info.contentLength < 15 * 1024 * 1024) {
              downloadStreamToBuffer(info.url, info.userAgent)
                .then(({ buffer, mimeType }) => cacheAudioBuffer(s.youtubeId, buffer, mimeType))
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    }
  } catch (_) {}
}
warmupYouTubeLibrary();

function updateUserTaste(song, signalType) {
  if (!song) return;
  const weights = { play: 2, complete: 4, like: 6, unlike: -4, early_skip: -3, add: 5 };
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

// Nạp trước luồng âm thanh YouTube của bài kế tiếp vào RAM trước khi bài hiện tại kết thúc
app.get('/api/prefetch/:rawId', async (req, res) => {
  const cleanId = req.params.rawId.replace(/\.(m4a|mp3)$/i, '');
  const song = db.songs.find((s) => s.id === cleanId || s.youtubeId === cleanId);
  const ytId = song?.youtubeId || (/^[a-zA-Z0-9_-]{11}$/.test(cleanId) ? cleanId : null);
  if (!ytId) return res.json({ ready: false });

  try {
    const info = await resolveYouTubeAudioFormat(ytId);
    if (
      !audioBufferCache.has(ytId) &&
      (!info.contentLength || info.contentLength < 18 * 1024 * 1024)
    ) {
      downloadStreamToBuffer(info.url, info.userAgent)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(ytId, buffer, mimeType))
        .catch(() => {});
    }
    res.json({ ready: true, youtubeId: ytId });
  } catch (_) {
    res.json({ ready: false });
  }
});

// Tìm kiếm bài hát 100% từ YouTube
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const results = await searchYouTubeTracks(q, 10);
    // Giải mã trước bài đầu tiên ngay khi hiện kết quả tìm kiếm
    if (results[0]?.youtubeId) {
      resolveYouTubeAudioFormat(results[0].youtubeId).catch(() => {});
    }
    res.json(results);
  } catch (_) {
    res.json([]);
  }
});

// Đề xuất bài hát chuẩn Gu 100% từ YouTube
app.get('/api/recommendations', async (req, res) => {
  try {
    const sortedTags = Object.entries(db.tasteProfile.tags || {})
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
    const sortedArtists = Object.entries(db.tasteProfile.artists || {})
      .sort((a, b) => b[1] - a[1])
      .map(([a]) => a);

    const topTag = sortedTags[0] || 'vpop';
    const secondTag = sortedTags[1] || 'lofi';
    const favArtist = sortedArtists[0] || '';

    const queryMap = {
      vpop: 'nhạc trẻ vpop chill thịnh hành official audio',
      lofi: 'lofi hip hop chill beats study relax',
      indie: 'indie việt acoustic chill hay nhất',
      rnb: 'rap việt r&b chill hieuthuhai tlinh wren evans',
      remix: 'nhạc trẻ remix vinahouse bass căng mới nhất',
      piano: 'relaxing piano music study sleep yiruma',
      usuk: 'us uk pop hits chill songs official audio',
      chill: 'nhạc chill nhẹ nhàng thư giãn'
    };

    const mood = String(req.query.mood || 'all');
    const searchQuery =
      mood !== 'all' && queryMap[mood]
        ? queryMap[mood]
        : favArtist && !favArtist.includes('noctra') && !favArtist.includes('lofi girl')
          ? `${favArtist} official audio`
          : queryMap[topTag] || queryMap.vpop;

    const existingYtIds = new Set(db.songs.map((s) => s.youtubeId).filter(Boolean));
    const ytRecs = await searchYouTubeTracks(searchQuery, 12);

    const items = ytRecs
      .filter((item) => !existingYtIds.has(item.youtubeId))
      .map((item) => ({
        ...item,
        reason:
          mood !== 'all'
            ? `YouTube #${mood}`
            : favArtist && !favArtist.includes('noctra')
              ? `Vì bạn hay nghe ${favArtist}`
              : `Chuẩn gu #${topTag} trên YouTube`
      }));

    if (items[0]?.youtubeId) {
      resolveYouTubeAudioFormat(items[0].youtubeId).catch(() => {});
    }

    res.json({
      topTags: [topTag, secondTag].filter(Boolean),
      items: items.slice(0, 8)
    });
  } catch (_) {
    res.json({ topTags: ['vpop', 'lofi'], items: [] });
  }
});

app.post('/api/signals', (req, res) => {
  const { songId, signal } = req.body || {};
  const song = db.songs.find((s) => s.id === songId || s.youtubeId === songId);
  if (song) {
    if (signal === 'play') song.playCount = (song.playCount || 0) + 1;
    if (signal === 'early_skip') song.skipCount = (song.skipCount || 0) + 1;
    if (signal === 'toggle_like') {
      song.liked = !song.liked;
      updateUserTaste(song, song.liked ? 'like' : 'unlike');
      saveDb();
    } else {
      updateUserTaste(song, signal);
    }
  }
  res.json({ ok: true, song, tasteProfile: db.tasteProfile });
});

app.post('/api/songs', async (req, res) => {
  try {
    const {
      title,
      artist,
      urlOrId,
      youtubeId: bodyYtId,
      durationText: bodyDur,
      thumbnail: customThumb,
      tags: customTags
    } = req.body || {};

    const raw = String(bodyYtId || urlOrId || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Vui lòng nhập tên bài hát hoặc dán link YouTube.' });
    }

    let ytId = extractYouTubeId(raw);

    // Nếu người dùng gõ tên bài hát trực tiếp -> tìm bài khớp nhất trên YouTube
    if (!ytId && !/^https?:\/\//i.test(raw)) {
      const searched = await searchYouTubeTracks(raw, 1);
      if (searched.length > 0) {
        ytId = searched[0].youtubeId;
      }
    }

    if (ytId) {
      const existingIdx = db.songs.findIndex((s) => s.youtubeId === ytId);
      if (existingIdx !== -1) {
        const [existing] = db.songs.splice(existingIdx, 1);
        db.songs.unshift(existing);
        saveDb();
        resolveYouTubeAudioFormat(ytId).catch(() => {});
        return res.status(200).json(existing);
      }

      let metaTitle = title?.trim();
      let metaArtist = artist?.trim();
      let durationText = bodyDur || '';
      let thumbnail = customThumb || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

      if (!metaTitle || !metaArtist) {
        try {
          const info = await resolveYouTubeAudioFormat(ytId);
          metaTitle = metaTitle || info.title;
          metaArtist = metaArtist || info.author;
          durationText = durationText || info.durationText || '';
          thumbnail = info.thumbnail || thumbnail;
        } catch (_) {
          metaTitle = metaTitle || `YouTube Track (${ytId})`;
          metaArtist = metaArtist || 'YouTube';
        }
      } else {
        resolveYouTubeAudioFormat(ytId).catch(() => {});
      }

      const newSong = {
        id: `yt-${ytId}`,
        youtubeId: ytId,
        title: metaTitle,
        artist: metaArtist,
        durationText,
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

    return res.status(404).json({ error: 'Không tìm thấy video YouTube hợp lệ.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Lỗi khi thêm bài hát từ YouTube.' });
  }
});

app.delete('/api/songs/:id', (req, res) => {
  db.songs = db.songs.filter((s) => s.id !== req.params.id && s.youtubeId !== req.params.id);
  saveDb();
  res.json({ ok: true });
});

/**
 * ENDPOINT STREAM ÂM THANH YOUTUBE CHUẨN IPHONE (/api/stream/:rawParam):
 * - Sử dụng đúng User-Agent đã giải mã (ANDROID_VR / IOS) khi kết nối tới googlevideo.com để không bao giờ bị 403!
 * - Phản hồi chuẩn HTTP 206 Partial Content (Accept-Ranges: bytes, Content-Range, Content-Length) cho iOS Safari.
 */
app.get('/api/stream/:rawParam', async (req, res) => {
  const cleanId = req.params.rawParam.replace(/\.(m4a|mp3|wav)$/i, '');
  const song = db.songs.find((s) => s.id === cleanId || s.youtubeId === cleanId);
  const ytId = song?.youtubeId || cleanId.replace(/^yt-/, '');

  try {
    // 1. Nếu bài hát YouTube đã được nạp sẵn vào RAM -> Phục vụ HTTP 206 tức thì (< 1ms)!
    if (audioBufferCache.has(ytId)) {
      const cached = audioBufferCache.get(ytId);
      return serveBufferWithIosRange(req, res, cached.buffer, cached.mimeType);
    }

    // 2. Giải mã luồng âm thanh YouTube
    const streamInfo = await resolveYouTubeAudioFormat(ytId);
    const parsedTarget = new URL(streamInfo.url);
    const isHttps = parsedTarget.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    // Nếu file < 18MB, đồng thời nạp ngầm vào RAM để các lần tua hoặc chuyển bài kế tiếp đạt tốc độ 0ms
    if (!streamInfo.contentLength || streamInfo.contentLength < 18 * 1024 * 1024) {
      downloadStreamToBuffer(streamInfo.url, streamInfo.userAgent)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(ytId, buffer, mimeType))
        .catch(() => {});
    }

    // QUAN TRỌNG NHẤT: Gửi đúng User-Agent của Client đã dùng để lấy link googlevideo.com!
    const reqHeaders = {
      'User-Agent': streamInfo.userAgent,
      Accept: '*/*',
      Connection: 'keep-alive',
      Range: req.headers.range || 'bytes=0-'
    };

    const proxyReq = client.get(parsedTarget, { headers: reqHeaders, agent }, (proxyRes) => {
      // Nếu link cache hết hạn (403), xóa cache và giải mã lại ngay lập tức
      if (proxyRes.statusCode === 403 || proxyRes.statusCode === 410) {
        proxyRes.resume();
        streamMetaCache.delete(ytId);
        return res.status(503).end();
      }

      const resHeaders = {
        'Content-Type': streamInfo.mimeType || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      };

      if (proxyRes.headers['content-length']) {
        resHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        resHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(proxyRes.statusCode || 206, resHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('YouTube Stream Proxy Error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });

    req.on('close', () => proxyReq.destroy());
  } catch (err) {
    console.error('Lỗi giải mã YouTube [' + ytId + ']:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Không thể giải mã luồng âm thanh YouTube này.' });
    }
  }
});

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
  console.log(`🔥 NOCTRA YOUTUBE PRO v5.0 đang chạy tại: http://localhost:${PORT}`);
  console.log(`📱 Mở trên trình duyệt SAFARI của iPhone tại:`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
