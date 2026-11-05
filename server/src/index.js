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

// Lưu file DB ở thư mục tạm của hệ thống hoặc thư mục data (không kích hoạt trình theo dõi file gây restart server)
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'library_v4.json');

/**
 * Tạo một file âm thanh WAV Stereo Hòa Âm Lofi Chill dự phòng ngay trong RAM khi khởi động (0ms độ trễ)
 * để đảm bảo dù mất mạng hoàn toàn thì iPhone vẫn có luồng âm thanh chuẩn 206 Partial Content để phát nền.
 */
function createWarmAmbientWavBuffer(durationSeconds = 45) {
  const sampleRate = 22050;
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Vòng hợp âm Lofi ấm áp (Fmaj7 -> Em7 -> Dm7 -> Cmaj7)
  const chords = [
    [174.61, 220.0, 261.63, 329.63],
    [164.81, 196.0, 246.94, 293.66],
    [146.83, 174.61, 220.0, 261.63],
    [130.81, 164.81, 196.0, 246.94]
  ];

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const chordIdx = Math.floor(t / 4) % chords.length;
    const chord = chords[chordIdx];
    const env = Math.min(1, (t % 4) / 0.25) * Math.min(1, (4 - (t % 4)) / 0.4);

    let sigL = 0;
    let sigR = 0;
    for (let c = 0; c < chord.length; c++) {
      const freq = chord[c];
      sigL += Math.sin(2 * Math.PI * freq * t) * 0.16;
      sigR += Math.sin(2 * Math.PI * (freq * 1.002) * t) * 0.16;
    }

    // Bass ấm
    const bassFreq = chord[0] * 0.5;
    const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.25;
    const valL = Math.max(-0.95, Math.min(0.95, (sigL + bass) * env));
    const valR = Math.max(-0.95, Math.min(0.95, (sigR + bass) * env));

    buffer.writeInt16LE(Math.floor(valL * 32767), offset);
    buffer.writeInt16LE(Math.floor(valR * 32767), offset + 2);
    offset += 4;
  }
  return buffer;
}

const INSTANT_FALLBACK_WAV = createWarmAmbientWavBuffer(48);

// Bộ đệm RAM cho các luồng âm thanh (giúp iOS Safari nhận HTTP 206 trong < 1ms)
const audioBufferCache = new Map();
const streamMetaCache = new Map();
const inflightDownloads = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheAudioBuffer(key, buffer, mimeType) {
  if (!buffer || buffer.length < 1024 || buffer.length > 25 * 1024 * 1024) return;
  if (audioBufferCache.size >= 12 && !audioBufferCache.has(key)) {
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
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          Accept: 'application/json',
          ...(options.headers || {})
        },
        timeout: options.timeout || 5500
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

function inferTagsFromText(title = '', artist = '') {
  const text = `${title} ${artist}`.toLowerCase();
  const dictionary = [
    ['lofi', ['lofi', 'lo-fi', 'chillhop', 'study', 'beats']],
    ['chill', ['chill', 'relax', 'cozy', 'vibes', 'cafe', 'nhẹ nhàng']],
    ['vpop', ['vpop', 'v-pop', 'nhạc trẻ', 'việt', 'ballad', 'sơn tùng', 'đen vâu', 'vũ', 'hieuthuhai', 'soobin', 'bích phương', 'amee', 'tlinh', 'mck', 'wren evans', 'hà anh tuấn', 'phan mạnh quỳnh']],
    ['indie', ['indie', 'acoustic', 'guitar', 'mộc', 'ngọt', 'cá hồi hoang', 'chillies', 'da lab']],
    ['remix', ['remix', 'vinahouse', 'edm', 'club', 'dj', 'bass', 'house', 'techno']],
    ['rnb', ['r&b', 'rnb', 'soul', 'hiphop', 'rap']],
    ['piano', ['piano', 'classical', 'instrumental', 'không lời', 'violin', 'yiruma']],
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

// Tìm kiếm nhạc trên Apple iTunes CDN (Trả về luồng .m4a chính chủ Apple CDN cực nhanh <100ms tại Việt Nam)
async function searchAppleMusicTracks(query, limit = 8) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&country=VN&limit=${limit}`;
    const data = await fetchJson(url, { timeout: 4500 });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results
      .filter((item) => item.previewUrl)
      .map((item) => ({
        id: `apple-${item.trackId}`,
        youtubeId: null,
        audioUrl: item.previewUrl,
        title: item.trackName || 'Unknown Track',
        artist: item.artistName || 'Unknown Artist',
        thumbnail: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
        durationText: 'AAC M4A',
        tags: inferTagsFromText(item.trackName, item.artistName),
        source: 'apple_cdn'
      }));
  } catch (_) {
    return [];
  }
}

/**
 * Giải mã trực tiếp luồng âm thanh YouTube thông qua YouTube InnerTube Player API (ANDROID_VR & IOS Client).
 * Phương pháp này lấy trực tiếp link m4a (itag 140, audio/mp4) trong ~150ms mà không bị lỗi chữ ký WEB.
 */
async function resolveYouTubeViaInnerTube(videoId) {
  const clients = [
    {
      clientName: 'ANDROID_VR',
      clientVersion: '1.60.19',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      osName: 'Android',
      osVersion: '12L',
      androidSdkVersion: 32
    },
    {
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '17.5.1.21F90'
    }
  ];

  for (const clientCfg of clients) {
    try {
      const body = JSON.stringify({
        videoId,
        context: {
          client: {
            ...clientCfg,
            hl: 'vi',
            gl: 'VN'
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      });

      const data = await fetchJson('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        body,
        timeout: 4500
      });

      const adaptive = data?.streamingData?.adaptiveFormats || [];
      const audioOnly = adaptive.filter(
        (f) => f.url && (f.mimeType || '').startsWith('audio/')
      );

      const chosen =
        audioOnly.find((f) => Number(f.itag) === 140) ||
        audioOnly.find((f) => (f.mimeType || '').includes('audio/mp4')) ||
        audioOnly[0];

      if (chosen && chosen.url) {
        return {
          url: chosen.url,
          mimeType: (chosen.mimeType || 'audio/mp4').split(';')[0],
          contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
          title: data?.videoDetails?.title || `YouTube (${videoId})`,
          author: (data?.videoDetails?.author || 'YouTube Music').replace(/ - Topic$/i, ''),
          thumbnail:
            data?.videoDetails?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
            `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          timestamp: Date.now()
        };
      }
    } catch (_) {}
  }
  throw new Error('InnerTube player resolve failed');
}

async function resolveYouTubeAudioFormat(videoId) {
  const cached = streamMetaCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  // Tầng 1: InnerTube ANDROID_VR / IOS trực tiếp (nhanh nhất, chuẩn itag 140 audio/mp4)
  try {
    const resolved = await resolveYouTubeViaInnerTube(videoId);
    streamMetaCache.set(videoId, resolved);
    return resolved;
  } catch (_) {}

  // Tầng 2: @distube/ytdl-core nếu có
  if (ytdl) {
    try {
      const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      const chosen =
        audioFormats.find((f) => Number(f.itag) === 140) ||
        audioFormats.find((f) => f.container === 'mp4') ||
        audioFormats[0];
      if (chosen && chosen.url) {
        const resolved = {
          url: chosen.url,
          mimeType: chosen.container === 'mp4' ? 'audio/mp4' : 'audio/mpeg',
          contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
          title: info.videoDetails?.title || `YouTube (${videoId})`,
          author: info.videoDetails?.author?.name?.replace(/ - Topic$/i, '') || 'YouTube Music',
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          timestamp: Date.now()
        };
        streamMetaCache.set(videoId, resolved);
        return resolved;
      }
    } catch (_) {}
  }

  // Tầng 3: Tìm bản tương đương trên Apple CDN M4A
  const songInDb = db.songs.find((s) => s.youtubeId === videoId);
  const query = songInDb ? `${songInDb.title} ${songInDb.artist}` : videoId;
  const appleMatches = await searchAppleMusicTracks(query, 1);
  if (appleMatches.length > 0 && appleMatches[0].audioUrl) {
    const fallback = {
      url: appleMatches[0].audioUrl,
      mimeType: 'audio/mp4',
      contentLength: null,
      title: songInDb?.title || appleMatches[0].title,
      author: songInDb?.artist || appleMatches[0].artist,
      thumbnail: songInDb?.thumbnail || appleMatches[0].thumbnail,
      timestamp: Date.now()
    };
    streamMetaCache.set(videoId, fallback);
    return fallback;
  }

  throw new Error('Cannot resolve audio stream');
}

// Tìm kiếm bài hát trên YouTube (bỏ qua livestream)
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
      timeout: 5000
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
          v.longBylineText?.runs?.[0]?.text ||
          'YouTube Artist';
        const durationText = v.lengthText?.simpleText || '';
        const thumbnail =
          v.thumbnail?.thumbnails?.[v.thumbnail.thumbnails.length - 1]?.url ||
          `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;

        results.push({
          id: `yt-${v.videoId}`,
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

function downloadToBuffer(urlStr, maxRedirects = 4) {
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
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          Accept: '*/*'
        },
        timeout: 10000
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
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const rawMime = (res.headers['content-type'] || 'audio/mp4').split(';')[0];
        const mimeType = rawMime.includes('audio/x-m4a') ? 'audio/mp4' : rawMime;
        const chunks = [];
        let totalBytes = 0;

        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 22 * 1024 * 1024) {
            req.destroy();
            return reject(new Error('Too large'));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const fullBuffer = Buffer.concat(chunks);
          if (fullBuffer.length < 512) return reject(new Error('Empty buffer'));
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

const DEFAULT_SONGS = [
  {
    id: 'song-default-1',
    title: 'Noctra Lofi Chill — Warm Midnight Study',
    artist: 'Noctra Studio',
    youtubeId: null,
    audioUrl: 'internal://warm-lofi',
    thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&q=80',
    tags: ['lofi', 'chill', 'focus'],
    liked: true,
    playCount: 5,
    skipCount: 0,
    addedAt: Date.now()
  }
];

function loadDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
        return {
          songs: parsed.songs,
          tasteProfile: parsed.tasteProfile || { tags: { lofi: 5, chill: 4, vpop: 4 }, artists: {} }
        };
      }
    }
  } catch (_) {}
  return {
    songs: [...DEFAULT_SONGS],
    tasteProfile: {
      tags: { lofi: 5, chill: 4, vpop: 4, indie: 3 },
      artists: {}
    }
  };
}

let db = loadDb();

// Nạp sẵn buffer âm thanh nội bộ ngay lập tức (0ms) cho bài mặc định
cacheAudioBuffer('song-default-1', INSTANT_FALLBACK_WAV, 'audio/wav');

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}
}

// Ngay khi khởi động Server, tự động lấy thêm các bài nhạc thật từ Apple CDN & nạp sẵn vào RAM
async function bootstrapInitialSongs() {
  try {
    if (db.songs.length <= 1) {
      const initialTracks = await searchAppleMusicTracks('Lofi Chill Beats Study', 4);
      for (const t of initialTracks) {
        const s = {
          id: `song-init-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: t.title,
          artist: t.artist,
          youtubeId: null,
          audioUrl: t.audioUrl,
          thumbnail: t.thumbnail,
          tags: t.tags,
          liked: false,
          playCount: 1,
          skipCount: 0,
          addedAt: Date.now()
        };
        db.songs.push(s);
        downloadToBuffer(s.audioUrl)
          .then(({ buffer, mimeType }) => cacheAudioBuffer(s.id, buffer, mimeType))
          .catch(() => {});
      }
      saveDb();
    } else {
      // Nạp sẵn 3 bài đầu tiên trong danh sách vào RAM để iPhone bấm Play là phát trong 1ms
      for (const s of db.songs.slice(0, 3)) {
        if (s.audioUrl && s.audioUrl.startsWith('http')) {
          downloadToBuffer(s.audioUrl)
            .then(({ buffer, mimeType }) => cacheAudioBuffer(s.id, buffer, mimeType))
            .catch(() => {});
        }
      }
    }
  } catch (_) {}
}
bootstrapInitialSongs();

function extractYouTubeId(input = '') {
  const trimmed = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1, 12);
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'live');
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1].slice(0, 11);
  } catch (_) {}
  return null;
}

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

// Nạp trước bài hát tiếp theo vào RAM để khi hết bài lúc tắt màn hình iPhone sẽ chuyển bài trong 0ms
app.get('/api/prefetch/:songId', async (req, res) => {
  const rawId = req.params.songId.replace(/\.(m4a|mp3|wav)$/i, '');
  const song = db.songs.find((s) => s.id === rawId || s.youtubeId === rawId);
  if (!song) return res.json({ ready: false });

  try {
    if (audioBufferCache.has(song.id)) {
      return res.json({ ready: true, cached: true });
    }
    let targetUrl = song.audioUrl;
    if ((!targetUrl || !targetUrl.startsWith('http')) && song.youtubeId) {
      const info = await resolveYouTubeAudioFormat(song.youtubeId);
      targetUrl = info.url;
    }
    if (targetUrl && targetUrl.startsWith('http')) {
      downloadToBuffer(targetUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(song.id, buffer, mimeType))
        .catch(() => {});
    }
    res.json({ ready: true });
  } catch (_) {
    res.json({ ready: false });
  }
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const [appleResults, ytResults] = await Promise.all([
      searchAppleMusicTracks(q, 6),
      searchYouTubeTracks(q, 5)
    ]);
    res.json([...appleResults, ...ytResults]);
  } catch (_) {
    res.json([]);
  }
});

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
      lofi: 'Lofi Chillhop Beats Study',
      remix: 'V-Pop Remix EDM',
      rnb: 'HIEUTHUHAI Wren Evans tlinh',
      piano: 'Yiruma Relaxing Piano',
      synthwave: 'Synthwave Retro Night Drive',
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
          : queryMap[topTag] || 'Lofi Chill Beats';

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

    // Tải trước bài đề xuất đầu tiên vào RAM để Auto-Radio phát tức thì
    if (items[0]?.audioUrl) {
      downloadToBuffer(items[0].audioUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(items[0].id, buffer, mimeType))
        .catch(() => {});
    }

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
      saveDb();
    } else {
      updateUserTaste(song, signal);
    }
  }
  res.json({ ok: true, song, tasteProfile: db.tasteProfile });
});

app.post('/api/songs', async (req, res) => {
  try {
    const { title, artist, urlOrId, audioUrl, youtubeId, thumbnail: customThumb, tags: customTags } =
      req.body || {};

    if (audioUrl && audioUrl.startsWith('http')) {
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
      downloadToBuffer(audioUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(newSong.id, buffer, mimeType))
        .catch(() => {});
      return res.status(201).json(newSong);
    }

    const raw = String(urlOrId || youtubeId || '').trim();
    if (!raw) {
      return res.status(400).json({ error: 'Vui lòng nhập tên bài hát hoặc dán link.' });
    }

    const ytId = extractYouTubeId(raw);
    if (ytId) {
      let metaTitle = title?.trim();
      let metaArtist = artist?.trim();
      let thumbnail = customThumb || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
      let resolvedUrl = null;

      try {
        const info = await resolveYouTubeAudioFormat(ytId);
        metaTitle = metaTitle || info.title;
        metaArtist = metaArtist || info.author;
        thumbnail = info.thumbnail || thumbnail;
        resolvedUrl = info.url;
      } catch (_) {
        metaTitle = metaTitle || `YouTube Track (${ytId})`;
        metaArtist = metaArtist || 'YouTube Music';
      }

      const newSong = {
        id: `song-${Date.now()}`,
        title: metaTitle,
        artist: metaArtist,
        youtubeId: ytId,
        audioUrl: resolvedUrl,
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

      if (resolvedUrl) {
        downloadToBuffer(resolvedUrl)
          .then(({ buffer, mimeType }) => cacheAudioBuffer(newSong.id, buffer, mimeType))
          .catch(() => {});
      }
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
      downloadToBuffer(raw)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(newSong.id, buffer, mimeType))
        .catch(() => {});
      return res.status(201).json(newSong);
    }

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
      downloadToBuffer(best.audioUrl)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(newSong.id, buffer, mimeType))
        .catch(() => {});
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
 * ENDPOINT STREAM ÂM THANH KHÔNG CHỜ (NON-BLOCKING INSTANT HTTP 206 CHO IPHONE):
 * Chấp nhận cả /api/stream/:id và /api/stream/:id.m4a (đuôi .m4a giúp iOS AVURLAsset mở khóa phần cứng mediaserverd).
 */
app.get('/api/stream/:rawParam', async (req, res) => {
  const idOrVideoId = req.params.rawParam.replace(/\.(m4a|mp3|wav)$/i, '');
  const song = db.songs.find((s) => s.id === idOrVideoId || s.youtubeId === idOrVideoId);
  const cacheKey = song ? song.id : idOrVideoId;

  try {
    // 1. Nếu đã có trong RAM Buffer -> Phục vụ HTTP 206 trong < 1ms!
    if (audioBufferCache.has(cacheKey)) {
      const cached = audioBufferCache.get(cacheKey);
      return serveBufferWithIosRange(req, res, cached.buffer, cached.mimeType);
    }

    // 2. Nếu là bài nội bộ mặc định
    if (song?.audioUrl === 'internal://warm-lofi') {
      return serveBufferWithIosRange(req, res, INSTANT_FALLBACK_WAV, 'audio/wav');
    }

    // 3. Xác định URL luồng âm thanh
    let targetUrl = song?.audioUrl || null;
    let mimeType = 'audio/mp4';

    if (song?.youtubeId) {
      const ytInfo = await resolveYouTubeAudioFormat(song.youtubeId);
      targetUrl = ytInfo.url;
      mimeType = ytInfo.mimeType || 'audio/mp4';
    } else if (!targetUrl && /^[a-zA-Z0-9_-]{11}$/.test(idOrVideoId)) {
      const ytInfo = await resolveYouTubeAudioFormat(idOrVideoId);
      targetUrl = ytInfo.url;
      mimeType = ytInfo.mimeType || 'audio/mp4';
    }

    if (!targetUrl || !targetUrl.startsWith('http')) {
      return serveBufferWithIosRange(req, res, INSTANT_FALLBACK_WAV, 'audio/wav');
    }

    // Bắt đầu nạp ngầm vào RAM cho các lần tua hoặc phát sau (KHÔNG CHỜ để tránh làm iPhone bị timeout!)
    downloadToBuffer(targetUrl)
      .then(({ buffer, mimeType: m }) => cacheAudioBuffer(cacheKey, buffer, m))
      .catch(() => {});

    // 4. Proxy trực tiếp từng byte kèm header 206 Partial Content ngay tức khắc (< 50ms)
    const parsedTarget = new URL(targetUrl);
    const isHttps = parsedTarget.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const reqHeaders = {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      Accept: '*/*',
      Connection: 'keep-alive',
      Range: req.headers.range || 'bytes=0-'
    };

    const proxyReq = client.get(parsedTarget, { headers: reqHeaders, agent }, (proxyRes) => {
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        proxyRes.resume();
        return serveBufferWithIosRange(req, res, INSTANT_FALLBACK_WAV, 'audio/wav');
      }

      const upstreamType = (proxyRes.headers['content-type'] || mimeType).split(';')[0];
      const finalMime = upstreamType.includes('audio/x-m4a') ? 'audio/mp4' : upstreamType;

      const resHeaders = {
        'Content-Type': finalMime,
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

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        serveBufferWithIosRange(req, res, INSTANT_FALLBACK_WAV, 'audio/wav');
      }
    });

    req.on('close', () => proxyReq.destroy());
  } catch (err) {
    if (!res.headersSent) {
      return serveBufferWithIosRange(req, res, INSTANT_FALLBACK_WAV, 'audio/wav');
    }
  }
});

// Phục vụ client/dist nếu đã build
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
  console.log(`🍏 NOCTRA v4.0 Server (iPhone Lock-Screen Engine): http://localhost:${PORT}`);
  console.log(`📱 Mở trực tiếp bằng trình duyệt SAFARI trên iPhone tại:`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
