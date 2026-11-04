const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Tối ưu kết nối TCP/TLS Keep-Alive để giảm độ trễ bắt tay khi iPhone tua nhạc hoặc chuyển bài
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

// Lưu trữ bền vững thư viện & hồ sơ gu âm nhạc vào file JSON
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'library.json');

const DEFAULT_SONGS = [
  {
    id: 'song-1',
    title: 'Lofi Study Beats — Late Night Chill',
    artist: 'Noctra Lofi Sessions',
    youtubeId: 'jfKfPfyJRdk',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3',
    thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
    tags: ['lofi', 'chill', 'focus', 'instrumental'],
    liked: true,
    playCount: 5,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 24
  },
  {
    id: 'song-2',
    title: 'Midnight City Drive — Synthwave Retro',
    artist: 'Noctra Synth',
    youtubeId: '4xDzrJKXOOY',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc6eb4c.mp3',
    thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg',
    tags: ['synthwave', 'electronic', 'night', 'chill'],
    liked: false,
    playCount: 3,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 12
  },
  {
    id: 'song-3',
    title: 'Ambient Piano & Rain — Deep Relax',
    artist: 'Noctra Acoustic',
    youtubeId: 'DWcJFNfaw9c',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3',
    thumbnail: 'https://i.ytimg.com/vi/DWcJFNfaw9c/hqdefault.jpg',
    tags: ['piano', 'ambient', 'sleep', 'relax'],
    liked: true,
    playCount: 4,
    skipCount: 0,
    addedAt: Date.now() - 3600000 * 6
  }
];

// Kho nhạc đề xuất đa dạng theo các gu (V-Pop, Indie, Lofi, R&B, US-UK, Acoustic, Synthwave, Piano)
const CURATED_CATALOG = [
  {
    youtubeId: '5qap5aO4i9A',
    title: 'ChilledCow Lofi Hip Hop Mix — Beats to Relax',
    artist: 'Lofi Girl',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3',
    thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
    tags: ['lofi', 'chill', 'focus', 'study']
  },
  {
    youtubeId: 'n61ULEU7CO0',
    title: 'Best of Lofi Hip Hop 2024 — Cozy Rain Vibes',
    artist: 'Chillhop Music',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/08/02/audio_884fe92c21.mp3',
    thumbnail: 'https://i.ytimg.com/vi/n61ULEU7CO0/hqdefault.jpg',
    tags: ['lofi', 'chill', 'rain', 'cozy']
  },
  {
    youtubeId: 'MVPTGNGiI-4',
    title: 'Synthwave Radio — ChillSynth / Retro Future',
    artist: 'Lofi Girl Synthwave',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc6eb4c.mp3',
    thumbnail: 'https://i.ytimg.com/vi/MVPTGNGiI-4/hqdefault.jpg',
    tags: ['synthwave', 'electronic', 'night', 'drive']
  },
  {
    youtubeId: 'lTRiuFIWV54',
    title: '1 A.M Study Session — Calm Lofi Beats',
    artist: 'Lofi Girl',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3',
    thumbnail: 'https://i.ytimg.com/vi/lTRiuFIWV54/hqdefault.jpg',
    tags: ['lofi', 'night', 'study', 'focus']
  },
  {
    youtubeId: '7NOSDKb0HlU',
    title: 'Warm Coffee Jazz & Bossa Nova Instrumental',
    artist: 'Cafe Music BGM',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3',
    thumbnail: 'https://i.ytimg.com/vi/7NOSDKb0HlU/hqdefault.jpg',
    tags: ['jazz', 'acoustic', 'relax', 'morning']
  },
  {
    youtubeId: 'rUxyKA_-grg',
    title: 'Sleepy Fish — Pastel Memories (Chillhop)',
    artist: 'Chillhop Essentials',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/16/audio_b8c9103636.mp3',
    thumbnail: 'https://i.ytimg.com/vi/rUxyKA_-grg/hqdefault.jpg',
    tags: ['chill', 'lofi', 'sleep', 'ambient']
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
          tasteProfile: parsed.tasteProfile || { tags: {}, artists: {}, keywords: {} }
        };
      }
    }
  } catch (e) {
    console.warn('Khởi tạo DB mặc định:', e.message);
  }
  return {
    songs: DEFAULT_SONGS,
    tasteProfile: {
      tags: { lofi: 5, chill: 4, piano: 3, synthwave: 2 },
      artists: {},
      keywords: {}
    }
  };
}

let db = loadDb();

function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.warn('Không thể lưu DB:', e.message);
  }
}

// Bộ nhớ đệm URL luồng âm thanh + In-flight promise deduplication
const streamCache = new Map();
const inflightResolvers = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000; // 25 phút

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
    ['vpop', ['vpop', 'v-pop', 'nhạc trẻ', 'việt', 'ballad', 'sơn tùng', 'đen vâu', 'vũ', 'hieuthuhai', 'soobin', 'bích phương', 'amee', 'tlinh', 'mck', 'wren evans']],
    ['indie', ['indie', 'acoustic', 'guitar', 'mộc', 'ngọt', 'cá hồi hoang', 'chillies', 'da lab']],
    ['remix', ['remix', 'vinahouse', 'edm', 'club', 'dj', 'bass', 'house', 'techno']],
    ['rnb', ['r&b', 'rnb', 'soul', 'hiphop', 'rap']],
    ['piano', ['piano', 'classical', 'instrumental', 'không lời', 'violin']],
    ['synthwave', ['synthwave', 'retro', 'cyberpunk', '80s', 'night drive']],
    ['sleep', ['sleep', 'rain', 'ambient', 'ngủ', 'meditation', 'healing']],
    ['usuk', ['pop', 'taylor', 'weeknd', 'billie', 'charlie puth', 'ariana', 'justin', 'ed sheeran']]
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

// Hàm gọi HTTPS JSON nhanh không cần thư viện ngoài
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

// Tầng dự phòng: Lấy luồng âm thanh qua hệ thống Piped API công cộng
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
            duration: data.duration || 0,
            timestamp: Date.now()
          };
        }
      }
    } catch (_) {}
  }
  throw new Error('Piped fallback unavailable');
}

// Giải mã luồng âm thanh tốc độ cao (ưu tiên m4a/mp4a cho phần cứng iPhone + khử trùng lặp request)
async function resolveYouTubeAudioFormat(videoId) {
  const cached = streamCache.get(videoId);
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
        duration: Number(info.videoDetails?.lengthSeconds || 0),
        timestamp: Date.now()
      };

      streamCache.set(videoId, resolved);
      return resolved;
    } catch (primaryErr) {
      const fallbackResolved = await resolveViaPipedFallback(videoId);
      streamCache.set(videoId, fallbackResolved);
      return fallbackResolved;
    } finally {
      inflightResolvers.delete(videoId);
    }
  })();

  inflightResolvers.set(videoId, task);
  return task;
}

// Tìm kiếm bài hát trực tiếp trên YouTube (InnerTube API gốc — không cần API Key)
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
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    body,
    timeout: 6500
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
        title,
        artist,
        durationText,
        thumbnail,
        tags: inferTagsFromText(title, artist)
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return results;
}

// Cập nhật điểm Gu âm nhạc của người dùng dựa trên tương tác thực tế
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
  const tags = Array.isArray(song.tags) && song.tags.length
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
// CÁC API ENDPOINTS
// ============================================================================

// 1. Lấy danh sách bài hát trong thư viện
app.get('/api/songs', (req, res) => {
  res.json(db.songs);
});

// 2. Pre-warm / Nạp trước luồng âm thanh bài sắp phát
app.get('/api/prefetch/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const info = await resolveYouTubeAudioFormat(videoId);
    res.json({
      ready: true,
      videoId,
      mimeType: info.mimeType,
      title: info.title
    });
  } catch (err) {
    res.json({ ready: false, videoId });
  }
});

// 3. Tìm kiếm bài hát trực tiếp trên YouTube ngay trong ứng dụng
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const results = await searchYouTubeTracks(q, 10);
    if (results[0]?.youtubeId) {
      resolveYouTubeAudioFormat(results[0].youtubeId).catch(() => {});
    }
    res.json(results);
  } catch (err) {
    console.warn('Search fallback:', err.message);
    const filtered = CURATED_CATALOG.filter(
      (item) =>
        item.title.toLowerCase().includes(q.toLowerCase()) ||
        item.artist.toLowerCase().includes(q.toLowerCase())
    );
    res.json(filtered);
  }
});

// 4. Đề xuất bài hát thông minh dựa trên Gu người dùng + Khung giờ trong ngày
app.get('/api/recommendations', async (req, res) => {
  try {
    const hour = new Date().getHours();
    const timeMoodTag =
      hour >= 22 || hour < 6
        ? 'sleep'
        : hour >= 6 && hour < 11
          ? 'acoustic'
          : hour >= 11 && hour < 18
            ? 'lofi'
            : 'chill';

    const sortedTags = Object.entries(db.tasteProfile.tags || {})
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
    const sortedArtists = Object.entries(db.tasteProfile.artists || {})
      .sort((a, b) => b[1] - a[1])
      .map(([a]) => a);

    const topTag = sortedTags[0] || timeMoodTag;
    const secondTag = sortedTags[1] || timeMoodTag;
    const favArtist = sortedArtists[0] || '';

    const existingIds = new Set(db.songs.map((s) => s.youtubeId).filter(Boolean));
    let recs = [];

    const queryMap = {
      vpop: 'nhạc trẻ vpop chill hay nhất',
      indie: 'indie việt acoustic chill',
      lofi: 'lofi hip hop chill beats study',
      remix: 'nhạc trẻ remix bass cực căng',
      rnb: 'r&b chill vibes playlist',
      piano: 'relaxing piano music study sleep',
      synthwave: 'synthwave chill retro night drive',
      sleep: 'ambient rain lofi deep sleep',
      usuk: 'us uk pop chill hits acoustic',
      chill: 'lofi chillhop cozy beats'
    };

    const searchQuery =
      req.query.mood && queryMap[req.query.mood]
        ? queryMap[req.query.mood]
        : favArtist && !favArtist.includes('noctra')
          ? `${favArtist} official audio`
          : queryMap[topTag] || 'lofi chill beats';

    try {
      const liveResults = await searchYouTubeTracks(searchQuery, 8);
      for (const item of liveResults) {
        if (!existingIds.has(item.youtubeId)) {
          recs.push({
            ...item,
            reason:
              req.query.mood
                ? `Theo tâm trạng #${req.query.mood}`
                : favArtist && !favArtist.includes('noctra')
                  ? `Vì bạn hay nghe ${favArtist}`
                  : `Hợp gu #${topTag} của bạn`
          });
        }
      }
    } catch (_) {}

    for (const item of CURATED_CATALOG) {
      if (!existingIds.has(item.youtubeId) && !recs.some((r) => r.youtubeId === item.youtubeId)) {
        const matchScore = item.tags.reduce(
          (acc, t) => acc + (db.tasteProfile.tags[t] || 0),
          item.tags.includes(timeMoodTag) ? 3 : 0
        );
        recs.push({
          ...item,
          score: matchScore,
          reason: item.tags.includes(topTag)
            ? `Chuẩn gu #${topTag} bạn thích`
            : `Gợi ý cho khung giờ hiện tại`
        });
      }
    }

    if (recs[0]?.youtubeId) {
      resolveYouTubeAudioFormat(recs[0].youtubeId).catch(() => {});
    }

    res.json({
      topTags: [topTag, secondTag].filter(Boolean),
      timeMoodTag,
      items: recs.slice(0, 8)
    });
  } catch (err) {
    res.json({
      topTags: ['lofi', 'chill'],
      timeMoodTag: 'chill',
      items: CURATED_CATALOG
    });
  }
});

// 5. Ghi nhận tín hiệu Gu người dùng
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

// 6. Thêm bài hát mới
app.post('/api/songs', async (req, res) => {
  try {
    const { title, artist, urlOrId, thumbnail: customThumb, tags: customTags } = req.body || {};
    if (!urlOrId || !String(urlOrId).trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập tên bài hát, URL YouTube hoặc link MP3/M4A.' });
    }

    const raw = String(urlOrId).trim();
    const ytId = extractYouTubeId(raw);

    if (ytId) {
      const existingIdx = db.songs.findIndex((s) => s.youtubeId === ytId);
      if (existingIdx !== -1) {
        const [existingSong] = db.songs.splice(existingIdx, 1);
        db.songs.unshift(existingSong);
        saveDb();
        resolveYouTubeAudioFormat(ytId).catch(() => {});
        return res.status(200).json(existingSong);
      }

      let metaTitle = title?.trim();
      let metaArtist = artist?.trim();
      let thumbnail = customThumb || `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

      if (!metaTitle || !metaArtist) {
        try {
          const info = await resolveYouTubeAudioFormat(ytId);
          metaTitle = metaTitle || info.title;
          metaArtist = metaArtist || info.author;
          thumbnail = info.thumbnail || thumbnail;
        } catch (_) {
          metaTitle = metaTitle || `YouTube Track (${ytId})`;
          metaArtist = metaArtist || 'YouTube Music';
        }
      } else {
        resolveYouTubeAudioFormat(ytId).catch(() => {});
      }

      const newSong = {
        id: `song-${Date.now()}`,
        title: metaTitle,
        artist: metaArtist,
        youtubeId: ytId,
        audioUrl: null,
        thumbnail,
        tags: Array.isArray(customTags) && customTags.length
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
      const metaTitle = title?.trim() || 'Bản nhạc Audio trực tiếp';
      const metaArtist = artist?.trim() || 'Direct Stream';
      const newSong = {
        id: `song-${Date.now()}`,
        title: metaTitle,
        artist: metaArtist,
        youtubeId: null,
        audioUrl: raw,
        thumbnail:
          customThumb ||
          'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80',
        tags: inferTagsFromText(metaTitle, metaArtist),
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

    const searched = await searchYouTubeTracks(raw, 1);
    if (searched.length > 0) {
      const best = searched[0];
      resolveYouTubeAudioFormat(best.youtubeId).catch(() => {});
      const newSong = {
        id: `song-${Date.now()}`,
        title: best.title,
        artist: best.artist,
        youtubeId: best.youtubeId,
        audioUrl: null,
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
 * 7. Endpoint Stream Audio chuẩn iOS Safari (Hỗ trợ HTTP 206 Partial Content + Keep-Alive + Fallback):
 */
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const streamInfo = await resolveYouTubeAudioFormat(videoId);
    const targetUrl = new URL(streamInfo.url);
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

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
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        streamCache.delete(videoId);
        const fallbackSong =
          db.songs.find((s) => s.youtubeId === videoId && s.audioUrl) ||
          CURATED_CATALOG.find((s) => s.youtubeId === videoId && s.audioUrl);
        if (fallbackSong && !res.headersSent) {
          return res.redirect(fallbackSong.audioUrl);
        }
      }

      const responseHeaders = {
        'Content-Type': streamInfo.mimeType || 'audio/mp4',
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
      streamCache.delete(videoId);
      if (!res.headersSent) {
        const fallbackSong = db.songs.find((s) => s.youtubeId === videoId && s.audioUrl);
        if (fallbackSong) return res.redirect(fallbackSong.audioUrl);
        res.status(502).json({ error: 'Gián đoạn kết nối luồng âm thanh.' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    const fallbackSong =
      db.songs.find((s) => s.youtubeId === videoId && s.audioUrl) ||
      CURATED_CATALOG.find((s) => s.youtubeId === videoId && s.audioUrl) ||
      DEFAULT_SONGS[0];
    if (fallbackSong && fallbackSong.audioUrl) {
      return res.redirect(fallbackSong.audioUrl);
    }
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

// Giải mã sẵn 3 bài đầu tiên ngay khi bật server để người dùng mở app bấm Play là phát tức thì
setTimeout(() => {
  db.songs.slice(0, 3).forEach((s) => {
    if (s.youtubeId) resolveYouTubeAudioFormat(s.youtubeId).catch(() => {});
  });
}, 500);

app.listen(PORT, () => {
  console.log(`NOCTRA PRO Server (iPhone Lock-Screen + Smart Taste Engine) đang chạy tại http://localhost:${PORT}`);
});
