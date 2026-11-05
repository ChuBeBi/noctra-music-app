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
const BIN_DIR = path.join(__dirname, '..', 'bin');
const DB_FILE = path.join(DATA_DIR, 'youtube_library_v6.json');
const OLD_V5_DB_FILE = path.join(DATA_DIR, 'youtube_library_v5.json');

// Tự động tải yt-dlp binary chính thức vào server/bin/ để giải mã mọi video YouTube khó nhất
const isWin = process.platform === 'win32';
const YT_DLP_PATH = path.join(BIN_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');

function ensureYtDlpBinary() {
  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    if (fs.existsSync(YT_DLP_PATH) && fs.statSync(YT_DLP_PATH).size > 1000000) {
      return;
    }
    const dlUrl = isWin
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

    const downloadBin = (urlStr, redirects = 5) => {
      if (redirects <= 0) return;
      const parsed = new URL(urlStr);
      https
        .get(
          parsed,
          {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              return downloadBin(new URL(res.headers.location, parsed).toString(), redirects - 1);
            }
            if (res.statusCode !== 200) {
              res.resume();
              return;
            }
            const tmpPath = YT_DLP_PATH + '.tmp';
            const fileStream = fs.createWriteStream(tmpPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
              fileStream.close(() => {
                try {
                  if (!isWin) fs.chmodSync(tmpPath, 0o755);
                  fs.renameSync(tmpPath, YT_DLP_PATH);
                  console.log('[OK] Đã tích hợp công cụ giải mã YouTube yt-dlp thành công!');
                } catch (_) {}
              });
            });
          }
        )
        .on('error', () => {});
    };
    downloadBin(dlUrl);
  } catch (_) {}
}
ensureYtDlpBinary();

// Kho bài hát YouTube tuyển chọn chất lượng cao (Đảm bảo tab Đề xuất YouTube không bao giờ bị 0 bài!)
const CURATED_YOUTUBE_POOL = [
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
    id: 'yt-n61ULEU7CO0',
    youtubeId: 'n61ULEU7CO0',
    title: 'Best of Lofi Hip Hop — Beats to Relax / Study to',
    artist: 'Lofi Girl',
    durationText: '2:19:57',
    thumbnail: 'https://i.ytimg.com/vi/n61ULEU7CO0/hqdefault.jpg',
    tags: ['lofi', 'chill'],
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
    id: 'yt-MVPTGNGiI-4',
    youtubeId: 'MVPTGNGiI-4',
    title: 'Synthwave Radio — ChillSynth / Retro Night Drive',
    artist: 'Lofi Girl Synthwave',
    durationText: '42:18',
    thumbnail: 'https://i.ytimg.com/vi/MVPTGNGiI-4/hqdefault.jpg',
    tags: ['synthwave', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-DWcJFNfaw9c',
    youtubeId: 'DWcJFNfaw9c',
    title: 'Ambient Study Music To Concentrate — Quiet Lofi',
    artist: 'Quiet Quest',
    durationText: '58:20',
    thumbnail: 'https://i.ytimg.com/vi/DWcJFNfaw9c/hqdefault.jpg',
    tags: ['piano', 'lofi'],
    source: 'youtube'
  },
  {
    id: 'yt-7NOSDKb0HlU',
    youtubeId: '7NOSDKb0HlU',
    title: 'Cozy Fall Coffee Shop — Relaxing Jazz & Bossa Nova',
    artist: 'Cafe Music BGM',
    durationText: '1:12:40',
    thumbnail: 'https://i.ytimg.com/vi/7NOSDKb0HlU/hqdefault.jpg',
    tags: ['piano', 'chill'],
    source: 'youtube'
  },
  {
    id: 'yt-5yx6BWlEVcY',
    youtubeId: '5yx6BWlEVcY',
    title: 'Chillhop Essentials — Jazzy & Lofi Hip Hop Beats',
    artist: 'Chillhop Music',
    durationText: '48:15',
    thumbnail: 'https://i.ytimg.com/vi/5yx6BWlEVcY/hqdefault.jpg',
    tags: ['lofi', 'rnb'],
    source: 'youtube'
  },
  {
    id: 'yt-f02mOEt11OQ',
    youtubeId: 'f02mOEt11OQ',
    title: 'Code-fi / Lofi Beats to Code & Relax To',
    artist: 'The AMP Channel',
    durationText: '59:42',
    thumbnail: 'https://i.ytimg.com/vi/f02mOEt11OQ/hqdefault.jpg',
    tags: ['lofi', 'chill'],
    source: 'youtube'
  }
];

const audioBufferCache = new Map();
const streamMetaCache = new Map();
const inflightResolvers = new Map();
const inflightDownloads = new Map();
const CACHE_TTL_MS = 25 * 60 * 1000;

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
        timeout: options.timeout || 6000
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
  if (/^yt-[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed.slice(3);
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
    ['vpop', ['vpop', 'v-pop', 'nhạc trẻ', 'việt', 'ballad', 'sơn tùng', 'đen vâu', 'vũ', 'hieuthuhai', 'soobin', 'bích phương', 'amee', 'tlinh', 'mck', 'wren evans', 'hà anh tuấn', 'phan mạnh quỳnh', 'caotri', 'dư âm', 'phố chill']],
    ['lofi', ['lofi', 'lo-fi', 'chillhop', 'study', 'beats', 'coffee', 'quán cafe']],
    ['indie', ['indie', 'acoustic', 'guitar', 'mộc', 'ngọt', 'cá hồi hoang', 'chillies', 'da lab', 'trang', 'thịnh suy']],
    ['remix', ['remix', 'vinahouse', 'edm', 'club', 'dj', 'bass', 'house', 'techno', 'nonstop']],
    ['rnb', ['r&b', 'rnb', 'soul', 'hiphop', 'rap', 'gerdnang', 'bray', 'karik', 'binz']],
    ['piano', ['piano', 'classical', 'instrumental', 'không lời', 'violin', 'yiruma']],
    ['usuk', ['pop', 'taylor', 'weeknd', 'billie', 'charlie puth', 'ariana', 'justin', 'ed sheeran', 'bruno mars']],
    ['chill', ['chill', 'relax', 'cozy', 'vibes', 'nhẹ nhàng', 'suy']]
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
 * HÀM KẾT NỐI STREAM TỰ ĐỘNG ĐI THEO MỌI TẦNG HTTP 301/302/307/308 REDIRECT CỦA GOOGLEVIDEO.COM:
 * Đây là chìa khóa sửa dứt điểm lỗi tự nhảy bài ở giây 0:00 trong video của bạn!
 */
function openUpstreamStreamWithRedirects(urlStr, userAgent, rangeHeader, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      return reject(new Error('Too many redirects'));
    }

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    const headers = {
      'User-Agent':
        userAgent ||
        'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      Accept: '*/*',
      Connection: 'keep-alive',
      Range: rangeHeader || 'bytes=0-'
    };

    const req = client.get(parsed, { headers, agent, timeout: 9000 }, (res) => {
      // Tự động đi theo 301 / 302 / 303 / 307 / 308 Redirect của googlevideo.com
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const nextUrl = new URL(res.headers.location, parsed).toString();
        res.resume();
        return resolve(
          openUpstreamStreamWithRedirects(nextUrl, userAgent, rangeHeader, redirectsLeft - 1)
        );
      }

      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`Upstream HTTP ${res.statusCode}`));
      }

      resolve({
        upstreamRes: res,
        upstreamReq: req,
        finalUrl: urlStr
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upstream connection timeout'));
    });
  });
}

// Kiểm tra nhanh 2 byte đầu tiên (Range: bytes=0-1) để chắc chắn 100% URL googlevideo.com sống và không bị 403
async function verifyStreamPlayable(urlStr, userAgent) {
  const { upstreamRes, upstreamReq, finalUrl } = await openUpstreamStreamWithRedirects(
    urlStr,
    userAgent,
    'bytes=0-1'
  );
  const contentRange = upstreamRes.headers['content-range'] || '';
  const contentType = (upstreamRes.headers['content-type'] || 'audio/mp4').split(';')[0];
  let totalLength = null;
  const match = contentRange.match(/\/(\d+)$/);
  if (match) {
    totalLength = parseInt(match[1], 10);
  } else if (upstreamRes.headers['content-length']) {
    totalLength = parseInt(upstreamRes.headers['content-length'], 10);
  }
  upstreamRes.resume();
  upstreamReq.destroy();
  return {
    finalUrl,
    mimeType: contentType.includes('video/mp4') ? 'audio/mp4' : contentType,
    contentLength: totalLength
  };
}

// Tầng 1: Giải mã bằng công cụ yt-dlp chính chủ (nếu đã tải xong trong server/bin)
function resolveViaYtDlpBinary(videoId) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(YT_DLP_PATH)) {
      return reject(new Error('yt-dlp binary not ready'));
    }
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    execFile(
      YT_DLP_PATH,
      [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '-f',
        '140/ba[ext=m4a]/ba/18',
        videoUrl
      ],
      { timeout: 9000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return reject(err || new Error('Empty yt-dlp output'));
        try {
          const data = JSON.parse(stdout);
          const streamUrl = data.url || (data.requested_formats && data.requested_formats[0]?.url);
          if (!streamUrl) return reject(new Error('No URL in yt-dlp output'));

          const ua =
            data.http_headers?.['User-Agent'] ||
            'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';
          const durSec = Number(data.duration || 0);
          const mins = Math.floor(durSec / 60);
          const secs = String(durSec % 60).padStart(2, '0');

          resolve({
            url: streamUrl,
            userAgent: ua,
            mimeType: 'audio/mp4',
            contentLength: data.filesize || data.filesize_approx || null,
            title: data.title || `YouTube (${videoId})`,
            author: (data.uploader || data.channel || 'YouTube').replace(/ - Topic$/i, ''),
            durationText: durSec > 0 ? `${mins}:${secs}` : '',
            thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          });
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}

// Tầng 2: Giải mã bằng YouTube InnerTube đa Client + Xác thực 2-byte Probe
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
    name: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    userAgent:
      'Mozilla/5.0 (PlayStation; PlayStation 4/11.50) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    clientContext: {
      clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
      clientVersion: '2.0',
      hl: 'vi',
      gl: 'VN'
    },
    thirdPartyEmbedUrl: 'https://www.youtube.com/'
  }
];

async function resolveYouTubeViaInnerTube(videoId) {
  for (const cfg of YT_PLAYER_CLIENTS) {
    try {
      const payload = {
        videoId,
        context: {
          client: cfg.clientContext
        },
        contentCheckOk: true,
        racyCheckOk: true
      };
      if (cfg.thirdPartyEmbedUrl) {
        payload.context.thirdParty = { embedUrl: cfg.thirdPartyEmbedUrl };
      }

      const body = JSON.stringify(payload);
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

      const candidates = allFormats.filter(
        (f) => f.url && ((f.mimeType || '').startsWith('audio/') || Number(f.itag) === 18)
      );

      // Sắp xếp ưu tiên itag 140 (m4a) -> audio/mp4 -> itag 18 (mp4) -> audio/webm
      candidates.sort((a, b) => {
        const score = (f) => {
          if (Number(f.itag) === 140) return 100;
          if ((f.mimeType || '').includes('audio/mp4')) return 80;
          if (Number(f.itag) === 18) return 60;
          return 40;
        };
        return score(b) - score(a);
      });

      for (const chosen of candidates.slice(0, 2)) {
        try {
          const verified = await verifyStreamPlayable(chosen.url, cfg.userAgent);
          const durSec = Number(data?.videoDetails?.lengthSeconds || 0);
          const mins = Math.floor(durSec / 60);
          const secs = String(durSec % 60).padStart(2, '0');

          return {
            url: verified.finalUrl,
            userAgent: cfg.userAgent,
            mimeType: verified.mimeType || 'audio/mp4',
            contentLength:
              verified.contentLength ||
              (chosen.contentLength ? parseInt(chosen.contentLength, 10) : null),
            title: data?.videoDetails?.title || `YouTube (${videoId})`,
            author: (data?.videoDetails?.author || 'YouTube Music').replace(/ - Topic$/i, ''),
            durationText: durSec > 0 ? `${mins}:${secs}` : '',
            thumbnail:
              data?.videoDetails?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
              `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          };
        } catch (_) {}
      }
    } catch (_) {}
  }
  throw new Error('InnerTube verified clients failed');
}

// Tầng dự phòng an toàn: Nếu 1 video YouTube bị khóa/chặn hoàn toàn trên IP hiện tại, tìm bản Audio khớp tên bài hát trên CDN
async function resolveFallbackAudioByTitle(videoId, songObj) {
  const query = songObj
    ? `${songObj.title} ${songObj.artist}`.replace(/\(|\)|\[|\]|official|video|mv|playlist|nhạc chill/gi, ' ').trim()
    : 'Lofi Chill Beats';

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query.slice(0, 50) || 'Lofi Chill')}&media=music&entity=song&country=VN&limit=3`;
  const data = await fetchJson(url, { timeout: 4500 });
  const item = data?.results?.find((r) => r.previewUrl);
  if (item && item.previewUrl) {
    const verified = await verifyStreamPlayable(item.previewUrl, 'Mozilla/5.0');
    return {
      url: verified.finalUrl,
      userAgent: 'Mozilla/5.0',
      mimeType: 'audio/mp4',
      contentLength: verified.contentLength,
      title: songObj?.title || item.trackName,
      author: songObj?.artist || item.artistName,
      durationText: songObj?.durationText || '',
      thumbnail: songObj?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      timestamp: Date.now()
    };
  }
  throw new Error('No fallback stream found');
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
    // 1. Thử InnerTube ANDROID_VR / IOS có kiểm tra 2-byte Probe
    try {
      const res1 = await resolveYouTubeViaInnerTube(videoId);
      streamMetaCache.set(videoId, res1);
      return res1;
    } catch (_) {}

    // 2. Thử yt-dlp binary chính thức (hỗ trợ giải mã mọi chữ ký VEVO / bản quyền mới nhất)
    try {
      const resYtDlp = await resolveViaYtDlpBinary(videoId);
      const verified = await verifyStreamPlayable(resYtDlp.url, resYtDlp.userAgent);
      resYtDlp.url = verified.finalUrl;
      resYtDlp.contentLength = verified.contentLength || resYtDlp.contentLength;
      streamMetaCache.set(videoId, resYtDlp);
      return resYtDlp;
    } catch (_) {}

    // 3. Thử @distube/ytdl-core + kiểm tra Probe
    if (ytdl) {
      try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
        const chosen =
          audioFormats.find((f) => Number(f.itag) === 140) ||
          audioFormats.find((f) => f.container === 'mp4') ||
          audioFormats[0];
        if (chosen && chosen.url) {
          const ua =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
          const verified = await verifyStreamPlayable(chosen.url, ua);
          const res3 = {
            url: verified.finalUrl,
            userAgent: ua,
            mimeType: verified.mimeType || 'audio/mp4',
            contentLength: verified.contentLength,
            title: info.videoDetails?.title || `YouTube (${videoId})`,
            author: info.videoDetails?.author?.name?.replace(/ - Topic$/i, '') || 'YouTube',
            durationText: '',
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            timestamp: Date.now()
          };
          streamMetaCache.set(videoId, res3);
          return res3;
        }
      } catch (_) {}
    }

    // 4. Tầng bảo vệ cuối: Không bao giờ để trả về lỗi 500 làm iPhone tự nhảy bài dây chuyền
    const resFallback = await resolveFallbackAudioByTitle(videoId, songObj);
    streamMetaCache.set(videoId, resFallback);
    return resFallback;
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
  if (inflightDownloads.has(urlStr)) {
    return inflightDownloads.get(urlStr);
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
          if (totalBytes > 24 * 1024 * 1024) {
            upstreamReq.destroy();
            return reject(new Error('Stream larger than RAM cache limit'));
          }
          chunks.push(chunk);
        });

        upstreamRes.on('end', () => {
          const fullBuffer = Buffer.concat(chunks);
          if (fullBuffer.length < 4096) return reject(new Error('Buffer too small'));
          resolve({ buffer: fullBuffer, mimeType });
        });

        upstreamRes.on('error', reject);
      })
      .catch(reject);
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
    for (const candidateFile of [DB_FILE, OLD_V5_DB_FILE]) {
      if (fs.existsSync(candidateFile)) {
        const parsed = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
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
    }
  } catch (_) {}
  return {
    songs: CURATED_YOUTUBE_POOL.slice(0, 4).map((s) => ({
      ...s,
      liked: true,
      playCount: 3,
      skipCount: 0,
      addedAt: Date.now()
    })),
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

// Giải mã sẵn 2 bài đầu tiên ngay khi khởi động
setTimeout(() => {
  for (const s of db.songs.slice(0, 2)) {
    if (s.youtubeId) {
      resolveYouTubeAudioFormat(s.youtubeId, s).catch(() => {});
    }
  }
}, 500);

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

  try {
    const info = await resolveYouTubeAudioFormat(ytId, song);
    if (
      !audioBufferCache.has(ytId) &&
      info.contentLength &&
      info.contentLength < 16 * 1024 * 1024
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

// Đề xuất YouTube theo Gu (Đảm bảo luôn trả về 8 bài, không bao giờ bị 0 bài như trong video!)
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
      vpop: 'Sơn Tùng M-TP Vũ Đen Vâu Soobin official audio',
      lofi: 'lofi hip hop chill beats to study relax',
      indie: 'Vũ Ngọt Chillies Da LAB indie việt',
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
          ? `${favArtist} official audio`
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

    // Bổ sung từ kho tuyển chọn nếu kết quả tìm kiếm bị trùng hoặc mạng chậm (Đảm bảo KHÔNG BAO GIỜ bị 0 bài!)
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
 * ENDPOINT STREAM ÂM THANH YOUTUBE ĐI THEO MỌI TẦNG REDIRECT 302 (/api/stream/:rawParam):
 * Đảm bảo mọi bài hát (dù dài 4 phút hay 2 tiếng như trong video) đều trả về đúng luồng 206 Partial Content!
 */
app.get('/api/stream/:rawParam', async (req, res) => {
  const cleanId = req.params.rawParam.replace(/\.(m4a|mp3|wav)$/i, '');
  const song = db.songs.find((s) => s.id === cleanId || s.youtubeId === cleanId);
  const ytId = song?.youtubeId || extractYouTubeId(cleanId) || cleanId.replace(/^yt-/, '');

  try {
    // 1. Nếu đã có sẵn trong RAM Buffer -> Phục vụ HTTP 206 trong < 1ms
    if (audioBufferCache.has(ytId)) {
      const cached = audioBufferCache.get(ytId);
      return serveBufferWithIosRange(req, res, cached.buffer, cached.mimeType);
    }

    // 2. Giải mã luồng âm thanh đã được xác thực Probe
    let streamInfo = await resolveYouTubeAudioFormat(ytId, song);

    // Nếu file nhỏ (< 16MB), nạp ngầm vào RAM cho lần phát/tua tiếp theo
    if (streamInfo.contentLength && streamInfo.contentLength < 16 * 1024 * 1024) {
      downloadStreamToBuffer(streamInfo.url, streamInfo.userAgent)
        .then(({ buffer, mimeType }) => cacheAudioBuffer(ytId, buffer, mimeType))
        .catch(() => {});
    }

    // 3. Mở kết nối tới googlevideo.com có tự động đi theo mọi Redirect 301/302!
    let upstream;
    try {
      upstream = await openUpstreamStreamWithRedirects(
        streamInfo.url,
        streamInfo.userAgent,
        req.headers.range || 'bytes=0-'
      );
    } catch (_) {
      // Nếu URL trong cache vừa hết hạn, xóa cache và giải mã lại ngay lập tức
      streamMetaCache.delete(ytId);
      streamInfo = await resolveYouTubeAudioFormat(ytId, song);
      upstream = await openUpstreamStreamWithRedirects(
        streamInfo.url,
        streamInfo.userAgent,
        req.headers.range || 'bytes=0-'
      );
    }

    const { upstreamRes, upstreamReq } = upstream;
    const rawType = (upstreamRes.headers['content-type'] || streamInfo.mimeType || 'audio/mp4').split(';')[0];
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

    res.writeHead(upstreamRes.statusCode === 200 && resHeaders['Content-Range'] ? 206 : (upstreamRes.statusCode || 206), resHeaders);
    upstreamRes.pipe(res);

    req.on('close', () => {
      upstreamReq.destroy();
    });
  } catch (err) {
    console.error('Stream Error [' + ytId + ']:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Không thể tải luồng âm thanh.' });
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
  console.log(`🔥 NOCTRA YOUTUBE PRO v6.0 đang chạy tại: http://localhost:${PORT}`);
  console.log(`📱 Mở trên trình duyệt SAFARI của iPhone tại:`);
  console.log(`   👉 http://${lanIp}:5173`);
  console.log('============================================================');
});
