import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  AudioLines, Search, Heart, House, Library, Clock3, Plus, Play, Pause,
  SkipBack, SkipForward, Shuffle, Repeat, Repeat1, MoreHorizontal, X, Youtube,
  Headphones, Moon, ExternalLink, Check, Flame, Sparkles, Music, Radio,
  Trash2, Maximize2, Minimize2, ListPlus, Loader2
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin.includes(':5173') ? 'http://localhost:5000/api' : '/api')).replace(/\/$/, '');

const CATEGORIES = [
  { id: 'trending', label: 'Thịnh hành', icon: Flame },
  { id: 'vpop', label: 'V-Pop Hot', icon: Sparkles },
  { id: 'lofi', label: 'Lofi Chill', icon: Moon },
  { id: 'acoustic', label: 'Acoustic', icon: Music },
  { id: 'sleep', label: 'Dễ ngủ', icon: Radio },
  { id: 'remix', label: 'Remix TikTok', icon: Flame },
];

function getStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value);
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : parsed;
  } catch {
    return fallback;
  }
}

function formatTime(sec) {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function App() {
  // Navigation & Category states
  const [activeTab, setActiveTab] = useState('trending');
  const [categorySongs, setCategorySongs] = useState({});
  const [librarySongs, setLibrarySongs] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [loadingCategory, setLoadingCategory] = useState(false);

  // Playback states
  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [repeatMode, setRepeatMode] = useState('all'); // "off", "all", "one"
  const [shuffle, setShuffle] = useState(false);
  const [favorites, setFavorites] = useState(() => getStored('noctra-favorites', []));
  const [history, setHistory] = useState(() => getStored('noctra-history', []));

  // UI Modals & Popups
  const [showPlayer, setShowPlayer] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState('single'); // "single" | "playlist"
  const [addUrl, setAddUrl] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addArtist, setAddArtist] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [notice, setNotice] = useState('');

  // iOS HTML5 Audio & YouTube Player Refs
  const audioRef = useRef(null);
  const playerRef = useRef(null);
  const ytReady = useRef(false);
  const useYtFallback = useRef(false);

  const searchTimeoutRef = useRef(null);
  const currentRef = useRef(null);
  currentRef.current = current;
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;

  // Sync to LocalStorage
  useEffect(() => { localStorage.setItem('noctra-favorites', JSON.stringify(favorites)); }, [favorites]);
  useEffect(() => { localStorage.setItem('noctra-history', JSON.stringify(history)); }, [history]);

  // Load Saved Library
  const loadLibrary = useCallback(() => {
    fetch(`${API}/songs`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data.songs)) setLibrarySongs(data.songs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Fetch Category Songs from YouTube on demand
  const fetchCategorySongs = useCallback((catId) => {
    if (categorySongs[catId]) return;
    setLoadingCategory(true);
    fetch(`${API}/trending?category=${catId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data.songs)) {
          setCategorySongs((prev) => ({ ...prev, [catId]: data.songs }));
        }
      })
      .catch(() => {
        setNotice('Không thể tải nhạc từ YouTube, hãy kiểm tra kết nối mạng.');
      })
      .finally(() => setLoadingCategory(false));
  }, [categorySongs]);

  useEffect(() => {
    const isCat = CATEGORIES.some((c) => c.id === activeTab);
    if (isCat) {
      fetchCategorySongs(activeTab);
    }
  }, [activeTab, fetchCategorySongs]);

  // Active Song List based on Tab / Search
  const currentSongList = useMemo(() => {
    if (searchQuery.trim().length > 0) return searchResults;
    if (activeTab === 'favorites') return favorites;
    if (activeTab === 'history') return history;
    if (activeTab === 'library') return librarySongs;
    return categorySongs[activeTab] || [];
  }, [searchQuery, searchResults, activeTab, favorites, history, librarySongs, categorySongs]);

  // Fallback YouTube IFrame Player (khi video không thể tách audio)
  useEffect(() => {
    const initYt = () => {
      if (!window.YT || !window.YT.Player) return;
      if (playerRef.current) return;
      playerRef.current = new window.YT.Player('yt-fallback-player', {
        width: '1',
        height: '1',
        videoId: 'jfKfPfyJRdk',
        playerVars: { playsinline: 1, controls: 0, rel: 0, enablejsapi: 1 },
        events: {
          onReady: () => { ytReady.current = true; },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) setIsPlaying(true);
            if (e.data === window.YT.PlayerState.PAUSED) setIsPlaying(false);
            if (e.data === window.YT.PlayerState.ENDED) handleSongEnd();
          }
        }
      });
    };

    if (!window.YT) {
      const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existing) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); initYt(); };
    } else {
      initYt();
    }
  }, []);

  // iPhone iOS MediaSession API Support for Background & Lock Screen Controls
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    if (current) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: 'NOCTRA YouTube Music',
        artwork: [
          { src: current.cover, sizes: '512x512', type: 'image/jpeg' }
        ]
      });
    }

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    const actions = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['previoustrack', () => previousSong()],
      ['nexttrack', () => nextSong()],
      [
        'seekto',
        (details) => {
          if (audioRef.current && details.seekTime != null) {
            audioRef.current.currentTime = details.seekTime;
            setCurrentTime(details.seekTime);
          }
        }
      ]
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (_) {}
    }
  }, [current, isPlaying]);

  // Live YouTube Search
  const handleSearchChange = (text) => {
    setSearchQuery(text);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!text.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(() => {
      fetch(`${API}/search?q=${encodeURIComponent(text.trim())}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data) => {
          setSearchResults(Array.isArray(data.songs) ? data.songs : []);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 400);
  };

  // Play Song via HTML5 Audio Stream (chạy ngầm iPhone) hoặc fallback
  const playSong = useCallback((song) => {
    if (!song) return;
    setCurrent(song);
    setHistory((prev) => [song, ...prev.filter((s) => (s.videoId || s.id) !== (song.videoId || song.id))].slice(0, 50));

    const audio = audioRef.current;
    if (audio) {
      useYtFallback.current = false;
      const streamUrl = song.audioUrl || (song.videoId ? `${API}/stream/${song.videoId}` : '');

      setLoadingTrack(true);
      audio.src = streamUrl;
      audio.load();
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setLoadingTrack(false);
        })
        .catch((err) => {
          console.warn('Audio play error, chuyển sang chế độ dự phòng:', err.message);
          setLoadingTrack(false);
          // Fallback sang YouTube IFrame nếu trình phát audio bị chặn
          if (song.videoId && playerRef.current?.loadVideoById) {
            useYtFallback.current = true;
            playerRef.current.loadVideoById(song.videoId);
            setIsPlaying(true);
          }
        });
    }
  }, []);

  const togglePlay = () => {
    if (!current) {
      if (currentSongList.length > 0) playSong(currentSongList[0]);
      return;
    }

    if (useYtFallback.current && playerRef.current) {
      if (isPlaying) {
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        playerRef.current.playVideo();
        setIsPlaying(true);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const nextSong = useCallback(() => {
    const list = currentSongList;
    if (!list.length) return;
    if (shuffleRef.current) {
      const randomIndex = Math.floor(Math.random() * list.length);
      playSong(list[randomIndex]);
      return;
    }
    const idx = list.findIndex((s) => (s.videoId || s.id) === (currentRef.current?.videoId || currentRef.current?.id));
    const nextIdx = (idx + 1) % list.length;
    playSong(list[nextIdx]);
  }, [currentSongList, playSong]);

  const previousSong = useCallback(() => {
    const list = currentSongList;
    if (!list.length) return;
    const idx = list.findIndex((s) => (s.videoId || s.id) === (currentRef.current?.videoId || currentRef.current?.id));
    const prevIdx = (idx - 1 + list.length) % list.length;
    playSong(list[prevIdx]);
  }, [currentSongList, playSong]);

  const handleSongEnd = useCallback(() => {
    if (repeatModeRef.current === 'one') {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    if (repeatModeRef.current === 'all') {
      nextSong();
    }
  }, [nextSong]);

  const handleAudioTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime || 0);
    if (audio.duration && !Number.isNaN(audio.duration)) {
      setDuration(audio.duration);
    }
  };

  const handleAudioError = () => {
    setLoadingTrack(false);
    // Nếu audio stream lỗi, kích hoạt YouTube Player dự phòng
    if (current?.videoId && playerRef.current?.loadVideoById) {
      useYtFallback.current = true;
      playerRef.current.loadVideoById(current.videoId);
      setIsPlaying(true);
    } else {
      setNotice('Không thể phát luồng âm thanh bài này. Đang chuyển bài tiếp theo...');
      setTimeout(() => nextSong(), 1500);
    }
  };

  const toggleFavorite = (song) => {
    setFavorites((prev) => {
      const key = song.videoId || song.id;
      const exists = prev.some((s) => (s.videoId || s.id) === key);
      if (exists) {
        setNotice('Đã bỏ khỏi danh sách yêu thích.');
        return prev.filter((s) => (s.videoId || s.id) !== key);
      } else {
        setNotice('Đã lưu vào danh sách yêu thích!');
        return [song, ...prev];
      }
    });
  };

  // Thêm bài hoặc nạp Playlist
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!addUrl.trim()) return;
    setSubmittingAdd(true);
    setNotice('');

    try {
      if (addMode === 'playlist') {
        const res = await fetch(`${API}/playlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: addUrl.trim() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Không thể nạp playlist');
        setNotice(data.message || `Đã nhập ${data.count} bài hát từ playlist!`);
        loadLibrary();
        setAddUrl('');
        setShowAddModal(false);
        setActiveTab('library');
      } else {
        const res = await fetch(`${API}/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: addUrl.trim(),
            title: addTitle.trim(),
            artist: addArtist.trim()
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Không thể thêm bài hát');
        setNotice(`Đã thêm bài hát: ${data.song.title}`);
        loadLibrary();
        setAddUrl('');
        setAddTitle('');
        setAddArtist('');
        setShowAddModal(false);
        playSong(data.song);
      }
    } catch (err) {
      setNotice(err.message || 'Lỗi khi thêm bài hát từ YouTube.');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const isFavorite = current && favorites.some((s) => (s.videoId || s.id) === (current.videoId || current.id));

  return (
    <div className="app-shell">
      {/* THẺ HTML5 AUDIO GỐC DUY NHẤT: Phát nhạc nền khi khóa màn hình iPhone */}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        onTimeUpdate={handleAudioTimeUpdate}
        onLoadedMetadata={handleAudioTimeUpdate}
        onEnded={handleSongEnd}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setLoadingTrack(true)}
        onPlaying={() => setLoadingTrack(false)}
        onError={handleAudioError}
        style={{ display: 'none' }}
      />

      {/* YOUTUBE IFRAME DỰ PHÒNG */}
      <div style={{ position: 'fixed', width: 1, height: 1, opacity: 0.001, pointerEvents: 'none' }}>
        <div id="yt-fallback-player" />
      </div>

      {/* SIDEBAR DESKTOP */}
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setActiveTab('trending'); setSearchQuery(''); }}>
          <span className="brand-mark"><AudioLines size={22} /></span>
          <span>NOCTRA</span>
        </a>

        <p className="nav-label">YOUTUBE KHÁM PHÁ</p>
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className={`nav-item ${activeTab === cat.id && !searchQuery ? 'active' : ''}`}
              onClick={() => { setActiveTab(cat.id); setSearchQuery(''); }}
            >
              <Icon size={17} />
              <span>{cat.label}</span>
            </button>
          );
        })}

        <p className="nav-label" style={{ marginTop: '18px' }}>BỘ SƯU TẬP</p>
        <button
          className={`nav-item ${activeTab === 'favorites' && !searchQuery ? 'active' : ''}`}
          onClick={() => { setActiveTab('favorites'); setSearchQuery(''); }}
        >
          <Heart size={17} />
          <span>Yêu thích ({favorites.length})</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'history' && !searchQuery ? 'active' : ''}`}
          onClick={() => { setActiveTab('history'); setSearchQuery(''); }}
        >
          <Clock3 size={17} />
          <span>Gần đây</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'library' && !searchQuery ? 'active' : ''}`}
          onClick={() => { setActiveTab('library'); setSearchQuery(''); }}
        >
          <Library size={17} />
          <span>Đã lưu ({librarySongs.length})</span>
        </button>

        <div className="sidebar-bottom">
          <button className="import-btn" onClick={() => setShowAddModal(true)}>
            <ListPlus size={16} />
            <span>Nhập Playlist / Thêm bài</span>
          </button>
          <div className="sidebar-note">
            <Moon size={16} />
            <span>Tối ưu khóa màn hình & chạy ngầm iOS</span>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="main-content">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="mobile-brand" onClick={() => { setActiveTab('trending'); setSearchQuery(''); }}>
            <span className="brand-mark"><AudioLines size={19} /></span>
            <b>NOCTRA</b>
          </div>

          <label className="search-box">
            {isSearching ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Tìm mọi bài hát, ca sĩ trên YouTube..."
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => handleSearchChange('')} aria-label="Xóa tìm kiếm">
                <X size={15} />
              </button>
            )}
          </label>

          <button className="icon-button add-top" aria-label="Thêm nhạc YouTube" onClick={() => setShowAddModal(true)}>
            <Plus size={20} />
          </button>
        </header>

        {/* MOBILE CATEGORY SCROLL BAR CHO IPHONE */}
        <div className="mobile-categories">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                className={`cat-pill ${activeTab === cat.id && !searchQuery ? 'active' : ''}`}
                onClick={() => { setActiveTab(cat.id); setSearchQuery(''); }}
              >
                <Icon size={14} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* HERO BANNER */}
        {activeTab === 'trending' && !searchQuery && (
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow"><span className="live-dot" /> YOUTUBE LIVE SYNC · CẬP NHẬT LIÊN TỤC</span>
              <h1>Nghe nhạc YouTube.<br /><em>Không gián đoạn.</em></h1>
              <p>Tự động cập nhật các bản nhạc thịnh hành nhất hôm nay.<br className="desktop-break" /> Phát nền mượt mà khi tắt màn hình iPhone.</p>
              <div className="hero-actions">
                <button
                  className="primary-button"
                  onClick={() => currentSongList.length > 0 && playSong(currentSongList[0])}
                >
                  <Play size={17} fill="currentColor" /> Phát ngay hôm nay
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setShowAddModal(true)}
                >
                  <ListPlus size={16} /> Nhập Playlist YouTube
                </button>
              </div>
            </div>
            <div className="hero-art">
              <div className="orbit orbit-one" /><div className="orbit orbit-two" />
              <div className="moon-art">
                <div className="moon-crater crater-one" />
                <div className="moon-crater crater-two" />
                <div className="moon-crater crater-three" />
              </div>
              <span className="star star-one">✦</span>
              <span className="star star-two">✧</span>
              <span className="star star-three">·</span>
            </div>
          </section>
        )}

        {/* MUSIC SECTION */}
        <section className="music-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {searchQuery ? 'YOUTUBE SEARCH RESULTS' : activeTab.toUpperCase()}
              </span>
              <h2>
                {searchQuery
                  ? `Kết quả cho "${searchQuery}"`
                  : activeTab === 'favorites'
                  ? 'Bài hát yêu thích của bạn'
                  : activeTab === 'history'
                  ? 'Lịch sử nghe gần đây'
                  : activeTab === 'library'
                  ? 'Thư viện bài hát đã lưu'
                  : `Nhạc ${CATEGORIES.find((c) => c.id === activeTab)?.label || 'Thịnh hành'} YouTube`}
              </h2>
            </div>
            {!searchQuery && (
              <button className="text-button" onClick={() => setShowAddModal(true)}>
                <Plus size={16} /> Nhập bài / Playlist
              </button>
            )}
          </div>

          {/* LOADING STATE */}
          {loadingCategory && currentSongList.length === 0 && (
            <div className="empty-state">
              <Loader2 size={32} className="spinner" />
              <p>Đang đồng bộ bài hát trực tiếp từ YouTube…</p>
            </div>
          )}

          {/* EMPTY STATE */}
          {!loadingCategory && currentSongList.length === 0 && (
            <div className="empty-state">
              <Library size={36} />
              <p>
                {searchQuery
                  ? 'Không tìm thấy kết quả phù hợp trên YouTube.'
                  : activeTab === 'favorites'
                  ? 'Bạn chưa có bài hát yêu thích nào. Bấm trái tim ở bài hát bất kỳ để lưu!'
                  : 'Chưa có bài hát ở mục này.'}
              </p>
              <button className="primary-button" onClick={() => setShowAddModal(true)}>
                <Plus size={16} /> Nhập nhạc từ YouTube
              </button>
            </div>
          )}

          {/* SONG GRID */}
          <div className="song-grid">
            {currentSongList.map((song, index) => {
              const songKey = song.videoId || song.id;
              const isSelected = (current?.videoId || current?.id) === songKey;
              const isItemPlaying = isSelected && isPlaying;
              const isLiked = favorites.some((s) => (s.videoId || s.id) === songKey);

              return (
                <article
                  key={song.id || `${song.videoId}-${index}`}
                  className={`song-card ${isSelected ? 'selected' : ''}`}
                >
                  <button
                    className="cover-button"
                    onClick={() => playSong(song)}
                    aria-label={`Phát ${song.title}`}
                  >
                    <img
                      src={song.cover || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
                      alt={song.title}
                      loading="lazy"
                    />
                    <span className="cover-play">
                      {isItemPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                    </span>
                    <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
                    {song.duration && <span className="duration-tag">{song.duration}</span>}
                  </button>

                  <div className="song-meta">
                    <div className="song-text" onClick={() => playSong(song)}>
                      <h3 title={song.title}>{song.title}</h3>
                      <p title={song.artist}>{song.artist}</p>
                    </div>
                    <button
                      className={`heart-button ${isLiked ? 'liked' : ''}`}
                      aria-label="Yêu thích"
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(song); }}
                    >
                      <Heart size={18} fill={isLiked ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <footer className="footer">
          <span>© 2026 NOCTRA · Tối ưu cho iPhone Safari & Màn hình khóa</span>
          <span>YouTube Live Sync <span className="footer-star">✦</span></span>
        </footer>
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="mobile-nav">
        <button
          className={activeTab === 'trending' && !searchQuery ? 'active' : ''}
          onClick={() => { setActiveTab('trending'); setSearchQuery(''); }}
        >
          <Flame size={20} />
          <span>Thịnh hành</span>
        </button>
        <button
          className={activeTab === 'vpop' && !searchQuery ? 'active' : ''}
          onClick={() => { setActiveTab('vpop'); setSearchQuery(''); }}
        >
          <Sparkles size={20} />
          <span>V-Pop</span>
        </button>
        <button
          className={activeTab === 'favorites' && !searchQuery ? 'active' : ''}
          onClick={() => { setActiveTab('favorites'); setSearchQuery(''); }}
        >
          <Heart size={20} />
          <span>Yêu thích</span>
        </button>
        <button
          className={activeTab === 'history' && !searchQuery ? 'active' : ''}
          onClick={() => { setActiveTab('history'); setSearchQuery(''); }}
        >
          <Clock3 size={20} />
          <span>Gần đây</span>
        </button>
        <button onClick={() => setShowAddModal(true)}>
          <Plus size={20} />
          <span>Thêm nhạc</span>
        </button>
      </nav>

      {/* NOW PLAYING BOTTOM BAR */}
      <section className={`now-playing ${current ? 'has-song' : ''}`}>
        <div className="now-song" onClick={() => current && setShowPlayer(true)}>
          {current ? (
            <img
              className="now-cover"
              src={current.cover || `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`}
              alt={current.title}
            />
          ) : (
            <div className="now-cover placeholder"><Headphones size={22} /></div>
          )}
          <div className="now-info">
            <b title={current?.title}>{current?.title || 'Chưa phát bài nào'}</b>
            <span title={current?.artist}>
              {loadingTrack ? 'Đang tải luồng âm thanh...' : current?.artist || 'Chọn một bài YouTube để bắt đầu'}
            </span>
          </div>
        </div>

        <div className="player-controls">
          <button
            className="control-subtle desktop-only"
            onClick={() => setShuffle(!shuffle)}
            aria-label="Phát ngẫu nhiên"
            style={{ color: shuffle ? 'var(--accent)' : 'inherit' }}
          >
            <Shuffle size={17} />
          </button>

          <button className="control-subtle" onClick={previousSong} aria-label="Bài trước">
            <SkipBack size={20} fill="currentColor" />
          </button>

          <button className="play-button" onClick={togglePlay} aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}>
            {loadingTrack ? <Loader2 size={20} className="spinner" /> : isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>

          <button className="control-subtle" onClick={nextSong} aria-label="Bài tiếp">
            <SkipForward size={20} fill="currentColor" />
          </button>

          <button
            className="control-subtle desktop-only"
            onClick={() => {
              const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
              setRepeatMode(next);
            }}
            aria-label="Lặp lại"
            style={{ color: repeatMode !== 'off' ? 'var(--accent)' : 'inherit' }}
          >
            {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        <div className="player-extra">
          <button
            className={`heart-button ${isFavorite ? 'liked' : ''}`}
            onClick={() => current && toggleFavorite(current)}
            aria-label="Yêu thích"
          >
            <Heart size={19} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>

          <button className="control-subtle" onClick={() => setShowPlayer(true)} aria-label="Mở trình phát">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </section>

      {/* FULLSCREEN PLAYER OVERLAY */}
      {showPlayer && current && (
        <div className="player-overlay" role="dialog" aria-modal="true" aria-label="Trình phát nhạc">
          <button className="overlay-close" onClick={() => setShowPlayer(false)} aria-label="Đóng">
            <X size={22} />
          </button>
          <div className="player-overlay-inner">
            <span className="eyebrow"><AudioLines size={14} /> ĐANG PHÁT TỪ YOUTUBE</span>
            <div className="large-cover">
              <img
                src={current.cover || `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`}
                alt={current.title}
              />
            </div>

            <div className="overlay-song-row">
              <div className="overlay-titles">
                <h2>{current.title}</h2>
                <p>{current.artist}</p>
              </div>
              <button
                className={`heart-button big ${isFavorite ? 'liked' : ''}`}
                onClick={() => toggleFavorite(current)}
              >
                <Heart size={24} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            </div>

            {/* THANH THỜI GIAN TIẾN ĐỘ THẬT */}
            <div style={{ width: '100%', margin: '14px 0 6px' }}>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = val;
                  setCurrentTime(val);
                }}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b8e98', marginTop: 4 }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="overlay-controls">
              <button
                className={`mode-btn ${shuffle ? 'active' : ''}`}
                onClick={() => setShuffle(!shuffle)}
                aria-label="Ngẫu nhiên"
              >
                <Shuffle size={20} />
              </button>

              <button onClick={previousSong} aria-label="Bài trước">
                <SkipBack size={26} fill="currentColor" />
              </button>

              <button className="overlay-play" onClick={togglePlay} aria-label={isPlaying ? 'Tạm dừng' : 'Phát'}>
                {isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
              </button>

              <button onClick={nextSong} aria-label="Bài tiếp">
                <SkipForward size={26} fill="currentColor" />
              </button>

              <button
                className={`mode-btn ${repeatMode !== 'off' ? 'active' : ''}`}
                onClick={() => {
                  const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
                  setRepeatMode(next);
                }}
                aria-label="Lặp lại"
              >
                {repeatMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>

            {current.videoId && (
              <a
                className="youtube-link"
                href={`https://www.youtube.com/watch?v=${current.videoId}`}
                target="_blank"
                rel="noreferrer"
                style={{ marginTop: 10 }}
              >
                <Youtube size={17} /> Mở bài này trên YouTube <ExternalLink size={13} />
              </a>
            )}

            <p className="background-note" style={{ marginTop: 16 }}>
              ✨ Đã hỗ trợ phát nền & điều khiển trên màn hình khóa iPhone qua MediaSession.
            </p>
          </div>
        </div>
      )}

      {/* ADD / IMPORT PLAYLIST MODAL */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <span className="eyebrow">YOUTUBE IMPORT</span>
                <h2>Thêm nhạc từ YouTube</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setShowAddModal(false)}>
                <X size={20} />
              </button>
            </div>

            {/* TAB SELECTOR: BÀI ĐƠN HOẶC TOÀN BỘ PLAYLIST */}
            <div className="modal-mode-tabs">
              <button
                type="button"
                className={`mode-tab ${addMode === 'single' ? 'active' : ''}`}
                onClick={() => setAddMode('single')}
              >
                1 Bài hát bất kỳ
              </button>
              <button
                type="button"
                className={`mode-tab ${addMode === 'playlist' ? 'active' : ''}`}
                onClick={() => setAddMode('playlist')}
              >
                Nhập cả Playlist YouTube
              </button>
            </div>

            <form onSubmit={handleAddSubmit}>
              {addMode === 'playlist' ? (
                <>
                  <label className="field-label">
                    Đường dẫn Playlist YouTube
                    <input
                      required
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                      placeholder="https://www.youtube.com/playlist?list=PL..."
                    />
                  </label>
                  <p className="form-hint">
                    <ListPlus size={16} /> Tự động quét và lưu toàn bộ danh sách 20-50 bài hát từ playlist vào máy.
                  </p>
                </>
              ) : (
                <>
                  <label className="field-label">
                    Đường dẫn video, ID YouTube hoặc link MP3
                    <input
                      required
                      value={addUrl}
                      onChange={(e) => setAddUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=... hoặc youtu.be/..."
                    />
                  </label>
                  <label className="field-label">
                    Tên bài hát <span>(Tự động nhận diện từ YouTube nếu để trống)</span>
                    <input
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      placeholder="Tự động nhận diện..."
                    />
                  </label>
                  <label className="field-label">
                    Ca sĩ / Kênh <span>(Tự động nhận diện từ YouTube nếu để trống)</span>
                    <input
                      value={addArtist}
                      onChange={(e) => setAddArtist(e.target.value)}
                      placeholder="Tự động nhận diện..."
                    />
                  </label>
                </>
              )}

              <button className="primary-button submit-button" type="submit" disabled={submittingAdd}>
                {submittingAdd ? (
                  <><Loader2 size={18} className="spinner" /> Đang xử lý từ YouTube…</>
                ) : (
                  <><Plus size={18} /> {addMode === 'playlist' ? 'Nhập toàn bộ Playlist' : 'Thêm bài vào thư viện'}</>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {notice && (
        <button className="toast" onClick={() => setNotice('')}>
          <Check size={16} />
          <span>{notice}</span>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
