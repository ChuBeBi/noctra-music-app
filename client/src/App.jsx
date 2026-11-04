import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Heart, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Flame, Sparkles, Moon, Music, Radio, Plus, Trash2, X, ListPlus,
  Volume2, Clock, Zap, Disc3, Tv, Image as ImageIcon
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

// Ngăn WebKit/YouTube tự động tạm dừng khi màn hình điện thoại khóa hoặc đổi tab
try {
  if (typeof document !== 'undefined') {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    document.hasFocus = () => true;
    window.addEventListener('visibilitychange', (e) => {
      e.stopImmediatePropagation();
    }, true);
  }
} catch (_) {}

// Âm thanh giữ nhịp chạy nền nhẹ 1KB cho iOS Safari Lock-Screen
const SILENT_CARRIER_AUDIO = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

const CATEGORIES = [
  { id: 'trending', label: 'Thịnh hành', icon: Flame },
  { id: 'vpop', label: 'V-Pop Hot', icon: Sparkles },
  { id: 'lofi', label: 'Lofi Chill', icon: Moon },
  { id: 'acoustic', label: 'Acoustic', icon: Music },
  { id: 'sleep', label: 'Nhạc Ngủ', icon: Radio },
  { id: 'remix', label: 'Remix TikTok', icon: Zap }
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
  if (!sec || Number.isNaN(sec) || sec < 0) return '0:00';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [loadingCategory, setLoadingCategory] = useState(false);

  // Playback states
  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [loopMode, setLoopMode] = useState('all'); // "all" | "one"
  const [shuffle, setShuffle] = useState(false);
  const [favorites, setFavorites] = useState(() => getStored('noctra_fav_v3', []));
  const [history, setHistory] = useState(() => getStored('noctra_hist_v3', []));
  const [notice, setNotice] = useState('');
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showVideo, setShowVideo] = useState(false);

  // Modal thêm bài hoặc nạp Playlist YouTube
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState('single');
  const [addUrl, setAddUrl] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addArtist, setAddArtist] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // References
  const ytPlayerRef = useRef(null);
  const isYtReadyRef = useRef(false);
  const audioRef = useRef(null);
  const currentRef = useRef(null);
  currentRef.current = current;
  const loopModeRef = useRef(loopMode);
  loopModeRef.current = loopMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const searchTimeoutRef = useRef(null);
  const progressBarRef = useRef(null);

  const showToast = (msg) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? '' : prev));
    }, 3200);
  };

  /**
   * KÍCH HOẠT CHẾ ĐỘ PHÁT NỀN CHÍNH THỨC CỦA APPLE (iOS 17/18+ AudioSession API)
   */
  const activateIosPlaybackSession = () => {
    try {
      if ('audioSession' in navigator) {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) {}
  };

  // Đồng bộ LocalStorage
  useEffect(() => {
    localStorage.setItem('noctra_fav_v3', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('noctra_hist_v3', JSON.stringify(history));
  }, [history]);

  // Tải danh sách bài hát trong Thư viện
  const loadLibrary = useCallback(() => {
    fetch(`${API}/songs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.songs)) {
          setLibrarySongs(data.songs);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  // Tải danh sách bài hát YouTube theo danh mục
  const fetchCategorySongs = useCallback((catId) => {
    if (categorySongs[catId]?.length > 0) return;
    setLoadingCategory(true);
    fetch(`${API}/trending?category=${catId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (Array.isArray(data.songs) && data.songs.length > 0) {
          setCategorySongs((prev) => ({ ...prev, [catId]: data.songs }));
        }
      })
      .catch(() => {
        showToast('Không thể tải bài hát từ YouTube. Đang thử lại...');
      })
      .finally(() => setLoadingCategory(false));
  }, [categorySongs]);

  useEffect(() => {
    const isCat = CATEGORIES.some((c) => c.id === activeTab);
    if (isCat) {
      fetchCategorySongs(activeTab);
    }
  }, [activeTab, fetchCategorySongs]);

  // Danh sách bài đang hiển thị tùy theo Tab hoặc kết quả Tìm kiếm
  const currentSongList = useMemo(() => {
    if (searchQuery.trim().length > 0) return searchResults;
    if (activeTab === 'favorites') return favorites;
    if (activeTab === 'history') return history;
    if (activeTab === 'library') return librarySongs;
    return categorySongs[activeTab] || [];
  }, [searchQuery, searchResults, activeTab, favorites, history, librarySongs, categorySongs]);

  const listRef = useRef(currentSongList);
  listRef.current = currentSongList;

  // Đồng bộ thông tin lên Màn hình khóa iPhone (iOS MediaSession Lock Screen)
  const updateMediaSession = (song) => {
    if (!('mediaSession' in navigator) || !song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'NOCTRA Music',
        artist: song.artist || 'YouTube Music',
        album: 'NOCTRA Studio HD',
        artwork: [
          {
            src: song.cover || song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      });
    } catch (_) {}
  };

  const nextSong = useCallback(() => {
    const list = listRef.current;
    if (!list || !list.length) return;
    if (shuffleRef.current && list.length > 1) {
      const randomIndex = Math.floor(Math.random() * list.length);
      playSong(list[randomIndex]);
      return;
    }
    const idx = list.findIndex((s) => (s.videoId || s.id) === (currentRef.current?.videoId || currentRef.current?.id));
    const nextIdx = (idx + 1) % list.length;
    playSong(list[nextIdx]);
  }, []);

  const previousSong = useCallback(() => {
    const list = listRef.current;
    if (!list || !list.length) return;
    const idx = list.findIndex((s) => (s.videoId || s.id) === (currentRef.current?.videoId || currentRef.current?.id));
    const prevIdx = (idx - 1 + list.length) % list.length;
    playSong(list[prevIdx]);
  }, []);

  // KHỞI TẠO DUY NHẤT 1 LẦN TRÌNH PHÁT YOUTUBE ENGINE CHÍNH THỨC
  useEffect(() => {
    const setupYT = () => {
      if (window.YT && window.YT.Player && !ytPlayerRef.current) {
        const el = document.getElementById('noctra-permanent-player');
        if (!el) return;
        try {
          ytPlayerRef.current = new window.YT.Player('noctra-permanent-player', {
            height: '100%',
            width: '100%',
            videoId: 'sK7wnxvd3hA',
            playerVars: {
              autoplay: 0,
              playsinline: 1,
              controls: 0,
              disablekb: 1,
              fs: 0,
              modestbranding: 1,
              rel: 0
            },
            events: {
              onReady: () => {
                isYtReadyRef.current = true;
              },
              onStateChange: (event) => {
                // 1 = PLAYING (Đang phát - tải thành công tức thì)
                if (event.data === 1) {
                  setIsPlaying(true);
                  setLoadingTrack(false);
                  const d = event.target.getDuration();
                  if (d && !Number.isNaN(d)) setDuration(d);
                  if (currentRef.current) updateMediaSession(currentRef.current);
                  if (audioRef.current) {
                    audioRef.current.play().catch(() => {});
                  }
                } else if (event.data === 2) {
                  // 2 = PAUSED
                  setIsPlaying(false);
                } else if (event.data === 0) {
                  // 0 = ENDED (Hết bài - Tự động chuyển bài kế tiếp)
                  if (loopModeRef.current === 'one') {
                    event.target.seekTo(0);
                    event.target.playVideo();
                  } else {
                    nextSong();
                  }
                } else if (event.data === 3) {
                  // 3 = BUFFERING
                  setLoadingTrack(true);
                } else if (event.data === 5) {
                  // 5 = CUED -> Tự động kích hoạt phát
                  try {
                    event.target.playVideo();
                  } catch (_) {}
                }
              },
              onError: (err) => {
                console.warn('YouTube Player error code:', err.data);
                showToast('Video YouTube hạn chế nhúng, đang chuyển bài kế...');
                setTimeout(() => nextSong(), 1000);
              }
            }
          });
        } catch (e) {
          console.warn('Lỗi init YT player:', e);
        }
      }
    };

    window.onYouTubeIframeAPIReady = setupYT;

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    }

    const checkInterval = setInterval(() => {
      if (window.YT && window.YT.Player) {
        clearInterval(checkInterval);
        setupYT();
      }
    }, 150);

    return () => clearInterval(checkInterval);
  }, [nextSong]);

  // Đăng ký nút điều khiển trên Màn hình khóa iPhone (Play, Pause, Next, Prev, Seek)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        if (ytPlayerRef.current) {
          try { ytPlayerRef.current.playVideo(); } catch (_) {}
        }
        if (audioRef.current) audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (ytPlayerRef.current) {
          try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
        }
        if (audioRef.current) audioRef.current.pause();
        setIsPlaying(false);
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => previousSong());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSong());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null && ytPlayerRef.current) {
          try { ytPlayerRef.current.seekTo(details.seekTime, true); } catch (_) {}
          setCurrentTime(details.seekTime);
        }
      });
    } catch (_) {}
  }, [nextSong, previousSong]);

  // Cài đặt tốc độ phát
  useEffect(() => {
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackRate === 'function') {
      try { ytPlayerRef.current.setPlaybackRate(playbackRate); } catch (_) {}
    }
  }, [playbackRate]);

  // Phát bài hát YouTube 1 chạm tức thì
  const playSong = useCallback((song) => {
    if (!song) return;
    activateIosPlaybackSession();
    setCurrent(song);
    setLoadingTrack(true);
    setIsPlaying(true);
    setHistory((prev) => [song, ...prev.filter((s) => (s.videoId || s.id) !== (song.videoId || song.id))].slice(0, 50));
    updateMediaSession(song);

    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }

    const videoId = song.videoId || (song.id?.startsWith('yt-') ? song.id.replace('yt-', '') : song.id);
    if (!videoId) return;

    if (ytPlayerRef.current && isYtReadyRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      try {
        ytPlayerRef.current.loadVideoById(videoId);
        ytPlayerRef.current.playVideo();
      } catch (_) {}
    } else {
      let tries = 0;
      const checkYt = setInterval(() => {
        tries += 1;
        if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
          clearInterval(checkYt);
          try {
            ytPlayerRef.current.loadVideoById(videoId);
            ytPlayerRef.current.playVideo();
          } catch (_) {}
        } else if (tries > 25) {
          clearInterval(checkYt);
          setLoadingTrack(false);
        }
      }, 150);
    }
  }, []);

  // Cập nhật thanh tiến trình theo thời gian thực của YouTube
  useEffect(() => {
    let interval = null;
    if (isPlaying) {
      interval = setInterval(() => {
        if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
          try {
            const t = ytPlayerRef.current.getCurrentTime();
            if (t != null && !Number.isNaN(t)) setCurrentTime(t);
            const d = ytPlayerRef.current.getDuration();
            if (d != null && !Number.isNaN(d) && d > 0) setDuration(d);
          } catch (_) {}
        }
      }, 400);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    activateIosPlaybackSession();
    if (!current) {
      if (currentSongList.length > 0) playSong(currentSongList[0]);
      return;
    }

    if (ytPlayerRef.current) {
      if (isPlaying) {
        try { ytPlayerRef.current.pauseVideo(); } catch (_) {}
        if (audioRef.current) audioRef.current.pause();
        setIsPlaying(false);
      } else {
        try { ytPlayerRef.current.playVideo(); } catch (_) {}
        if (audioRef.current) audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  // Kéo thanh tiến trình tua bài hát mượt mà
  const handleSeek = (e) => {
    if (!progressBarRef.current || !duration || !ytPlayerRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = clickX / rect.width;
    const targetTime = ratio * duration;
    try {
      ytPlayerRef.current.seekTo(targetTime, true);
      setCurrentTime(targetTime);
    } catch (_) {}
  };

  // Đổi tốc độ phát
  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 0.75];
    const curIdx = rates.indexOf(playbackRate);
    const nextRate = rates[(curIdx + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackRate === 'function') {
      try {
        ytPlayerRef.current.setPlaybackRate(nextRate);
      } catch (_) {}
    }
    showToast(`⚡ Tốc độ phát: ${nextRate}x`);
  };

  // Cài đặt hẹn giờ tắt
  const setSleepTimer = (minutes) => {
    setSleepMinutesLeft(minutes);
    setShowSleepMenu(false);
    if (minutes > 0) {
      showToast(`🌙 Đã hẹn giờ tắt nhạc sau ${minutes} phút`);
    } else {
      showToast('Đã hủy hẹn giờ ngủ');
    }
  };

  // Đếm ngược hẹn giờ
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
          if (ytPlayerRef.current) {
            try {
              ytPlayerRef.current.pauseVideo();
            } catch (_) {}
          }
          if (audioRef.current) audioRef.current.pause();
          setIsPlaying(false);
          showToast('Đã tự động tắt nhạc theo hẹn giờ ngủ 🌙');
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [sleepMinutesLeft]);

  // Thêm/Xóa yêu thích
  const toggleFavorite = (song) => {
    if (!song) return;
    const id = song.videoId || song.id;
    const exists = favorites.some((f) => (f.videoId || f.id) === id);
    if (exists) {
      setFavorites((prev) => prev.filter((f) => (f.videoId || f.id) !== id));
      showToast('Đã bỏ yêu thích');
    } else {
      setFavorites((prev) => [song, ...prev]);
      showToast('♥ Đã thêm vào bài hát yêu thích');
    }
  };

  // Tìm kiếm trực tiếp YouTube
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
    }, 350);
  };

  // Thêm nhạc đơn hoặc cả playlist
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!addUrl.trim()) return;

    setSubmittingAdd(true);
    try {
      if (addMode === 'playlist') {
        const res = await fetch(`${API}/playlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: addUrl.trim() })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Không thể đọc playlist');
        showToast(data.message || 'Đã nạp playlist thành công!');
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
        showToast(`Đã thêm bài hát: ${data.song.title}`);
        loadLibrary();
        setAddUrl('');
        setAddTitle('');
        setAddArtist('');
        setShowAddModal(false);
        setActiveTab('library');
      }
    } catch (err) {
      showToast(err.message || 'Lỗi khi nhập bài hát');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleDeleteSong = async (id) => {
    try {
      await fetch(`${API}/songs/${id}`, { method: 'DELETE' });
      setLibrarySongs((prev) => prev.filter((s) => s.id !== id && s.videoId !== id && `yt-${s.videoId}` !== id));
      showToast('Đã xóa bài hát khỏi Thư viện.');
    } catch (_) {}
  };

  // MediaSession Action handlers cho Màn hình khóa iPhone / Dynamic Island / AirPods
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    const actions = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['previoustrack', () => previousSong()],
      ['nexttrack', () => nextSong()],
      [
        'seekto',
        (details) => {
          if (ytPlayerRef.current && details.seekTime != null) {
            ytPlayerRef.current.seekTo(details.seekTime, true);
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

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const isCurrentFav = current && favorites.some((s) => (s.videoId || s.id) === (current.videoId || current.id));

  return (
    <div style={styles.page}>
      {/* Dynamic Ambient Glow theo bài hát */}
      {current && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: `radial-gradient(circle at 50% 15%, rgba(168, 85, 247, 0.28), rgba(6, 182, 212, 0.12) 60%, transparent 80%)`
          }}
        />
      )}

      <div style={styles.container}>
        {/* TOP BAR / HEADER */}
        <header style={styles.topBar}>
          <div style={styles.brandGroup}>
            <div style={styles.logoWrap}>
              <Disc3 size={24} style={{ color: '#c084fc', animation: isPlaying ? 'spin 6s linear infinite' : 'none' }} />
              <span style={styles.logoText}>NOCTRA</span>
              <span style={styles.proTag}>STUDIO</span>
            </div>
          </div>

          <div style={styles.topActions}>
            <button
              type="button"
              onClick={() => setShowSleepMenu(!showSleepMenu)}
              style={{
                ...styles.topBtn,
                background: sleepMinutesLeft > 0 ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                borderColor: sleepMinutesLeft > 0 ? '#eab308' : 'rgba(255, 255, 255, 0.12)',
                color: sleepMinutesLeft > 0 ? '#fde047' : '#cbd5e1'
              }}
              title="Hẹn giờ ngủ"
            >
              <Clock size={15} />
              {sleepMinutesLeft > 0 ? `${sleepMinutesLeft}p` : ''}
            </button>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              style={styles.addTrackBtn}
            >
              <Plus size={16} /> Nhập nhạc
            </button>
          </div>
        </header>

        {/* MENU HẸN GIỜ NGỦ POPUP */}
        {showSleepMenu && (
          <div style={styles.sleepMenuPopup}>
            <div style={styles.sleepMenuHeader}>
              <span>🌙 Hẹn giờ tắt nhạc</span>
              <button type="button" onClick={() => setShowSleepMenu(false)} style={styles.popupClose}>
                <X size={14} />
              </button>
            </div>
            <div style={styles.sleepOptions}>
              {[15, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSleepTimer(m)}
                  style={{
                    ...styles.sleepOptionBtn,
                    ...(sleepMinutesLeft === m ? styles.sleepOptionActive : {})
                  }}
                >
                  {m} phút
                </button>
              ))}
              {sleepMinutesLeft > 0 && (
                <button
                  type="button"
                  onClick={() => setSleepTimer(0)}
                  style={styles.sleepCancelBtn}
                >
                  Tắt hẹn giờ
                </button>
              )}
            </div>
          </div>
        )}

        {/* TOAST THÔNG BÁO */}
        {notice && <div style={styles.toast}>{notice}</div>}

        {/* KHUNG PHÁT CHÍNH HERO PLAYER (CHỨA MÁY PHÁT YOUTUBE CỐ ĐỊNH) */}
        <section style={styles.heroPlayerCard}>
          <div style={styles.deckTopSection}>
            {/* VÙNG VIDEO & ẢNH BÌA */}
            <div style={styles.mediaStage}>
              {/* KHUNG IFRAME YOUTUBE CHÍNH THỨC CỐ ĐỊNH (LUÔN TỒN TẠI TRONG DOM) */}
              <div style={styles.permanentYtWrap}>
                <div id="noctra-permanent-player" style={styles.permanentYtFrame} />
              </div>

              {/* LỚP PHỦ ẢNH BÌA KHI KHÔNG BẬT CHẾ ĐỘ XEM MV */}
              {!showVideo && (
                <div style={styles.coverOverlay}>
                  {current ? (
                    <img
                      src={current.cover || current.thumbnail || `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`}
                      alt={current.title}
                      style={styles.coverOverlayImg}
                    />
                  ) : (
                    <div style={styles.coverPlaceholder}>
                      <Disc3 size={40} style={{ color: '#8b5cf6', opacity: 0.6 }} />
                    </div>
                  )}

                  {current && (
                    <div style={styles.soundwaveBadge}>
                      {loadingTrack ? (
                        <span style={styles.pulseDot}>⚡ Đang nạp...</span>
                      ) : isPlaying ? (
                        <div style={styles.equalizerWrap}>
                          <span style={{ ...styles.eqBar, animationDuration: '0.6s' }} />
                          <span style={{ ...styles.eqBar, animationDuration: '0.9s' }} />
                          <span style={{ ...styles.eqBar, animationDuration: '0.7s' }} />
                          <span style={styles.soundwaveText}>Đang phát</span>
                        </div>
                      ) : (
                        <span style={styles.soundwaveText}>Tạm dừng</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* THÔNG TIN BÀI HÁT */}
            <div style={styles.metaContainer}>
              <div style={styles.titleRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={styles.heroTitle} title={current?.title || 'Chưa chọn bài hát'}>
                    {current?.title || 'NOCTRA Music'}
                  </h2>
                  <p style={styles.heroArtist}>
                    {current?.artist || 'Chạm vào bài hát bất kỳ bên dưới để phát'}
                  </p>
                </div>
                {current && (
                  <button
                    type="button"
                    onClick={() => toggleFavorite(current)}
                    style={{
                      ...styles.heroFavBtn,
                      color: isCurrentFav ? '#f43f5e' : '#64748b'
                    }}
                  >
                    <Heart size={20} fill={isCurrentFav ? '#f43f5e' : 'none'} />
                  </button>
                )}
              </div>

              <div style={styles.tagsRow}>
                <span style={styles.specBadge}>YouTube Direct Audio</span>
                {current && (
                  <button
                    type="button"
                    onClick={() => setShowVideo(!showVideo)}
                    style={styles.toggleVideoBtn}
                  >
                    {showVideo ? <ImageIcon size={12} /> : <Tv size={12} />}
                    <span>{showVideo ? 'Ảnh bìa' : 'Xem MV'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* THANH TIẾN TRÌNH THỜI GIAN CUSTOM PRECISION */}
          <div style={styles.timelineArea}>
            <div
              ref={progressBarRef}
              onClick={handleSeek}
              onTouchStart={handleSeek}
              style={styles.scrubberTrack}
            >
              <div
                style={{
                  ...styles.scrubberFill,
                  width: `${progressPercent}%`
                }}
              >
                <span style={styles.scrubberKnob} />
              </div>
            </div>

            <div style={styles.timeLabels}>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* BỘ ĐIỀU KHIỂN PHÁT NHẠC */}
          <div style={styles.controlDeck}>
            <button
              type="button"
              onClick={() => setShuffle(!shuffle)}
              style={{
                ...styles.deckIconBtn,
                color: shuffle ? '#c084fc' : '#64748b',
                background: shuffle ? 'rgba(192, 132, 252, 0.16)' : 'transparent'
              }}
              title={shuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle size={18} />
            </button>

            <button
              type="button"
              onClick={previousSong}
              style={styles.deckNavBtn}
              title="Bài trước"
            >
              <SkipBack size={20} />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              style={styles.deckPlayBtn}
              title={isPlaying ? 'Tạm dừng' : 'Phát nhạc'}
            >
              {loadingTrack ? (
                <span style={{ fontSize: 18 }}>⏳</span>
              ) : isPlaying ? (
                <Pause size={24} fill="#fff" />
              ) : (
                <Play size={24} fill="#fff" style={{ marginLeft: 3 }} />
              )}
            </button>

            <button
              type="button"
              onClick={nextSong}
              style={styles.deckNavBtn}
              title="Bài tiếp"
            >
              <SkipForward size={20} />
            </button>

            <button
              type="button"
              onClick={() => {
                const next = loopMode === 'all' ? 'one' : 'all';
                setLoopMode(next);
                showToast(next === 'one' ? '🔂 Lặp 1 bài' : '🔁 Lặp toàn bộ danh sách');
              }}
              style={{
                ...styles.deckIconBtn,
                color: loopMode === 'one' ? '#38bdf8' : '#64748b',
                background: loopMode === 'one' ? 'rgba(56, 189, 248, 0.16)' : 'transparent'
              }}
              title={loopMode === 'one' ? 'Đang lặp 1 bài' : 'Đang lặp danh sách'}
            >
              <Repeat size={18} />
            </button>
          </div>

          {/* CẦU NỐI ÂM THANH PHẦN CỨNG IOS (GIỮ CHẠY KHI KHÓA MÀN HÌNH) */}
          <div style={styles.hardwareCapsule}>
            <span style={styles.capsuleLabel}>
              <Volume2 size={13} style={{ color: '#86efac' }} /> Luồng phần cứng iOS Lock-Screen
            </span>
            <button type="button" onClick={cyclePlaybackRate} style={styles.ratePill}>
              {playbackRate}x
            </button>
          </div>

          {/* LUỒNG CARRIER ÂM THANH PHẦN CỨNG GIỮ PHÁT NỀN IOS KHI TẮT MÀN HÌNH */}
          <audio
            ref={audioRef}
            playsInline
            loop
            preload="auto"
            src={SILENT_CARRIER_AUDIO}
            style={{ display: 'none' }}
          />
        </section>

        {/* THANH TÌM KIẾM YOUTUBE OMNI-SEARCH */}
        <div style={styles.searchWrap}>
          <div style={styles.searchBar}>
            <Search size={17} style={{ color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Tìm mọi bài hát, ca sĩ, giai điệu trên YouTube..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={styles.searchInput}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                }}
                style={styles.clearSearchBtn}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {isSearching && (
            <div style={styles.searchLoadingIndicator}>
              ⚡ Đang tìm kiếm trên YouTube...
            </div>
          )}
        </div>

        {/* THANH DANH MỤC THỊNH HÀNH (PILLS CUỘN NGANG) */}
        <nav style={styles.categoryScroller}>
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = activeTab === cat.id && !searchQuery;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveTab(cat.id);
                  setSearchQuery('');
                }}
                style={{
                  ...styles.catPill,
                  ...(active ? styles.catPillActive : {})
                }}
              >
                <Icon size={14} />
                <span>{cat.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setActiveTab('favorites');
              setSearchQuery('');
            }}
            style={{
              ...styles.catPill,
              ...(activeTab === 'favorites' && !searchQuery ? styles.catPillActive : {})
            }}
          >
            <Heart size={14} fill={activeTab === 'favorites' ? '#fff' : 'none'} />
            <span>Yêu thích ({favorites.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('library');
              setSearchQuery('');
            }}
            style={{
              ...styles.catPill,
              ...(activeTab === 'library' && !searchQuery ? styles.catPillActive : {})
            }}
          >
            <ListPlus size={14} />
            <span>Thư viện ({librarySongs.length})</span>
          </button>
        </nav>

        {/* DANH SÁCH BÀI HÁT */}
        <section style={styles.songSection}>
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>
              {searchQuery
                ? `Kết quả YouTube (${currentSongList.length})`
                : activeTab === 'favorites'
                  ? `Bộ sưu tập yêu thích (${favorites.length})`
                  : activeTab === 'library'
                    ? `Thư viện bài hát (${librarySongs.length})`
                    : `YouTube ${CATEGORIES.find((c) => c.id === activeTab)?.label || 'Thịnh hành'}`}
            </h3>
            {loadingCategory && <span style={styles.catLoading}>⚡ Đang cập nhật...</span>}
          </div>

          <div style={styles.songListGrid}>
            {currentSongList.map((song, idx) => {
              const isCurrent = (song.videoId || song.id) === (current?.videoId || current?.id);
              const isFav = favorites.some((f) => (f.videoId || f.id) === (song.videoId || song.id));
              return (
                <div
                  key={song.id || song.videoId || idx}
                  onClick={() => playSong(song)}
                  style={{
                    ...styles.songRowCard,
                    ...(isCurrent ? styles.songRowCardActive : {})
                  }}
                >
                  <div style={styles.thumbWrapper}>
                    <img
                      src={song.cover || song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
                      alt={song.title}
                      style={styles.songThumb}
                      loading="lazy"
                    />
                    {isCurrent && isPlaying && (
                      <div style={styles.thumbPlayingOverlay}>
                        <div style={styles.miniEq}>
                          <span style={styles.miniEqBar} />
                          <span style={styles.miniEqBar} />
                          <span style={styles.miniEqBar} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={styles.songInfo}>
                    <div style={{ ...styles.songName, color: isCurrent ? '#c084fc' : '#f8fafc' }}>
                      {song.title}
                    </div>
                    <div style={styles.songMeta}>
                      <span>{song.artist}</span>
                      {song.duration && <span>• {song.duration}</span>}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(song);
                    }}
                    style={styles.heartBtn}
                  >
                    <Heart size={17} fill={isFav ? '#f43f5e' : 'none'} color={isFav ? '#f43f5e' : '#64748b'} />
                  </button>

                  {activeTab === 'library' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSong(song.id || song.videoId);
                      }}
                      style={styles.trashBtn}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* MODAL THÊM BÀI HÁT HOẶC PLAYLIST YOUTUBE */}
        {showAddModal && (
          <div style={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
            <div style={styles.modalSheet} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Nhập nhạc từ YouTube</h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={styles.modalSegment}>
                <button
                  type="button"
                  onClick={() => setAddMode('single')}
                  style={{
                    ...styles.segmentBtn,
                    ...(addMode === 'single' ? styles.segmentBtnActive : {})
                  }}
                >
                  Bài hát đơn
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('playlist')}
                  style={{
                    ...styles.segmentBtn,
                    ...(addMode === 'playlist' ? styles.segmentBtnActive : {})
                  }}
                >
                  Cả Playlist YouTube
                </button>
              </div>

              <form onSubmit={handleAddSubmit} style={styles.modalForm}>
                <input
                  type="text"
                  placeholder={
                    addMode === 'playlist'
                      ? 'Dán link Playlist YouTube (https://youtube.com/playlist?list=...)'
                      : 'Dán link video YouTube hoặc ID video...'
                  }
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  style={styles.formInput}
                  required
                />
                {addMode === 'single' && (
                  <>
                    <input
                      type="text"
                      placeholder="Tiêu đề bài hát (tự động nhận diện nếu để trống)"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      style={styles.formInput}
                    />
                    <input
                      type="text"
                      placeholder="Tên ca sĩ / nghệ sĩ (tùy chọn)"
                      value={addArtist}
                      onChange={(e) => setAddArtist(e.target.value)}
                      style={styles.formInput}
                    />
                  </>
                )}
                <button
                  type="submit"
                  disabled={submittingAdd}
                  style={styles.modalSubmitButton}
                >
                  {submittingAdd
                    ? 'Đang nhập...'
                    : addMode === 'playlist'
                      ? 'Nạp toàn bộ Playlist vào App'
                      : 'Thêm bài hát vào Thư viện'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes eqBounce {
          0%, 100% { height: 4px; }
          50% { height: 14px; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#07080d',
    color: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    paddingTop: 'max(14px, env(safe-area-inset-top))',
    paddingBottom: 'max(50px, env(safe-area-inset-bottom))',
    paddingLeft: 14,
    paddingRight: 14,
    position: 'relative',
    overflowX: 'hidden'
  },
  ambientGlow: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
    filter: 'blur(80px) saturate(200%)',
    opacity: 0.28,
    pointerEvents: 'none',
    zIndex: 0
  },
  container: {
    maxWidth: 560,
    margin: '0 auto',
    position: 'relative',
    zIndex: 1
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 4
  },
  brandGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 7
  },
  logoText: {
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: '-0.03em',
    background: 'linear-gradient(135deg, #f472b6 0%, #c084fc 50%, #60a5fa 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  proTag: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.08em',
    color: '#38bdf8',
    background: 'rgba(56, 189, 248, 0.14)',
    border: '1px solid rgba(56, 189, 248, 0.3)',
    padding: '2px 6px',
    borderRadius: 6
  },
  topActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  topBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    border: '1px solid',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  addTrackBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(59, 130, 246, 0.25))',
    border: '1px solid rgba(168, 85, 247, 0.5)',
    color: '#f8fafc',
    borderRadius: 999,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer'
  },
  sleepMenuPopup: {
    position: 'absolute',
    top: 54,
    right: 0,
    background: 'rgba(15, 20, 34, 0.96)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    padding: 14,
    zIndex: 90,
    boxShadow: '0 12px 30px rgba(0,0,0,0.6)',
    width: 200
  },
  sleepMenuHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 700,
    color: '#cbd5e1',
    marginBottom: 10
  },
  popupClose: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer'
  },
  sleepOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  sleepOptionBtn: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    color: '#f8fafc',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left'
  },
  sleepOptionActive: {
    background: 'rgba(234, 179, 8, 0.2)',
    borderColor: '#eab308',
    color: '#fde047'
  },
  sleepCancelBtn: {
    background: 'rgba(244, 63, 94, 0.15)',
    border: '1px solid rgba(244, 63, 94, 0.3)',
    borderRadius: 10,
    color: '#fb7185',
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 4
  },
  toast: {
    position: 'fixed',
    bottom: 'max(24px, env(safe-area-inset-bottom))',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid rgba(192, 132, 252, 0.45)',
    color: '#f8fafc',
    padding: '10px 20px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 99,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    whiteSpace: 'nowrap'
  },
  heroPlayerCard: {
    background: 'linear-gradient(180deg, rgba(22, 27, 46, 0.82) 0%, rgba(13, 16, 28, 0.92) 100%)',
    backdropFilter: 'blur(32px)',
    WebkitBackdropFilter: 'blur(32px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 28,
    padding: 16,
    marginBottom: 16,
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)'
  },
  deckTopSection: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    marginBottom: 14
  },
  mediaStage: {
    position: 'relative',
    width: 96,
    height: 96,
    flexShrink: 0,
    borderRadius: 20,
    overflow: 'hidden',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
  },
  permanentYtWrap: {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0
  },
  permanentYtFrame: {
    width: '100%',
    height: '100%'
  },
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 2,
    background: '#0d111d'
  },
  coverOverlayImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 255, 255, 0.04)'
  },
  soundwaveBadge: {
    position: 'absolute',
    bottom: 4,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(10, 14, 26, 0.94)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 999,
    padding: '2px 8px',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap'
  },
  equalizerWrap: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 10
  },
  eqBar: {
    width: 2,
    height: 8,
    background: '#c084fc',
    borderRadius: 1,
    animation: 'eqBounce 0.8s ease-in-out infinite'
  },
  pulseDot: {
    fontSize: 10,
    fontWeight: 700,
    color: '#38bdf8'
  },
  soundwaveText: {
    fontSize: 10,
    fontWeight: 700,
    color: '#cbd5e1'
  },
  metaContainer: {
    flex: 1,
    minWidth: 0
  },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6
  },
  heroTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 800,
    lineHeight: '1.3em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heroArtist: {
    margin: '3px 0 0',
    fontSize: 13,
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heroFavBtn: {
    background: 'transparent',
    border: 'none',
    padding: 6,
    cursor: 'pointer',
    display: 'flex'
  },
  tagsRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center'
  },
  specBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#86efac',
    background: 'rgba(34, 197, 94, 0.14)',
    border: '1px solid rgba(34, 197, 94, 0.25)',
    padding: '2px 8px',
    borderRadius: 999
  },
  toggleVideoBtn: {
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    color: '#38bdf8',
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer'
  },
  timelineArea: {
    marginBottom: 12
  },
  scrubberTrack: {
    height: 6,
    background: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    position: 'relative',
    cursor: 'pointer',
    padding: '4px 0',
    backgroundClip: 'content-box'
  },
  scrubberFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #c084fc, #38bdf8)',
    borderRadius: 999,
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  scrubberKnob: {
    position: 'absolute',
    right: -4,
    width: 12,
    height: 12,
    background: '#fff',
    borderRadius: '50%',
    boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
  },
  timeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: 600,
    marginTop: 4
  },
  controlDeck: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 10
  },
  deckIconBtn: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  deckNavBtn: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#f8fafc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  deckPlayBtn: {
    width: 60,
    height: 60,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)',
    border: 'none',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(168, 85, 247, 0.45)'
  },
  hardwareCapsule: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 12px',
    background: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 10,
    marginBottom: 4
  },
  capsuleLabel: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 5
  },
  ratePill: {
    background: 'rgba(255, 255, 255, 0.08)',
    border: 'none',
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 800,
    padding: '3px 8px',
    borderRadius: 6,
    cursor: 'pointer'
  },
  nativeAudioWrap: {
    marginTop: 10,
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '2px 4px',
    boxSizing: 'border-box'
  },
  nativeAudio: {
    width: '100%',
    height: 38,
    outline: 'none',
    display: 'block'
  },
  searchWrap: {
    marginBottom: 14
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    padding: '10px 14px'
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500
  },
  clearSearchBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    display: 'flex'
  },
  searchLoadingIndicator: {
    fontSize: 12,
    color: '#c084fc',
    fontWeight: 600,
    padding: '6px 4px 0'
  },
  categoryScroller: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    paddingBottom: 8,
    marginBottom: 14,
    scrollbarWidth: 'none'
  },
  catPill: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#cbd5e1',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer'
  },
  catPillActive: {
    background: 'linear-gradient(135deg, #9333ea, #3b82f6)',
    border: '1px solid rgba(255, 255, 255, 0.25)',
    color: '#fff',
    boxShadow: '0 4px 16px rgba(147, 51, 234, 0.35)'
  },
  songSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 800,
    color: '#f8fafc',
    margin: 0
  },
  catLoading: {
    fontSize: 12,
    color: '#c084fc',
    fontWeight: 600
  },
  songListGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  songRowCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    cursor: 'pointer',
    transition: 'all 0.15s'
  },
  songRowCardActive: {
    background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.2), rgba(59, 130, 246, 0.12))',
    border: '1px solid rgba(168, 85, 247, 0.45)'
  },
  thumbWrapper: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 12,
    overflow: 'hidden',
    flexShrink: 0
  },
  songThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  thumbPlayingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  miniEq: {
    display: 'flex',
    gap: 2,
    alignItems: 'flex-end',
    height: 12
  },
  miniEqBar: {
    width: 2,
    height: 10,
    background: '#c084fc',
    borderRadius: 1,
    animation: 'eqBounce 0.7s infinite'
  },
  songInfo: {
    flex: 1,
    minWidth: 0
  },
  songName: {
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heartBtn: {
    background: 'transparent',
    border: 'none',
    padding: 6,
    cursor: 'pointer',
    display: 'flex'
  },
  trashBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    padding: 6,
    cursor: 'pointer',
    display: 'flex'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 16
  },
  modalSheet: {
    width: '100%',
    maxWidth: 440,
    background: '#0e1222',
    border: '1px solid rgba(168, 85, 247, 0.4)',
    borderRadius: 22,
    padding: 20
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14
  },
  modalCloseBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer'
  },
  modalSegment: {
    display: 'flex',
    gap: 8,
    marginBottom: 14
  },
  segmentBtn: {
    flex: 1,
    padding: '8px',
    borderRadius: 10,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(255, 255, 255, 0.03)',
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  },
  segmentBtnActive: {
    background: 'rgba(168, 85, 247, 0.2)',
    borderColor: '#a855f7',
    color: '#fff'
  },
  modalForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  formInput: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    padding: '11px 12px',
    color: '#fff',
    fontSize: 13,
    outline: 'none'
  },
  modalSubmitButton: {
    background: 'linear-gradient(135deg, #9333ea, #3b82f6)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '12px',
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 4
  }
};
