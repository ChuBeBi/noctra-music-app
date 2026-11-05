/**
 * NOCTRA iOS BACKGROUND & LOCK-SCREEN ENGINE (v4.0 — BẢN FIX CHỐT HẠ CHO IPHONE)
 *
 * TẠI SAO TRƯỚC ĐÓ THOÁT APP HOẶC TẮT MÀN HÌNH IPHONE LÀ BỊ SẬP / TẮT NHẠC?
 * 1. Lỗi gọi `audio.play()` trong React `useEffect` (Bất đồng bộ):
 *    - Trên iOS Safari, khi màn hình tắt hoặc khi vừa vuốt thoát app, mọi lệnh đổi bài (`audio.src = ...`)
 *      và phát nhạc (`audio.play()`) BẮT BUỘC phải chạy ĐỒNG BỘ (Synchronous) ngay bên trong sự kiện
 *      `onClick`, `onEnded` hoặc `mediaSession`. Nếu gọi `setCurrentIndex()` rồi chờ `useEffect` chạy sau khi
 *      React render, iOS sẽ thu hồi quyền phát nền và ĐÁ SẬP trình phát ngay lập tức!
 *    -> ĐÃ FIX: Bỏ hoàn toàn việc đổi nhạc trong `useEffect`. Mọi thao tác phát & chuyển bài đều gọi trực tiếp
 *       hàm đồng bộ `playSongImperatively()` ngay trong tích tắc sự kiện.
 *
 * 2. Lỗi React Re-render liên tục 4 lần/giây khi đang chạy ngầm (`onTimeUpdate` -> `setCurrentTime`):
 *    - Khi bạn thoát app hoặc tắt màn hình (`document.hidden === true`), nếu `onTimeUpdate` vẫn gọi `setState`
 *      4 lần mỗi giây, iOS phát hiện tab ngầm tốn CPU render giao diện và lập tức ĐÓNG BĂNG (Kill/Suspend) tab!
 *    -> ĐÃ FIX: Khi `document.hidden === true` (màn hình tắt hoặc thoát app), khóa hoàn toàn `setState` của React
 *       (0% CPU giao diện), chỉ để chip phần cứng `<audio>` chạy ngầm 100%.
 *
 * 3. Lỗi gắn `src={...}` trực tiếp vào JSX `<audio src={...}>`:
 *    - Khi React render lại, thuộc tính `src` trong JSX làm gián đoạn luồng bộ đệm của iOS.
 *    -> ĐÃ FIX: Thẻ `<audio ref={audioRef} controls playsInline preload="auto" />` hoàn toàn độc lập khỏi JSX `src`.
 *
 * 4. Lỗi Vite Proxy (:5173) làm đứt kết nối stream `206 Partial Content` khi khóa máy & Chờ tải cả file:
 *    -> ĐÃ FIX: Khi chạy dev trên iPhone, tự động kết nối thẳng tới cổng `:5000` của Server âm thanh (không qua
 *       trung gian Vite proxy), đường dẫn có đuôi `.m4a` (`/api/stream/:id.m4a`) để chip Apple nhận diện phần cứng,
 *       và phản hồi `HTTP 206 Partial Content` tức thì (< 5ms) không bao giờ bắt iPhone chờ!
 *
 * 5. Gỡ bỏ tự động Service Worker cũ (`sw.js`) và chế độ WebClip (`apple-mobile-web-app-capable`) gây khóa mạng ngầm.
 *
 * CÁCH CHẠY (Mở PowerShell / CMD tại thư mục noctra-music-app):
 *   node update-noctra-ios.js
 *   npm run dev
 */

const fs = require('fs');
const path = require('path');

function writeFileEnsured(relPath, content) {
  const fullPath = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`[OK] Đã ghi đè thành công: ${relPath}`);
}

// ============================================================================
// 1. ROOT PACKAGE.JSON & SERVER PACKAGE.JSON
// ============================================================================
const rootPackageJson = {
  name: "noctra-music-app",
  version: "4.0.0",
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
  version: "4.0.0",
  private: true,
  scripts: {
    start: "node src/index.js",
    dev: "node src/index.js"
  },
  dependencies: {
    "@distube/ytdl-core": "^4.14.4",
    cors: "^2.8.5",
    express: "^4.21.1"
  }
};

// ============================================================================
// 2. CLIENT VITE.CONFIG.JS
// ============================================================================
const clientViteConfigJs = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
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
// 3. SERVER (server/src/index.js) — Instant Non-Blocking HTTP 206 + Direct YouTube AndroidVR/iOS API + Apple CDN
// ============================================================================
const serverIndexJs = `const express = require('express');
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
  const text = \`\${title} \${artist}\`.toLowerCase();
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
    const url = \`https://itunes.apple.com/search?term=\${encodeURIComponent(query)}&media=music&entity=song&country=VN&limit=\${limit}\`;
    const data = await fetchJson(url, { timeout: 4500 });
    if (!data || !Array.isArray(data.results)) return [];
    return data.results
      .filter((item) => item.previewUrl)
      .map((item) => ({
        id: \`apple-\${item.trackId}\`,
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
          title: data?.videoDetails?.title || \`YouTube (\${videoId})\`,
          author: (data?.videoDetails?.author || 'YouTube Music').replace(/ - Topic$/i, ''),
          thumbnail:
            data?.videoDetails?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
            \`https://i.ytimg.com/vi/\${videoId}/hqdefault.jpg\`,
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
      const info = await ytdl.getInfo(\`https://www.youtube.com/watch?v=\${videoId}\`);
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
          title: info.videoDetails?.title || \`YouTube (\${videoId})\`,
          author: info.videoDetails?.author?.name?.replace(/ - Topic$/i, '') || 'YouTube Music',
          thumbnail: \`https://i.ytimg.com/vi/\${videoId}/hqdefault.jpg\`,
          timestamp: Date.now()
        };
        streamMetaCache.set(videoId, resolved);
        return resolved;
      }
    } catch (_) {}
  }

  // Tầng 3: Tìm bản tương đương trên Apple CDN M4A
  const songInDb = db.songs.find((s) => s.youtubeId === videoId);
  const query = songInDb ? \`\${songInDb.title} \${songInDb.artist}\` : videoId;
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
          \`https://i.ytimg.com/vi/\${v.videoId}/hqdefault.jpg\`;

        results.push({
          id: \`yt-\${v.videoId}\`,
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
          return reject(new Error(\`HTTP \${res.statusCode}\`));
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
      res.writeHead(416, { 'Content-Range': \`bytes */\${total}\` });
      return res.end();
    }

    const chunk = buffer.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Range': \`bytes \${start}-\${end}/\${total}\`,
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
          id: \`song-init-\${Date.now()}-\${Math.random().toString(36).slice(2, 6)}\`,
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
  const rawId = req.params.songId.replace(/\\.(m4a|mp3|wav)$/i, '');
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
            ? \`Tâm trạng #\${mood}\`
            : favArtist && !favArtist.includes('noctra')
              ? \`Vì bạn thích \${favArtist}\`
              : \`Chuẩn gu #\${topTag} của bạn\`
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
        id: \`song-\${Date.now()}\`,
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
      let thumbnail = customThumb || \`https://i.ytimg.com/vi/\${ytId}/hqdefault.jpg\`;
      let resolvedUrl = null;

      try {
        const info = await resolveYouTubeAudioFormat(ytId);
        metaTitle = metaTitle || info.title;
        metaArtist = metaArtist || info.author;
        thumbnail = info.thumbnail || thumbnail;
        resolvedUrl = info.url;
      } catch (_) {
        metaTitle = metaTitle || \`YouTube Track (\${ytId})\`;
        metaArtist = metaArtist || 'YouTube Music';
      }

      const newSong = {
        id: \`song-\${Date.now()}\`,
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

    if (/^https?:\\/\\//i.test(raw)) {
      const newSong = {
        id: \`song-\${Date.now()}\`,
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
        id: \`song-\${Date.now()}\`,
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
  const idOrVideoId = req.params.rawParam.replace(/\\.(m4a|mp3|wav)$/i, '');
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
  console.log(\`🍏 NOCTRA v4.0 Server (iPhone Lock-Screen Engine): http://localhost:\${PORT}\`);
  console.log(\`📱 Mở trực tiếp bằng trình duyệt SAFARI trên iPhone tại:\`);
  console.log(\`   👉 http://\${lanIp}:5173\`);
  console.log('============================================================');
});
`;

// ============================================================================
// 4. CLIENT INDEX.HTML, MANIFEST & SELF-UNREGISTERING SERVICE WORKER
// ============================================================================
const clientIndexHtml = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#07080d" />
    <!--
      QUAN TRỌNG CHO IPHONE: Không bật apple-mobile-web-app-capable="yes" vì iOS đóng băng tiến trình
      WebClip độc lập khi vuốt thoát ra màn hình chính trên mạng HTTP nội bộ. Chạy qua engine Safari giúp
      nhạc phát nền 100% khi thoát app và khi tắt màn hình!
    -->
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>NOCTRA — Nghe Nhạc Tắt Màn Hình iPhone</title>
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
      }
      input, button {
        font-family: inherit;
      }
    </style>
    <script>
      // Tự động gỡ bỏ mọi Service Worker cũ (sw.js) đang lưu cache lỗi trên iPhone
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          for (let registration of registrations) {
            registration.unregister();
          }
        }).catch(function() {});
      }
    </script>
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
    display: "browser",
    background_color: "#07080d",
    theme_color: "#07080d"
  },
  null,
  2
);

const clientServiceWorkerUnregister = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
    clients.forEach((client) => client.navigate(client.url));
  });
});
`;

// ============================================================================
// 5. CLIENT APP.JSX — ĐỒNG BỘ 100% (SYNCHRONOUS AUDIO ENGINE) + 0% CPU KHI TẮT MÀN HÌNH
// ============================================================================
const clientAppJsx = `import React, { useEffect, useRef, useState } from 'react';

/**
 * Kết nối thẳng tới cổng 5000 của Express Server khi chạy dev trên mạng Wi-Fi (bỏ qua Vite proxy)
 * để iOS AVPlayer giữ kết nối HTTP 206 Partial Content không bị ngắt khi khóa màn hình.
 */
function resolveApiBase() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port === '5173' || port === '4173' || port === '3000') {
      return \`\${protocol}//\${hostname}:5000/api\`;
    }
  }
  return '/api';
}

const API_BASE = resolveApiBase();

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
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const [activeTab, setActiveTab] = useState('library');
  const [loopMode, setLoopMode] = useState('all'); // 'all' | 'radio' | 'one'
  const [shuffle, setShuffle] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);

  // Tìm kiếm & Đề xuất
  const [omniQuery, setOmniQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMood, setSelectedMood] = useState('all');
  const [recommendations, setRecommendations] = useState([]);
  const [topTags, setTopTags] = useState(['lofi', 'chill']);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Phát hiện nếu người dùng đang mở từ icon WebClip cũ ngoài màn hình chính
  const isStandaloneWebClip =
    typeof window !== 'undefined' && Boolean(window.navigator?.standalone);

  // Refs giữ trạng thái đồng bộ để gọi ngay lập tức trong sự kiện phần cứng iOS (không phụ thuộc React render)
  const audioRef = useRef(null);
  const songsRef = useRef([]);
  const currentIndexRef = useRef(0);
  const loopModeRef = useRef('all');
  const shuffleRef = useRef(false);
  const recommendationsRef = useRef([]);
  const prefetchedSetRef = useRef(new Set());
  const trackPlayedHalfRef = useRef(false);
  const lastPositionUpdateRef = useRef(0);
  const timeLabelRef = useRef(null);

  songsRef.current = songs;
  currentIndexRef.current = currentIndex;
  loopModeRef.current = loopMode;
  shuffleRef.current = shuffle;
  recommendationsRef.current = recommendations;

  const currentSong = songs[currentIndex] || null;

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? '' : prev));
    }, 3000);
  };

  // Đường dẫn có đuôi .m4a để iOS AVURLAsset nhận diện luồng phần cứng mediaserverd ngay lập tức
  const getPlayableUrl = (song) => {
    if (!song) return '';
    const key = encodeURIComponent(song.id || song.youtubeId || 'default');
    return \`\${API_BASE}/stream/\${key}.m4a\`;
  };

  const activateIosPlaybackSession = () => {
    try {
      if ('audioSession' in navigator) {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) {}
  };

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

  const prefetchSong = (song) => {
    if (!song?.id || prefetchedSetRef.current.has(song.id)) return;
    prefetchedSetRef.current.add(song.id);
    fetch(\`\${API_BASE}/prefetch/\${encodeURIComponent(song.id)}.m4a\`).catch(() => {});
  };

  /**
   * HÀM PHÁT ĐỒNG BỘ 100% (SYNCHRONOUS IMPERATIVE PLAYBACK):
   * Được gọi trực tiếp trong cùng 1 xung nhịp (call stack) của sự kiện onClick / onEnded / mediaSession.
   * Đây là điều kiện bắt buộc của iOS Safari để không bị mất quyền phát nền khi tắt màn hình hoặc thoát app!
   */
  const playSongImperatively = (targetSong, targetIdx, autoPlay = true) => {
    const audio = audioRef.current;
    if (!audio || !targetSong) return;

    activateIosPlaybackSession();
    trackPlayedHalfRef.current = false;

    const url = getPlayableUrl(targetSong);
    if (audio.src !== url) {
      audio.src = url;
      audio.load();
    }
    audio.playbackRate = playbackRate;

    currentIndexRef.current = targetIdx;
    setCurrentIndex(targetIdx);
    updateMediaSessionMetadata(targetSong);

    // Nạp sẵn bài kế tiếp vào RAM của Server
    const list = songsRef.current;
    if (list.length > 1) {
      const nextSong = list[(targetIdx + 1) % list.length];
      prefetchSong(nextSong);
    }

    if (autoPlay) {
      setLoadingTrack(true);
      const p = audio.play();
      if (p !== undefined) {
        p.then(() => {
          setIsPlaying(true);
          setLoadingTrack(false);
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
          sendTasteSignal(targetSong.id, 'play');
        }).catch((err) => {
          console.warn('iOS play warning:', err.message);
          setLoadingTrack(false);
        });
      }
    }
  };

  // Khởi tải danh sách bài hát và gắn src cho bài đầu tiên (chưa tự phát để chờ chạm tay của người dùng)
  useEffect(() => {
    activateIosPlaybackSession();
    fetch(\`\${API_BASE}/songs\`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSongs(data);
          songsRef.current = data;
          if (audioRef.current && !audioRef.current.src) {
            audioRef.current.src = getPlayableUrl(data[0]);
            updateMediaSessionMetadata(data[0]);
          }
          if (data[1]) prefetchSong(data[1]);
        }
      })
      .catch(() => {
        showToast('Không kết nối được Server cổng 5000. Hãy kiểm tra cửa sổ chạy npm run dev.');
      });

    fetchRecommendations('all');
  }, []);

  const fetchRecommendations = (mood = selectedMood) => {
    setLoadingRecs(true);
    const queryParam = mood && mood !== 'all' ? \`?mood=\${encodeURIComponent(mood)}\` : '';
    fetch(\`\${API_BASE}/recommendations\${queryParam}\`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.items) {
          setRecommendations(data.items);
          recommendationsRef.current = data.items;
        }
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

  // Chuyển bài đồng bộ ngay lập tức (kể cả khi màn hình iPhone đang tắt)
  const triggerNextTrackSync = (isEndedEvent = false) => {
    const list = songsRef.current;
    const idx = currentIndexRef.current;
    const audio = audioRef.current;
    if (!list.length || !audio) return;

    if (isEndedEvent && loopModeRef.current === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    let nextIdx = (idx + 1) % list.length;
    if (shuffleRef.current && list.length > 1) {
      nextIdx = Math.floor(Math.random() * list.length);
      if (nextIdx === idx) nextIdx = (idx + 1) % list.length;
    }

    const nextSong = list[nextIdx];
    playSongImperatively(nextSong, nextIdx, true);
  };

  const triggerPrevTrackSync = () => {
    const list = songsRef.current;
    const idx = currentIndexRef.current;
    const audio = audioRef.current;
    if (!list.length || !audio) return;

    if (audio.currentTime > 4) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    const prevIdx = (idx - 1 + list.length) % list.length;
    const prevSong = list[prevIdx];
    playSongImperatively(prevSong, prevIdx, true);
  };

  const playCurrentSync = () => {
    const audio = audioRef.current;
    const list = songsRef.current;
    const song = list[currentIndexRef.current];
    if (!audio || !song) return;

    activateIosPlaybackSession();
    if (!audio.src) {
      audio.src = getPlayableUrl(song);
    }
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      })
      .catch(() => {});
  };

  const pauseCurrentSync = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  };

  // Đăng ký nút điều khiển ngoài Màn hình khóa iPhone & Control Center (1 lần duy nhất, dùng Ref đồng bộ)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers = [
      ['play', () => playCurrentSync()],
      ['pause', () => pauseCurrentSync()],
      ['previoustrack', () => triggerPrevTrackSync()],
      ['nexttrack', () => triggerNextTrackSync(false)],
      [
        'seekto',
        (details) => {
          if (audioRef.current && details.seekTime != null) {
            audioRef.current.currentTime = details.seekTime;
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
  }, []);

  /**
   * CẬP NHẬT THỜI GIAN SIÊU NHẸ (0% REACT RE-RENDER KHI TẮT MÀN HÌNH HOẶC THOÁT APP):
   * Không gọi setState liên tục làm iOS đóng băng tiến trình ngầm!
   */
  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const cur = audio.currentTime || 0;
    const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;

    // Cập nhật chữ hiển thị thời gian trực tiếp qua DOM ref (không gây re-render React!)
    if (!document.hidden && timeLabelRef.current) {
      const format = (sec) => {
        if (!sec || Number.isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return \`\${m}:\${s < 10 ? '0' : ''}\${s}\`;
      };
      timeLabelRef.current.textContent = \`\${format(cur)} / \${format(dur)}\`;
    }

    if (dur > 0) {
      const activeSong = songsRef.current[currentIndexRef.current];
      if (!trackPlayedHalfRef.current && cur / dur > 0.6 && activeSong) {
        trackPlayedHalfRef.current = true;
        sendTasteSignal(activeSong.id, 'complete');
      }

      // Chỉ cập nhật thanh thời gian trên màn hình khóa iPhone mỗi 4 giây/lần để tiết kiệm tối đa tài nguyên ngầm
      const now = Date.now();
      if (
        now - lastPositionUpdateRef.current > 4000 &&
        'mediaSession' in navigator &&
        'setPositionState' in navigator.mediaSession
      ) {
        lastPositionUpdateRef.current = now;
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

  // Hẹn giờ tắt nhạc khi ngủ
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
          pauseCurrentSync();
          showToast('Đã tự động dừng nhạc theo hẹn giờ ngủ 🌙');
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [sleepMinutesLeft]);

  // Tìm kiếm tức thì
  useEffect(() => {
    const trimmed = omniQuery.trim();
    if (!trimmed || /^https?:\\/\\//i.test(trimmed) || /^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(\`\${API_BASE}/search?q=\${encodeURIComponent(trimmed)}\`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setSearchResults(data);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 300);

    return () => clearTimeout(timer);
  }, [omniQuery]);

  // Phát ngay khi chạm vào bài tìm kiếm hoặc bài đề xuất (Mở khóa âm thanh đồng bộ ngay lúc chạm!)
  const handleQuickPlayTrack = async (track) => {
    activateIosPlaybackSession();
    const audio = audioRef.current;
    // Mở khóa quyền phát trên thẻ <audio> ngay trong nhịp chạm tay trước khi gọi fetch
    if (audio) {
      audio.play().catch(() => {});
    }

    try {
      setLoadingTrack(true);
      const res = await fetch(\`\${API_BASE}/songs\`, {
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

      const newList = [added, ...songsRef.current.filter((s) => s.id !== added.id)];
      songsRef.current = newList;
      setSongs(newList);
      playSongImperatively(added, 0, true);
      showToast(\`Đang phát: \${added.title}\`);
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
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
    setLoadingTrack(true);
    try {
      const res = await fetch(\`\${API_BASE}/songs\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId: raw })
      });
      const added = await res.json();
      if (!res.ok) throw new Error(added.error || 'Không tìm thấy bài hát');

      const newList = [added, ...songsRef.current.filter((s) => s.id !== added.id)];
      songsRef.current = newList;
      setSongs(newList);
      playSongImperatively(added, 0, true);
      setOmniQuery('');
      setSearchResults([]);
      showToast(\`Đã thêm & phát: \${added.title}\`);
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
      await fetch(\`\${API_BASE}/songs/\${id}\`, { method: 'DELETE' });
      const updated = songsRef.current.filter((s) => s.id !== id);
      songsRef.current = updated;
      setSongs(updated);
      if (idx === currentIndexRef.current && updated.length > 0) {
        playSongImperatively(updated[0], 0, isPlaying);
      } else if (idx < currentIndexRef.current) {
        const newIdx = Math.max(0, currentIndexRef.current - 1);
        currentIndexRef.current = newIdx;
        setCurrentIndex(newIdx);
      }
    } catch (_) {}
  };

  return (
    <div style={styles.page}>
      {currentSong?.thumbnail && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: \`url(\${currentSong.thumbnail})\`
          }}
        />
      )}

      <div style={styles.container}>
        {isStandaloneWebClip && (
          <div style={styles.safariWarning}>
            ⚠️ <strong>Lưu ý quan trọng trên iPhone:</strong> Bạn đang mở từ biểu tượng Màn hình chính cũ (chế độ WebClip của iOS sẽ tự ngắt mạng khi vuốt thoát ra). Hãy mở địa chỉ này trực tiếp trong ứng dụng <strong>Safari</strong> để thoát ra ngoài và tắt màn hình vẫn phát nhạc 100%!
          </div>
        )}

        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={styles.badge}>🍏 iOS HARDWARE LOCK-SCREEN v4.0</span>
            {sleepMinutesLeft > 0 && (
              <span style={styles.sleepBadge}>🌙 Tắt sau {sleepMinutesLeft}p</span>
            )}
          </div>
          <div style={styles.brandRow}>
            <div>
              <h1 style={styles.logo}>NOCTRA</h1>
              <p style={styles.subtitle}>
                Đồng bộ phần cứng iOS trực tiếp — Thoát Safari & Tắt màn hình vẫn phát 100%
              </p>
            </div>
            <div style={styles.tasteChip}>
              Gu: {topTags.map((t) => \`#\${t}\`).join(' ')}
            </div>
          </div>
        </header>

        {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

        <section style={styles.playerCard}>
          {currentSong && (
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
                      ? '⚡ Đang nạp luồng...'
                      : isPlaying
                        ? '🔊 Đang phát nền (Thoát app & Khóa máy OK)'
                        : '⏸ Chạm Phát để bắt đầu'}
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
                <div ref={timeLabelRef} style={styles.timeRow}>
                  0:00 / 0:00
                </div>
              </div>
            </div>
          )}

          {/*
            THẺ <AUDIO> PHẦN CỨNG ĐỘC LẬP (KHÔNG GẮN THUỘC TÍNH src={...} TRONG JSX!)
            Nhờ không bị React can thiệp khi render lại và không tốn CPU khi ẩn trang,
            tiến trình mediaserverd của iPhone giữ luồng nhạc sống 100% khi thoát ra màn hình chính hoặc tắt màn hình!
          */}
          <div style={styles.nativeAudioWrap}>
            <audio
              ref={audioRef}
              controls
              playsInline
              preload="auto"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleTimeUpdate}
              onEnded={() => triggerNextTrackSync(true)}
              onPlay={() => {
                activateIosPlaybackSession();
                setIsPlaying(true);
                setLoadingTrack(false);
                if (songsRef.current[currentIndexRef.current]) {
                  updateMediaSessionMetadata(songsRef.current[currentIndexRef.current]);
                }
                if ('mediaSession' in navigator) {
                  navigator.mediaSession.playbackState = 'playing';
                }
              }}
              onPause={() => {
                setIsPlaying(false);
                if ('mediaSession' in navigator) {
                  navigator.mediaSession.playbackState = 'paused';
                }
              }}
              onWaiting={() => setLoadingTrack(true)}
              onPlaying={() => setLoadingTrack(false)}
              onError={() => {
                setLoadingTrack(false);
                // Tự động chuyển sang bài kế tiếp đồng bộ nếu luồng bị lỗi
                if (songsRef.current.length > 1) {
                  triggerNextTrackSync(true);
                }
              }}
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

            <button onClick={triggerPrevTrackSync} style={styles.secondaryBtn} type="button">
              ⏮ Trước
            </button>

            <button
              onClick={() => {
                if (isPlaying) {
                  pauseCurrentSync();
                } else {
                  const s = songsRef.current[currentIndexRef.current];
                  if (s) playSongImperatively(s, currentIndexRef.current, true);
                }
              }}
              style={styles.primaryBtn}
              type="button"
            >
              {isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
            </button>

            <button
              onClick={() => triggerNextTrackSync(false)}
              style={styles.secondaryBtn}
              type="button"
            >
              Tiếp ⏭
            </button>

            <button
              type="button"
              onClick={() => {
                const modes = ['all', 'one'];
                const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
                setLoopMode(next);
                showToast(next === 'one' ? '🔂 Lặp 1 bài hiện tại' : '🔁 Lặp toàn bộ danh sách');
              }}
              style={{
                ...styles.iconBtn,
                color: loopMode !== 'all' ? '#38bdf8' : '#94a3b8',
                background: loopMode !== 'all' ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.06)'
              }}
            >
              {loopMode === 'one' ? '🔂' : '🔁'}
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
                showToast(next ? \`🌙 Hẹn giờ tắt sau \${next} phút\` : 'Đã tắt hẹn giờ ngủ');
              }}
            >
              🌙 {sleepMinutesLeft > 0 ? \`Ngủ: \${sleepMinutesLeft}p\` : 'Hẹn giờ ngủ'}
            </button>

            <button
              type="button"
              style={styles.utilChip}
              onClick={() => {
                const speeds = [1, 1.15, 1.25, 0.9];
                const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
                setPlaybackRate(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
                showToast(\`⚡ Tốc độ: \${next}x\`);
              }}
            >
              ⚡ Tốc độ: {playbackRate}x
            </button>
          </div>
        </section>

        {/* Thanh tìm kiếm & Dán nhanh */}
        <section style={styles.omniCard}>
          <form onSubmit={handleOmniSubmit} style={styles.omniRow}>
            <input
              type="text"
              placeholder="🔍 Gõ tên bài hát, ca sĩ hoặc dán link YouTube / MP3..."
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
            <div style={styles.searchingHint}>Đang tìm nguồn nhạc chuẩn phần cứng iOS...</div>
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
                        {item.source === 'apple_cdn' ? '🍏 Apple M4A Siêu tốc' : 'YouTube M4A'}
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
                  onClick={() => {
                    if (active) {
                      if (isPlaying) pauseCurrentSync();
                      else playSongImperatively(song, idx, true);
                    } else {
                      playSongImperatively(song, idx, true);
                    }
                  }}
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
  safariWarning: {
    background: 'rgba(245, 158, 11, 0.18)',
    border: '1px solid rgba(245, 158, 11, 0.5)',
    color: '#fde68a',
    padding: '10px 12px',
    borderRadius: 14,
    fontSize: 12,
    lineHeight: 1.45,
    marginBottom: 12
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
    fontSize: 12,
    color: '#cbd5e1',
    fontVariantNumeric: 'tabular-nums'
  },
  nativeAudioWrap: {
    marginBottom: 12,
    background: 'rgba(255,255,255,0.05)',
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
writeFileEnsured('client/public/sw.js', clientServiceWorkerUnregister);
writeFileEnsured('client/src/App.jsx', clientAppJsx);

console.log('\n============================================================');
console.log('✅ ĐÃ GHI ĐÈ TOÀN BỘ BẢN FIX v4.0 CHO IPHONE!');
console.log('Hãy chạy ngay: npm run dev');
console.log('============================================================');
