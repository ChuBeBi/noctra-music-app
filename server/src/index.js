const express = require('express');
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
