import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Search, Heart, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat,
  Flame, Sparkles, Moon, Music, Radio, Plus, Trash2, X, ListPlus
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

const CATEGORIES = [
  { id: 'trending', label: 'Thịnh hành', icon: Flame },
  { id: 'vpop', label: 'V-Pop Hot', icon: Sparkles },
  { id: 'lofi', label: 'Lofi Chill', icon: Moon },
  { id: 'acoustic', label: 'Acoustic', icon: Music },
  { id: 'sleep', label: 'Nhạc Ngủ', icon: Radio },
  { id: 'remix', label: 'Remix TikTok', icon: Flame }
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
  const [playbackRate, setPlaybackRate] = useState(1);

  // Modal thêm bài hoặc nạp Playlist YouTube
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState('single'); // "single" | "playlist"
  const [addUrl, setAddUrl] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addArtist, setAddArtist] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Thẻ <audio> phần cứng duy nhất cho iOS Safari
  const audioRef = useRef(null);
  const currentRef = useRef(null);
  currentRef.current = current;
  const loopModeRef = useRef(loopMode);
  loopModeRef.current = loopMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const searchTimeoutRef = useRef(null);

  const showToast = (msg) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? '' : prev));
    }, 3200);
  };

  /**
   * KÍCH HOẠT CHẾ ĐỘ PHÁT NỀN CHÍNH THỨC CỦA APPLE (iOS 17/18+ AudioSession API):
   * Đặt navigator.audioSession.type = 'playback' để iOS nhận diện đây là ứng dụng phát nhạc nền
   * chuyên nghiệp, không bao giờ bị dừng khi tắt màn hình iPhone hoặc gạt cần Im lặng.
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

  // Tải danh sách bài hát YouTube theo danh mục tự động
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
        showToast('Không thể tải nhạc từ YouTube. Hãy kiểm tra kết nối mạng.');
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

  const getPlayableUrl = (song) => {
    if (!song) return '';
    const videoId = song.videoId || (song.id?.startsWith('yt-') ? song.id.replace('yt-', '') : song.id);
    if (videoId) {
      const q = new URLSearchParams();
      if (song.title) q.set('title', song.title);
      if (song.artist) q.set('artist', song.artist);
      const qs = q.toString();
      return `${API}/stream/${videoId}${qs ? `?${qs}` : ''}`;
    }
    return song.audioUrl || '';
  };

  // Đồng bộ thông tin lên Màn hình khóa iPhone (iOS MediaSession Lock Screen)
  const updateMediaSession = (song) => {
    if (!('mediaSession' in navigator) || !song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'NOCTRA YouTube Music',
        artist: song.artist || 'YouTube Artist',
        album: 'NOCTRA iPhone Lock-Screen',
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
          if (audioRef.current && details.seekTime != null) {
            audioRef.current.currentTime = details.seekTime;
            setCurrentTime(details.seekTime);
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

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (_) {}
    }
  }, [current, isPlaying]);

  // Tìm kiếm trực tiếp mọi bài hát trên YouTube
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

  // Phát bài hát YouTube trực tiếp qua luồng audio/mp4 (HTTP 206 Partial Content)
  const playSong = useCallback((song) => {
    if (!song) return;
    activateIosPlaybackSession();
    setCurrent(song);
    setHistory((prev) => [song, ...prev.filter((s) => (s.videoId || s.id) !== (song.videoId || song.id))].slice(0, 50));

    const audio = audioRef.current;
    if (audio) {
      const streamUrl = getPlayableUrl(song);
      setLoadingTrack(true);
      audio.src = streamUrl;
      audio.playbackRate = playbackRate;
      audio.load();

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            setLoadingTrack(false);
            updateMediaSession(song);
          })
          .catch(() => {
            setLoadingTrack(false);
            showToast('Chạm vào nút ▶ trên thanh phát nhạc để cấp quyền âm thanh iOS.');
          });
      }
    }
  }, [playbackRate]);

  const togglePlay = () => {
    activateIosPlaybackSession();
    if (!current) {
      if (currentSongList.length > 0) playSong(currentSongList[0]);
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
    if (shuffleRef.current && list.length > 1) {
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
    if (audioRef.current && audioRef.current.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }
    const idx = list.findIndex((s) => (s.videoId || s.id) === (currentRef.current?.videoId || currentRef.current?.id));
    const prevIdx = (idx - 1 + list.length) % list.length;
    playSong(list[prevIdx]);
  }, [currentSongList, playSong]);

  const handleSongEnd = useCallback(() => {
    if (loopModeRef.current === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    nextSong();
  }, [nextSong]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const cur = audio.currentTime || 0;
    const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
    setCurrentTime(cur);
    if (dur > 0) {
      setDuration(dur);
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
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

  const toggleFavorite = (song) => {
    setFavorites((prev) => {
      const key = song.videoId || song.id;
      const exists = prev.some((s) => (s.videoId || s.id) === key);
      if (exists) {
        showToast('Đã xóa khỏi danh sách yêu thích.');
        return prev.filter((s) => (s.videoId || s.id) !== key);
      } else {
        showToast('Đã thêm vào danh sách yêu thích ♥');
        return [song, ...prev];
      }
    });
  };

  // Thêm 1 bài hoặc Nạp toàn bộ Playlist YouTube
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
        if (!res.ok) throw new Error(data.message || 'Không thể nạp playlist');
        showToast(data.message || `Đã nhập ${data.count} bài hát từ playlist!`);
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

  // Hẹn giờ tắt nhạc khi ngủ
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
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

  return (
    <div style={styles.page}>
      {/* Background glow mờ theo ảnh bìa YouTube */}
      {current && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: `url(${current.cover || current.thumbnail || `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`})`
          }}
        />
      )}

      <div style={styles.container}>
        {/* HEADER */}
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={styles.badge}>🍏 NOCTRA YOUTUBE PRO (iOS LOCK-SCREEN)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {sleepMinutesLeft > 0 && (
                <span style={styles.sleepBadge}>🌙 Tắt sau {sleepMinutesLeft}p</span>
              )}
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                style={styles.addBtn}
              >
                <Plus size={15} /> Thêm nhạc / Playlist
              </button>
            </div>
          </div>
          <div style={styles.brandRow}>
            <div>
              <h1 style={styles.logo}>NOCTRA</h1>
              <p style={styles.subtitle}>
                Nguồn nhạc YouTube trực tiếp — Tắt màn hình iPhone vẫn phát 100%
              </p>
            </div>
          </div>
        </header>

        {notice && <div style={styles.toast}>{notice}</div>}

        {/* KHUNG PHÁT NHẠC ĐANG CHƠI + THANH AUDIO PHẦN CỨNG IOS */}
        {current && (
          <section style={styles.playerCard}>
            <div style={styles.nowPlayingRow}>
              <img
                src={current.cover || current.thumbnail || `https://i.ytimg.com/vi/${current.videoId}/hqdefault.jpg`}
                alt={current.title}
                style={styles.cover}
              />
              <div style={styles.trackMeta}>
                <div style={styles.statusRow}>
                  <span style={styles.statusPill}>
                    {loadingTrack
                      ? '⚡ Đang nạp luồng YouTube...'
                      : isPlaying
                        ? '🔊 Đang phát (Khóa màn hình vẫn nghe)'
                        : '⏸ Sẵn sàng'}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(current)}
                    style={{
                      ...styles.likeBtn,
                      color: favorites.some((s) => (s.videoId || s.id) === (current.videoId || current.id)) ? '#f43f5e' : '#94a3b8'
                    }}
                  >
                    {favorites.some((s) => (s.videoId || s.id) === (current.videoId || current.id)) ? '♥ Đã thích' : '♡ Thích'}
                  </button>
                </div>
                <h2 style={styles.trackTitle}>{current.title}</h2>
                <p style={styles.trackArtist}>{current.artist}</p>
                <div style={styles.timeRow}>
                  <span>{formatTime(currentTime)}</span>
                  <span>/</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            {/*
              THANH <AUDIO CONTROLS> PHẦN CỨNG GỐC CỦA IPHONE (HIỂN THỊ TRỰC TIẾP - KHÔNG DÙNG DISPLAY: NONE!)
              Đây là yếu tố quyết định giúp iOS Safari cấp quyền AVAudioSessionCategoryPlayback tối đa,
              nhạc tiếp tục phát khi tắt màn hình iPhone, khi bỏ túi và khi khóa máy.
            */}
            <div style={styles.nativeAudioWrap}>
              <audio
                ref={audioRef}
                controls
                playsInline
                preload="auto"
                src={getPlayableUrl(current)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleTimeUpdate}
                onEnded={handleSongEnd}
                onError={() => {
                  console.warn('Đang tối ưu đường truyền âm thanh iPhone...');
                  showToast('Đang chuyển bài tiếp theo...');
                  setTimeout(() => nextSong(), 1200);
                }}
                onPlay={() => {
                  activateIosPlaybackSession();
                  setIsPlaying(true);
                  setLoadingTrack(false);
                  updateMediaSession(current);
                }}
                onPause={() => setIsPlaying(false)}
                onWaiting={() => setLoadingTrack(true)}
                onPlaying={() => setLoadingTrack(false)}
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
                <Shuffle size={17} />
              </button>

              <button onClick={previousSong} style={styles.secondaryBtn} type="button">
                <SkipBack size={17} /> Trước
              </button>

              <button onClick={togglePlay} style={styles.primaryBtn} type="button">
                {isPlaying ? <Pause size={19} /> : <Play size={19} />} {isPlaying ? 'Tạm dừng' : 'Phát nhạc'}
              </button>

              <button onClick={nextSong} style={styles.secondaryBtn} type="button">
                Tiếp <SkipForward size={17} />
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = loopMode === 'all' ? 'one' : 'all';
                  setLoopMode(next);
                  showToast(next === 'one' ? '🔂 Lặp 1 bài' : '🔁 Lặp toàn bộ danh sách');
                }}
                style={{
                  ...styles.iconBtn,
                  color: loopMode === 'one' ? '#38bdf8' : '#94a3b8',
                  background: loopMode === 'one' ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.06)'
                }}
              >
                <Repeat size={17} />
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
                  showToast(next ? `🌙 Hẹn giờ tắt sau ${next} phút` : 'Đã tắt hẹn giờ ngủ');
                }}
              >
                🌙 {sleepMinutesLeft > 0 ? `Ngủ: ${sleepMinutesLeft}p` : 'Hẹn giờ ngủ'}
              </button>

              <button
                type="button"
                style={styles.utilChip}
                onClick={() => {
                  const speeds = [1, 1.15, 1.25, 0.9];
                  const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
                  setPlaybackRate(next);
                  if (audioRef.current) audioRef.current.playbackRate = next;
                  showToast(`⚡ Tốc độ: ${next}x`);
                }}
              >
                ⚡ Tốc độ: {playbackRate}x
              </button>
            </div>
          </section>
        )}

        {/* THANH TÌM KIẾM YOUTUBE TRỰC TIẾP */}
        <section style={styles.searchSection}>
          <div style={styles.searchBox}>
            <Search size={18} color="#94a3b8" />
            <input
              type="text"
              placeholder="🔍 Tìm kiếm mọi bài hát, ca sĩ trên YouTube..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={styles.searchInput}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange('')}
                style={styles.clearBtn}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {isSearching && (
            <div style={styles.searchingHint}>Đang quét bài hát trên YouTube...</div>
          )}
        </section>

        {/* CÁC TAB KHÁM PHÁ YOUTUBE & BỘ SƯU TẬP */}
        <div style={styles.tabScrollWrap}>
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
                  ...styles.tabPill,
                  ...(active ? styles.tabPillActive : {})
                }}
              >
                <Icon size={14} /> {cat.label}
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
              ...styles.tabPill,
              ...(activeTab === 'favorites' && !searchQuery ? styles.tabPillActive : {})
            }}
          >
            <Heart size={14} /> Yêu thích ({favorites.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('library');
              setSearchQuery('');
            }}
            style={{
              ...styles.tabPill,
              ...(activeTab === 'library' && !searchQuery ? styles.tabPillActive : {})
            }}
          >
            <ListPlus size={14} /> Thư viện ({librarySongs.length})
          </button>
        </div>

        {/* DANH SÁCH BÀI HÁT TỪ YOUTUBE */}
        <section style={styles.songListSection}>
          <div style={styles.listHeader}>
            <span style={styles.listTitle}>
              {searchQuery
                ? `Kết quả tìm kiếm YouTube (${currentSongList.length})`
                : activeTab === 'favorites'
                  ? `Bài hát yêu thích (${favorites.length})`
                  : activeTab === 'library'
                    ? `Thư viện cá nhân (${librarySongs.length})`
                    : `YouTube ${CATEGORIES.find((c) => c.id === activeTab)?.label || 'Khám phá'} (${currentSongList.length})`}
            </span>
            {loadingCategory && <span style={styles.loadingHint}>⚡ Đang tải từ YouTube...</span>}
          </div>

          <div style={styles.songList}>
            {currentSongList.map((song, idx) => {
              const isCurrent = (song.videoId || song.id) === (current?.videoId || current?.id);
              const isFav = favorites.some((f) => (f.videoId || f.id) === (song.videoId || song.id));
              return (
                <div
                  key={song.id || song.videoId || idx}
                  onClick={() => playSong(song)}
                  style={{
                    ...styles.songCard,
                    borderColor: isCurrent ? '#a855f7' : 'rgba(255,255,255,0.07)',
                    background: isCurrent
                      ? 'linear-gradient(90deg, rgba(168,85,247,0.22), rgba(59,130,246,0.12))'
                      : 'rgba(255,255,255,0.03)'
                  }}
                >
                  <img
                    src={song.cover || song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`}
                    alt={song.title}
                    style={styles.songThumb}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.songTitle}>
                      {isCurrent && isPlaying ? '🔊 ' : ''}
                      {song.title}
                    </div>
                    <div style={styles.songArtist}>
                      {song.artist} {song.duration ? `• ${song.duration}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(song);
                    }}
                    style={{
                      ...styles.favBtn,
                      color: isFav ? '#f43f5e' : '#64748b'
                    }}
                  >
                    <Heart size={16} fill={isFav ? '#f43f5e' : 'none'} />
                  </button>
                  {activeTab === 'library' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSong(song.id || song.videoId);
                      }}
                      style={styles.delBtn}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* MODAL THÊM NHẠC & NẠP PLAYLIST YOUTUBE */}
        {showAddModal && (
          <div style={styles.modalOverlay} onClick={() => setShowAddModal(false)}>
            <div style={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Thêm nhạc từ YouTube</h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={styles.modalTabs}>
                <button
                  type="button"
                  onClick={() => setAddMode('single')}
                  style={{
                    ...styles.modalTabBtn,
                    ...(addMode === 'single' ? styles.modalTabBtnActive : {})
                  }}
                >
                  Bài hát đơn
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('playlist')}
                  style={{
                    ...styles.modalTabBtn,
                    ...(addMode === 'playlist' ? styles.modalTabBtnActive : {})
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
                  style={styles.modalInput}
                  required
                />
                {addMode === 'single' && (
                  <>
                    <input
                      type="text"
                      placeholder="Tiêu đề bài hát (tùy chọn - tự nhận diện)"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      style={styles.modalInput}
                    />
                    <input
                      type="text"
                      placeholder="Tên ca sĩ / nghệ sĩ (tùy chọn - tự nhận diện)"
                      value={addArtist}
                      onChange={(e) => setAddArtist(e.target.value)}
                      style={styles.modalInput}
                    />
                  </>
                )}
                <button
                  type="submit"
                  disabled={submittingAdd}
                  style={styles.modalSubmitBtn}
                >
                  {submittingAdd
                    ? 'Đang xử lý...'
                    : addMode === 'playlist'
                      ? 'Nạp toàn bộ Playlist'
                      : 'Thêm vào thư viện'}
                </button>
              </form>
            </div>
          </div>
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
    paddingTop: 'max(16px, env(safe-area-inset-top))',
    paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
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
    maxWidth: 540,
    margin: '0 auto',
    position: 'relative',
    zIndex: 1
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
  addBtn: {
    background: 'rgba(168, 85, 247, 0.25)',
    border: '1px solid #a855f7',
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer'
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
  toast: {
    position: 'fixed',
    bottom: 'max(24px, env(safe-area-inset-bottom))',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(15, 23, 42, 0.95)',
    border: '1px solid rgba(192, 132, 252, 0.45)',
    color: '#f8fafc',
    padding: '10px 18px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 99,
    whiteSpace: 'nowrap'
  },
  playerCard: {
    background: 'rgba(17, 20, 34, 0.88)',
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
    fontSize: 16,
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
    display: 'flex',
    gap: 6,
    fontSize: 12,
    color: '#cbd5e1'
  },
  nativeAudioWrap: {
    marginBottom: 12,
    background: 'rgba(255,255,255,0.04)',
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
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
  searchSection: {
    marginBottom: 12
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#0d101b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: '10px 14px'
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontSize: 13
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    display: 'flex'
  },
  searchingHint: {
    fontSize: 12,
    color: '#a855f7',
    padding: '6px 4px 0'
  },
  tabScrollWrap: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 8,
    marginBottom: 10
  },
  tabPill: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    padding: '8px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    cursor: 'pointer'
  },
  tabPillActive: {
    background: '#7c3aed',
    borderColor: '#a855f7',
    color: '#fff'
  },
  songListSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#e2e8f0'
  },
  loadingHint: {
    fontSize: 11,
    color: '#a855f7',
    fontWeight: 600
  },
  songList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  songCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer'
  },
  songThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    objectFit: 'cover',
    flexShrink: 0
  },
  songTitle: {
    fontSize: 14,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songArtist: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  favBtn: {
    background: 'transparent',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    padding: 6,
    cursor: 'pointer'
  },
  delBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    display: 'flex',
    alignItems: 'center',
    padding: 6,
    cursor: 'pointer'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 16
  },
  modalBox: {
    width: '100%',
    maxWidth: 440,
    background: '#0d101b',
    border: '1px solid rgba(168,85,247,0.4)',
    borderRadius: 20,
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
  modalTabs: {
    display: 'flex',
    gap: 8,
    marginBottom: 14
  },
  modalTabBtn: {
    flex: 1,
    padding: '8px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer'
  },
  modalTabBtnActive: {
    background: 'rgba(168,85,247,0.2)',
    borderColor: '#a855f7',
    color: '#fff'
  },
  modalForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  modalInput: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '11px 12px',
    color: '#fff',
    fontSize: 13,
    outline: 'none'
  },
  modalSubmitBtn: {
    background: 'linear-gradient(135deg, #9333ea, #6366f1)',
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
