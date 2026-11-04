const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Danh sách bài hát mẫu (hỗ trợ cả YouTube ID lẫn link MP3/M4A trực tiếp)
let songs = [
  {
    id: 'song-1',
    title: 'Lofi Study Beats — Noctra Chill',
    artist: 'Noctra Audio Stream',
    youtubeId: 'jfKfPfyJRdk',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3',
    thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg'
  },
  {
    id: 'song-2',
    title: 'Midnight Drive — Synthwave',
    artist: 'Noctra Night Session',
    youtubeId: '4xDzrJKXOOY',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/10/25/audio_946bc6eb4c.mp3',
    thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg'
  },
  {
    id: 'song-3',
    title: 'Ambient Piano — Deep Focus',
    artist: 'Noctra Acoustic',
    youtubeId: 'DWcJFNfaw9c',
    audioUrl: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3',
    thumbnail: 'https://i.ytimg.com/vi/DWcJFNfaw9c/hqdefault.jpg'
  }
];

// Cache URL stream tạm thời để giảm độ trễ khi iOS Safari gửi nhiều Range request liên tiếp
const streamCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 phút

function extractYouTubeId(input = '') {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.slice(1, 12);
    }
    const v = url.searchParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split('/');
    const embedIdx = parts.findIndex((p) => p === 'embed' || p === 'shorts');
    if (embedIdx !== -1 && parts[embedIdx + 1]) {
      return parts[embedIdx + 1].slice(0, 11);
    }
  } catch (_) {}
  return null;
}

async function resolveYouTubeAudioFormat(videoId) {
  const cached = streamCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await ytdl.getInfo(url);

  // Ưu tiên định dạng m4a (audio/mp4, codec mp4a) vì iOS Safari hỗ trợ giải mã phần cứng khi tắt màn hình
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
  let chosen =
    audioFormats.find((f) => f.container === 'mp4' && f.codecs && f.codecs.includes('mp4a')) ||
    audioFormats.find((f) => f.container === 'mp4') ||
    audioFormats[0];

  if (!chosen || !chosen.url) {
    throw new Error('Không tìm thấy luồng âm thanh phù hợp cho video này.');
  }

  const resolved = {
    url: chosen.url,
    mimeType: chosen.container === 'mp4' ? 'audio/mp4' : (chosen.mimeType?.split(';')[0] || 'audio/mpeg'),
    contentLength: chosen.contentLength ? parseInt(chosen.contentLength, 10) : null,
    title: info.videoDetails?.title || `YouTube (${videoId})`,
    author: info.videoDetails?.author?.name || 'YouTube Music',
    thumbnail:
      info.videoDetails?.thumbnails?.[info.videoDetails.thumbnails.length - 1]?.url ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    timestamp: Date.now()
  };

  streamCache.set(videoId, resolved);
  return resolved;
}

// API danh sách bài hát
app.get('/api/songs', (req, res) => {
  res.json(songs);
});

// API thêm bài hát (chấp nhận YouTube URL/ID hoặc link file .mp3/.m4a trực tiếp)
app.post('/api/songs', async (req, res) => {
  try {
    const { title, artist, urlOrId } = req.body || {};
    if (!urlOrId || !urlOrId.trim()) {
      return res.status(400).json({ error: 'Vui lòng nhập URL YouTube, ID video hoặc link MP3/M4A.' });
    }

    const raw = urlOrId.trim();
    const ytId = extractYouTubeId(raw);

    if (ytId) {
      let metaTitle = title?.trim();
      let metaArtist = artist?.trim();
      let thumbnail = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

      if (!metaTitle || !metaArtist) {
        try {
          const info = await resolveYouTubeAudioFormat(ytId);
          metaTitle = metaTitle || info.title;
          metaArtist = metaArtist || info.author;
          thumbnail = info.thumbnail || thumbnail;
        } catch (_) {
          metaTitle = metaTitle || `YouTube Track (${ytId})`;
          metaArtist = metaArtist || 'YouTube';
        }
      }

      const newSong = {
        id: `song-${Date.now()}`,
        title: metaTitle,
        artist: metaArtist,
        youtubeId: ytId,
        audioUrl: null,
        thumbnail
      };
      songs.unshift(newSong);
      return res.status(201).json(newSong);
    }

    // Trường hợp người dùng dán link .mp3 / .m4a trực tiếp
    const newSong = {
      id: `song-${Date.now()}`,
      title: title?.trim() || 'Bản nhạc tùy chỉnh',
      artist: artist?.trim() || 'Audio Stream',
      youtubeId: null,
      audioUrl: raw,
      thumbnail: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&q=80'
    };
    songs.unshift(newSong);
    return res.status(201).json(newSong);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Lỗi khi thêm bài hát.' });
  }
});

app.delete('/api/songs/:id', (req, res) => {
  songs = songs.filter((s) => s.id !== req.params.id);
  res.json({ ok: true });
});

/**
 * Endpoint quan trọng nhất cho iPhone:
 * Stream luồng âm thanh (audio/mp4) hỗ trợ HTTP 206 Partial Content (Range header).
 * Safari trên iOS bắt buộc server phải phản hồi đúng byte-range (ví dụ bytes=0-1) thì mới
 * cho phép phát qua thẻ <audio> khi khóa màn hình.
 */
app.get('/api/stream/:videoId', async (req, res) => {
  const { videoId } = req.params;
  try {
    const streamInfo = await resolveYouTubeAudioFormat(videoId);
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
      console.error('Stream proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Không thể kết nối luồng âm thanh.' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    console.error('Lỗi giải mã luồng YouTube:', err.message);
    // Nếu bài hát có audioUrl dự phòng thì chuyển hướng sang audioUrl đó
    const fallbackSong = songs.find((s) => s.youtubeId === videoId && s.audioUrl);
    if (fallbackSong) {
      return res.redirect(fallbackSong.audioUrl);
    }
    res.status(500).json({
      error: 'Không thể tách luồng âm thanh từ video này (có thể do YouTube chặn IP server hoặc video giới hạn). Hãy thử dán link file .mp3/.m4a trực tiếp.'
    });
  }
});

// Phục vụ giao diện tĩnh khi triển khai lên mạng (Render / Production)
const distPath = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`NOCTRA Server (iOS Background Audio Ready) đang chạy tại http://localhost:${PORT}`);
});
