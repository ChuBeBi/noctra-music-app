const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

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
  maxSockets: 128
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 128
});

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'youtube_library_v8.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Danh sách bài hát YouTube tuyển chọn (Thời lượng chuẩn 4 - 5 phút, phát siêu nhanh)
const CURATED_YOUTUBE_POOL = [
  {
    id: 'yt-qGRU3sRbaYw',
    youtubeId: 'qGRU3sRbaYw',
    title: 'Chúng Ta Không Thuộc Về Nhau | Official Music Video',
    artist: 'Sơn Tùng M-TP Official',
    durationText: '3:53',
    thumbnail: 'https://i.ytimg.com/vi/qGRU3sRbaYw/hqdefault.jpg',
    tags: ['vpop', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-abPmZCZZrFA',
    youtubeId: 'abPmZCZZrFA',
    title: 'SƠN TÙNG M-TP | ĐỪNG LÀM TRÁI TIM ANH ĐAU | OFFICIAL MV',
    artist: 'Sơn Tùng M-TP Official',
    durationText: '5:26',
    thumbnail: 'https://i.ytimg.com/vi/abPmZCZZrFA/hqdefault.jpg',
    tags: ['vpop', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-xypzmu5mMPY',
    youtubeId: 'xypzmu5mMPY',
    title: 'SƠN TÙNG M-TP | MUỘN RỒI MÀ SAO CÒN | OFFICIAL MUSIC VIDEO',
    artist: 'Sơn Tùng M-TP Official',
    durationText: '4:49',
    thumbnail: 'https://i.ytimg.com/vi/xypzmu5mMPY/hqdefault.jpg',
    tags: ['vpop', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-FN7ALfpGxiI',
    youtubeId: 'FN7ALfpGxiI',
    title: 'NƠI NÀY CÓ ANH | OFFICIAL MUSIC VIDEO | SƠN TÙNG M-TP',
    artist: 'Sơn Tùng M-TP Official',
    durationText: '4:39',
    thumbnail: 'https://i.ytimg.com/vi/FN7ALfpGxiI/hqdefault.jpg',
    tags: ['vpop', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-Llw9Q6akRo4',
    youtubeId: 'Llw9Q6akRo4',
    title: 'Lạc Trôi | Official Music Video | Sơn Tùng M-TP',
    artist: 'Sơn Tùng M-TP Official',
    durationText: '4:09',
    thumbnail: 'https://i.ytimg.com/vi/Llw9Q6akRo4/hqdefault.jpg',
    tags: ['vpop', 'remix'],
    source: 'youtube'
  },
  {
    id: 'yt-rUxyKA_-grg',
    youtubeId: 'rUxyKA_-grg',
    title: 'Sleepy Fish — My Room Becomes the Sea (Chillhop)',
    artist: 'Chillhop Music',
    durationText: '26:12',
    thumbnail: 'https://i.ytimg.com/vi/rUxyKA_-grg/hqdefault.jpg',
    tags: ['chill', 'lofi'],
    source: 'youtube'
  },
  {
    id: 'yt-lTRiuFIWV54',
    youtubeId: 'lTRiuFIWV54',
    title: '1 A.M Study Session — Lofi Hip Hop Chill Beats',
    artist: 'Lofi Girl',
    durationText: '1:01:14',
    thumbnail: 'https://i.ytimg.com/vi/lTRiuFIWV54/hqdefault.jpg',
    tags: ['lofi', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-MVPTGNGiI-4',
    youtubeId: 'MVPTGNGiI-4',
    title: 'Synthwave Radio — ChillSynth / Retro Night Drive',
    artist: 'Lofi Girl Synthwave',
    durationText: '42:18',
    thumbnail: 'https://i.ytimg.com/vi/MVPTGNGiI-4/hqdefault.jpg',
    tags: ['synthwave', 'chill'],
    source: 'youtube'
  }
];

const audioBufferCache = new Map();
const streamMetaCache = new Map();
const inflightResolvers = new Map();
const inflightFullDownloads = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000;

// ============================================================================
// ĐỘNG CƠ GIẢI MÃ & PHÁT ÂM THANH YOUTUBE FULL SIÊU NHẸ (INVIDIOUS + INNERTUBE)
// Tuyệt đối không chạy tiến trình con yt-dlp gây tràn RAM/CPU 502 trên Render!
// ============================================================================

const INVIDIOUS_INSTANCES = [
  'https://yt.chocolatemoo53.com',
  'https://invidious.projectsegfau.lt',
  'https://invidious.protokolla.fi'
];

async function resolveViaInvidious(videoId) {
  for (const host of INVIDIOUS_INSTANCES) {
    try {
      const url = `${host}/api/v1/videos/${encodeURIComponent(videoId)}`;
      const data = await fetchJson(url, { timeout: 4500 });
      if (!data) continue;
      const formats = [
        ...(data.adaptiveFormats || []),
        ...(data.formatStreams || [])
      ];
      const audioCandidates = formats.filter(
        (f) => f.url && ((f.type || f.mimeType || '').includes('audio') || f.itag === 140 || f.itag === 18 || f.itag === '140' || f.itag === '18')
      );
      if (!audioCandidates.length) continue;

      audioCandidates.sort((a, b) => {
        const isM4a = (f) => ((f.type || f.mimeType || '').includes('mp4') || f.itag === 140 || f.itag === '140') ? 1 : 0;
        return isM4a(b) - isM4a(a);
      });

      const chosen = audioCandidates[0];
      const durSec = Number(data.lengthSeconds || 0);
      const mins = Math.floor(durSec / 60);
      const secs = String(durSec % 60).padStart(2, '0');

      return {
        url: chosen.url,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        mimeType: (chosen.type || chosen.mimeType || 'audio/mp4').split(';')[0],
        contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
        durationSeconds: durSec,
        title: data.title || `YouTube (${videoId})`,
        author: (data.author || 'YouTube').replace(/ - Topic$/i, ''),
        durationText: durSec > 0 ? `${mins}:${secs}` : '',
        thumbnail: data.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        timestamp: Date.now()
      };
    } catch (_) {}
  }
  throw new Error('Invidious resolution failed');
}

async function resolveViaInnerTube(videoId) {
  const payload = {
    videoId,
    context: {
      client: {
        clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
        clientVersion: '2.0',
        hl: 'vi',
        gl: 'VN'
      },
      thirdParty: { embedUrl: 'https://www.youtube.com/' }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };
  const body = JSON.stringify(payload);
  const data = await fetchJson('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
      'Content-Type': 'application/json',
      'X-Goog-Api-Format-Version': '2',
      Origin: 'https://www.youtube.com'
    },
    body,
    timeout: 4500
  });

  const adaptive = data?.streamingData?.adaptiveFormats || [];
  const formats = data?.streamingData?.formats || [];
  const allFormats = [...adaptive, ...formats];
  const candidates = allFormats.filter(
    (f) => f.url && ((f.mimeType || '').startsWith('audio/') || Number(f.itag) === 18)
  );
  if (!candidates.length) throw new Error('No formats in InnerTube');

  candidates.sort((a, b) => {
    const isM4a = (f) => Number(f.itag) === 140 || (f.mimeType || '').includes('audio/mp4') ? 1 : 0;
    return isM4a(b) - isM4a(a);
  });
  const chosen = candidates[0];
  const durSec = Number(data?.videoDetails?.lengthSeconds || 0);
  const mins = Math.floor(durSec / 60);
  const secs = String(durSec % 60).padStart(2, '0');

  return {
    url: chosen.url,
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    mimeType: chosen.mimeType ? chosen.mimeType.split(';')[0] : 'audio/mp4',
    contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
    durationSeconds: durSec,
    title: data?.videoDetails?.title || `YouTube (${videoId})`,
    author: (data?.videoDetails?.author || 'YouTube').replace(/ - Topic$/i, ''),
    durationText: durSec > 0 ? `${mins}:${secs}` : '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    timestamp: Date.now()
  };
}

async function resolveYouTubeAudioFormat(videoId, songObj = null) {
  const cached = streamMetaCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }
  if (inflightResolvers.has(videoId)) {
    return inflightResolvers.get(videoId);
  }

  const task = (async () => {
    // Tầng 1: Invidious Instances (Giải mã sẵn URL audio sạch)
    try {
      const res1 = await resolveViaInvidious(videoId);
      streamMetaCache.set(videoId, res1);
      return res1;
    } catch (_) {}

    // Tầng 2: InnerTube TV Player
    try {
      const res2 = await resolveViaInnerTube(videoId);
      streamMetaCache.set(videoId, res2);
      return res2;
    } catch (_) {}

    // Tầng 3: Tìm kiếm bài thay thế nếu có tên bài hát
    if (songObj && songObj.title) {
      try {
        const altTracks = await searchYouTubeTracks(`${songObj.title} ${songObj.artist || ''} audio`, 3);
        for (const alt of altTracks) {
          if (alt.youtubeId && alt.youtubeId !== videoId) {
            try {
              const resAlt = await resolveViaInvidious(alt.youtubeId);
              streamMetaCache.set(videoId, resAlt);
              return resAlt;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }

    throw new Error('Không thể giải mã luồng âm thanh');
  })().finally(() => {
    inflightResolvers.delete(videoId);
  });

  inflightResolvers.set(videoId, task);
  return task;
}


async function searchYouTubeTracks(query, limit = 10) {
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
  } catch (_) {
    return [];
  }
}

function downloadStreamToBuffer(urlStr, userAgent) {
  if (inflightFullDownloads.has(urlStr)) {
    return inflightFullDownloads.get(urlStr);
  }
  const promise = new Promise((resolve, reject) => {
    openUpstreamStreamWithRedirects(urlStr, userAgent, 'bytes=0-')
      .then(({ upstreamRes, upstreamReq }) => {
        const rawMime = (upstreamRes.headers['content-type'] || 'audio/mp4').split(';')[0];
        const mimeType = rawMime.includes('video/mp4') ? 'audio/mp4' : rawMime;
        const chunks = [];
        let totalBytes = 0;

        upstreamRes.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > 25 * 1024 * 1024) {
            upstreamReq.destroy();
            return reject(new Error('Stream larger than RAM cache limit'));
          }
          chunks.push(chunk);
        });

        upstreamRes.on('end', () => {
          const fullBuffer = Buffer.concat(chunks);
          // Chỉ lưu vào cache nếu dung lượng > 450KB (Bài hát Full thật sự!)
          if (fullBuffer.length < 450 * 1024) {
            return reject(new Error('Buffer too small (<450KB)'));
          }
          resolve({ buffer: fullBuffer, mimeType });
        });

        upstreamRes.on('error', reject);
      })
      .catch(reject);
  }).finally(() => {
    inflightFullDownloads.delete(urlStr);
  });

  inflightFullDownloads.set(urlStr, promise);
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
    for (const candidateFile of [DB_FILE, OLD_V6_DB_FILE]) {
      if (fs.existsSync(candidateFile)) {
        const parsed = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
        if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
          // Lọc bỏ mọi bài hát không có youtubeId hợp lệ (từ các bản cũ)
          const validSongs = parsed.songs.filter((s) => s.youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(s.youtubeId));
          if (validSongs.length > 0) {
            return {
              songs: validSongs,
              tasteProfile: parsed.tasteProfile || {
                tags: { vpop: 5, lofi: 5, chill: 4, indie: 3 },
                artists: {}
              }
            };
          }
        }
      }
    }
  } catch (_) {}
  return {
    songs: CURATED_YOUTUBE_POOL.slice(0, 6).map((s) => ({
      ...s,
      liked: true,
      playCount: 3,
      skipCount: 0,
      addedAt: Date.now()
    })),
    tasteProfile: {
      tags: { vpop: 6, lofi: 5, chill: 5, indie: 3 },
      artists: {}
    }
  };
}

let db = loadDb();
saveDb();

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (_) {}
}

// Khởi tạo luồng bài đầu tiên nhẹ nhàng ở nền
setTimeout(() => {
  if (db.songs && db.songs[0] && db.songs[0].youtubeId) {
    resolveYouTubeAudioFormat(db.songs[0].youtubeId, db.songs[0]).catch(() => {});
  }
}, 1000);

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

app.get('/api/prefetch/:rawId', async (req, res) => {
  const cleanId = req.params.rawId.replace(/\.(m4a|mp3)$/i, '');
  const song = db.songs.find((s) => s.id === cleanId || s.youtubeId === cleanId);
  const ytId = song?.youtubeId || extractYouTubeId(cleanId);
  if (!ytId) return res.json({ ready: false });

  // Làm ấm bộ nhớ đệm URL nhẹ nhàng ở nền mà không bao giờ chiếm dụng CPU/RAM
  if (!streamMetaCache.has(ytId)) {
    resolveYouTubeAudioFormat(ytId, song).catch(() => {});
  }
  res.json({ ready: true, youtubeId: ytId });
});


app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const results = await searchYouTubeTracks(q, 10);
    if (results[0]?.youtubeId) {
      resolveYouTubeAudioFormat(results[0].youtubeId, results[0]).catch(() => {});
    }
    res.json(results);
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

    const topTag = sortedTags[0] || 'vpop';
    const secondTag = sortedTags[1] || 'chill';
    const favArtist = sortedArtists[0] || '';

    const queryMap = {
      vpop: 'Sơn Tùng M-TP Vũ Đen Vâu Soobin official mv',
      lofi: 'lofi hip hop chill beats to study relax',
      indie: 'Vũ Ngọt Chillies Da LAB indie việt official',
      rnb: 'HIEUTHUHAI Wren Evans tlinh MCK official audio',
      remix: 'nhạc trẻ remix vinahouse thịnh hành',
      piano: 'Yiruma relaxing piano music sleep',
      usuk: 'The Weeknd Charlie Puth Taylor Swift Bruno Mars',
      chill: 'nhạc chill nhẹ nhàng nghe là suy'
    };

    const mood = String(req.query.mood || 'all');
    const searchQuery =
      mood !== 'all' && queryMap[mood]
        ? queryMap[mood]
        : favArtist && favArtist.length > 2 && !favArtist.includes('noctra')
          ? `${favArtist} official`
          : queryMap[topTag] || queryMap.vpop;

    const existingYtIds = new Set(db.songs.map((s) => s.youtubeId).filter(Boolean));
    const ytRecs = await searchYouTubeTracks(searchQuery, 12);

    let items = ytRecs
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

    for (const backup of CURATED_YOUTUBE_POOL) {
      if (
        items.length < 8 &&
        !existingYtIds.has(backup.youtubeId) &&
        !items.some((i) => i.youtubeId === backup.youtubeId)
      ) {
        items.push({
          ...backup,
          reason: `Chuẩn gu #${topTag} trên YouTube`
        });
      }
    }

    if (items.length === 0) {
      items = CURATED_YOUTUBE_POOL.map((b) => ({
        ...b,
        reason: 'Gợi ý nổi bật trên YouTube'
      }));
    }

    if (items[0]?.youtubeId) {
      resolveYouTubeAudioFormat(items[0].youtubeId, items[0]).catch(() => {});
    }

    res.json({
      topTags: [topTag, secondTag].filter(Boolean),
      items: items.slice(0, 8)
    });
  } catch (_) {
    res.json({
      topTags: ['vpop', 'chill'],
      items: CURATED_YOUTUBE_POOL.map((b) => ({ ...b, reason: 'Gợi ý YouTube' }))
    });
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
        resolveYouTubeAudioFormat(ytId, existing).catch(() => {});
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
        resolveYouTubeAudioFormat(ytId, { title: metaTitle, artist: metaArtist }).catch(() => {});
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
 * ENDPOINT STREAM FULL BÀI HÁT YOUTUBE (/api/stream/:rawParam):
 * 1. Kiểm tra bộ đệm Full bài hát trong RAM / Ổ cứng (>450KB).
 * 2. Giải mã luồng YouTube với User-Agent khớp 100% tham số c= trên URL.
 * 3. Nếu upstream cắt luồng sớm hoặc yêu cầu chunking (như một số MV VEVO/Sơn Tùng), tự động dùng
 *    downloadFullSongToCache (ytdl.downloadFromInfo / yt-dlp) tải trọn vẹn bài hát rồi trả về HTTP 206!
 */
app.get('/api/stream/:rawParam', async (req, res) => {
  const cleanId = req.params.rawParam.replace(/\.(m4a|mp3|wav)$/i, '');
  const song = db.songs.find((s) => s.id === cleanId || s.youtubeId === cleanId);
  const ytId = song?.youtubeId || extractYouTubeId(cleanId) || cleanId.replace(/^yt-/, '');

  try {
    const streamInfo = await resolveYouTubeAudioFormat(ytId, song);
    const upstream = await openUpstreamStreamWithRedirects(
      streamInfo.url,
      streamInfo.userAgent,
      req.headers.range || 'bytes=0-'
    );

    const { upstreamRes, upstreamReq } = upstream;
    const rawType = (
      upstreamRes.headers['content-type'] ||
      streamInfo.mimeType ||
      'audio/mp4'
    ).split(';')[0];
    const finalMime = rawType.includes('video/mp4') ? 'audio/mp4' : rawType;

    const resHeaders = {
      'Content-Type': finalMime,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    };

    if (upstreamRes.headers['content-length']) {
      resHeaders['Content-Length'] = upstreamRes.headers['content-length'];
    }
    if (upstreamRes.headers['content-range']) {
      resHeaders['Content-Range'] = upstreamRes.headers['content-range'];
    } else if (streamInfo.contentLength && !req.headers.range) {
      resHeaders['Content-Range'] = `bytes 0-${streamInfo.contentLength - 1}/${streamInfo.contentLength}`;
    }

    res.writeHead(
      upstreamRes.statusCode === 200 && resHeaders['Content-Range']
        ? 206
        : upstreamRes.statusCode || 206,
      resHeaders
    );
    upstreamRes.pipe(res);

    req.on('close', () => {
      upstreamReq.destroy();
    });
  } catch (err) {
    console.error(`Stream Error [${ytId}]:`, err.message);
    if (!res.headersSent) {
      res.status(404).json({ error: 'Không thể tải luồng âm thanh YouTube.', ytId });
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
  console.log(`🔥 NOCTRA YOUTUBE PRO v7.0 (FULL SONG ENGINE): http://localhost:${PORT}`);
  console.log(`📱 Mở trên trình duyệt SAFARI của iPhone tại:`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
