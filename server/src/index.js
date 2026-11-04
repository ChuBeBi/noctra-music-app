const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ytSearch = require("yt-search");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, "..", "data", "library.json");

app.use(cors({
  origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : true
}));
app.use(express.json({ limit: "200kb" }));

// In-memory cache for categories & search (TTL: 15 mins)
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) {
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
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error("Không đọc được library.json:", e.message);
  }
  return [];
}

function saveLibrary(list) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {
    console.error("Không lưu được library.json:", e.message);
  }
}

const defaultSongs = [
  {
    id: "sample-lofi",
    title: "Lofi Study Session",
    artist: "YouTube · Lofi",
    videoId: "jfKfPfyJRdk",
    category: "Lofi",
    cover: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "sample-piano",
    title: "Peaceful Piano",
    artist: "YouTube · Piano",
    videoId: "4oStw0r33so",
    category: "Sleep",
    cover: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "sample-ambient",
    title: "Ambient Space",
    artist: "YouTube · Ambient",
    videoId: "DWcJFNfaw9c",
    category: "Relax",
    cover: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=800&q=80"
  }
];

function parseVideoId(input) {
  const value = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? id : null;
    }
    if (url.hostname.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex(p => ["embed", "shorts", "live"].includes(p));
      if (marker >= 0 && /^[a-zA-Z0-9_-]{11}$/.test(parts[marker + 1] || "")) return parts[marker + 1];
    }
  } catch (_error) {}
  return null;
}

function parsePlaylistId(input) {
  const value = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(value) && value.startsWith("PL")) return value;
  try {
    const url = new URL(value);
    const list = url.searchParams.get("list");
    if (list && /^[a-zA-Z0-9_-]{10,}$/.test(list)) return list;
  } catch {}
  return null;
}

const CATEGORY_QUERIES = {
  trending: "nhac hot tiktok trending viet nam",
  vpop: "nhac tre vpop moi nhat",
  lofi: "lofi chill tieng viet",
  acoustic: "nhac acoustic viet nam nhe nhang",
  sleep: "nhac piano khong loi de ngu",
  remix: "nhac tre remix hot tiktok"
};

app.get("/api/health", (_req, res) => res.json({ ok: true, name: "NOCTRA API" }));

// GET /api/songs: Saved library + default songs
app.get("/api/songs", (_req, res) => {
  const saved = loadLibrary();
  const all = [...saved, ...defaultSongs.filter(d => !saved.some(s => s.videoId === d.videoId))];
  res.json({ songs: all });
});

// GET /api/trending?category=...: Auto-fetched from YouTube
app.get("/api/trending", async (req, res) => {
  const category = (req.query.category || "trending").toLowerCase();
  const query = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.trending;
  const cacheKey = `cat_${category}`;

  const cached = getCached(cacheKey);
  if (cached) return res.json({ category, songs: cached });

  try {
    const results = await ytSearch(query);
    const songs = (results.videos || []).slice(0, 24).map(v => ({
      id: `yt-${v.videoId}`,
      title: v.title,
      artist: v.author?.name || "YouTube",
      videoId: v.videoId,
      category: category.toUpperCase(),
      cover: v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.timestamp || "",
      views: v.views || 0
    }));

    setCached(cacheKey, songs);
    res.json({ category, songs });
  } catch (error) {
    console.error("Lỗi trending YouTube:", error.message);
    res.status(500).json({ message: "Không thể lấy nhạc thịnh hành từ YouTube.", songs: defaultSongs });
  }
});

// GET /api/search?q=...: Live search YouTube
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ songs: [] });

  const cacheKey = `search_${q.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json({ songs: cached });

  try {
    const results = await ytSearch(q);
    const songs = (results.videos || []).slice(0, 25).map(v => ({
      id: `yt-${v.videoId}`,
      title: v.title,
      artist: v.author?.name || "YouTube",
      videoId: v.videoId,
      category: "YouTube",
      cover: v.image || v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.timestamp || "",
      views: v.views || 0
    }));

    setCached(cacheKey, songs);
    res.json({ songs });
  } catch (error) {
    console.error("Lỗi tìm kiếm YouTube:", error.message);
    res.status(500).json({ message: "Không thể tìm kiếm nhạc YouTube." });
  }
});

// POST /api/songs: Add single song (auto-resolves title & artist from YouTube if omitted)
app.post("/api/songs", async (req, res) => {
  const videoId = parseVideoId(req.body?.url || req.body?.videoId);
  if (!videoId) return res.status(400).json({ message: "URL hoặc ID YouTube không hợp lệ." });

  let title = String(req.body?.title || "").trim();
  let artist = String(req.body?.artist || "").trim();
  let cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let duration = "";

  // Auto fetch video details if title or artist is empty
  if (!title || !artist) {
    try {
      const details = await ytSearch({ videoId });
      if (details) {
        if (!title) title = details.title || "Bài hát YouTube";
        if (!artist) artist = details.author?.name || "YouTube";
        if (details.image) cover = details.image;
        if (details.timestamp) duration = details.timestamp;
      }
    } catch (e) {
      console.warn("Không lấy được metadata video:", e.message);
    }
  }

  const song = {
    id: crypto.randomUUID(),
    title: (title || "Bài hát YouTube").slice(0, 150),
    artist: (artist || "YouTube").slice(0, 100),
    videoId,
    category: String(req.body?.category || "Tùy chọn").trim().slice(0, 40),
    cover,
    duration
  };

  const library = loadLibrary();
  const existingIndex = library.findIndex(s => s.videoId === videoId);
  if (existingIndex >= 0) {
    library[existingIndex] = { ...library[existingIndex], ...song };
  } else {
    library.unshift(song);
  }
  saveLibrary(library);

  res.status(201).json({ song });
});

// POST /api/playlist: Import all songs from a playlist URL or listId
app.post("/api/playlist", async (req, res) => {
  const listId = parsePlaylistId(req.body?.url || req.body?.listId);
  if (!listId) {
    return res.status(400).json({ message: "URL Playlist YouTube không hợp lệ (cần định dạng có ?list=PL...)." });
  }

  try {
    const pl = await ytSearch({ listId });
    if (!pl || !pl.videos || !pl.videos.length) {
      return res.status(404).json({ message: "Không tìm thấy bài hát nào trong playlist này." });
    }

    const newSongs = pl.videos.map(v => ({
      id: crypto.randomUUID(),
      title: v.title,
      artist: v.author?.name || pl.title || "YouTube Playlist",
      videoId: v.videoId,
      category: "Playlist",
      cover: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.timestamp || ""
    }));

    const library = loadLibrary();
    newSongs.forEach(s => {
      if (!library.some(existing => existing.videoId === s.videoId)) {
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
    console.error("Lỗi đọc playlist:", error.message);
    res.status(500).json({ message: "Không thể đọc dữ liệu playlist YouTube. Hãy kiểm tra playlist có ở chế độ công khai không." });
  }
});

// DELETE /api/songs/:id: Remove song from library
app.delete("/api/songs/:id", (req, res) => {
  const { id } = req.params;
  let library = loadLibrary();
  library = library.filter(s => s.id !== id && s.videoId !== id);
  saveLibrary(library);
  res.json({ ok: true });
});

// Serve static client build in production
const distPath = path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Lỗi máy chủ. Vui lòng thử lại." });
});

app.listen(PORT, () => console.log(`NOCTRA API đang chạy tại http://localhost:${PORT}`));
