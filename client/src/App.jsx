import React, { useEffect, useRef, useState, useMemo } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin.includes(':5173') ? 'http://localhost:5000/api' : '/api')).replace(/\/$/, '');
const STORAGE_KEY = 'noctra_pro_state_v2';

const MOOD_FILTERS = [
  { id: 'all', label: '✨ Tự động theo Gu' },
  { id: 'lofi', label: '☕ Lofi & Học tập' },
  { id: 'vpop', label: '🇻🇳 V-Pop Chill' },
  { id: 'indie', label: '🎸 Indie & Acoustic' },
  { id: 'synthwave', label: '🌃 Đêm muộn' },
  { id: 'piano', label: '🎹 Piano thư giãn' },
  { id: 'remix', label: '⚡ Sôi động' }
];

const EQ_PRESETS = [
  { id: 'flat', label: 'Chuẩn gốc', bass: 0, treble: 0 },
  { id: 'bass', label: 'Bass Căng', bass: 7, treble: 1 },
  { id: 'lofi', label: 'Lofi Ấm', bass: 4, treble: -4 },
  { id: 'vocal', label: 'Lời Rõ Nét', bass: -2, treble: 5 },
  { id: 'night', label: 'Đêm Dịu Êm', bass: 2, treble: -6 }
];

export default function App() {
  // Khôi phục trạng thái nghe gần nhất để mở app là nghe tiếp ngay, không gây khó chịu
  const savedState = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }, []);

  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Tùy chọn thông minh
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'discover' | 'search'
  const [loopMode, setLoopMode] = useState(savedState.loopMode || 'all'); // 'all' | 'one' | 'radio'
  const [shuffle, setShuffle] = useState(Boolean(savedState.shuffle));
  const [eqPreset, setEqPreset] = useState(savedState.eqPreset || 'flat');
  const [playbackRate, setPlaybackRate] = useState(savedState.playbackRate || 1);

  // Hẹn giờ tắt nhạc khi ngủ (Sleep Timer)
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);

  // Tìm kiếm & Thêm bài 1 chạm (Omni-Search)
  const [omniQuery, setOmniQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Đề xuất chuẩn Gu người dùng
  const [selectedMood, setSelectedMood] = useState('all');
  const [recommendations, setRecommendations] = useState([]);
  const [topTags, setTopTags] = useState(['lofi', 'chill']);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Refs kỹ thuật cốt lõi cho iOS
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const keepAliveOscRef = useRef(null);
  const prefetchedSetRef = useRef(new Set());
  const hasRestoredPositionRef = useRef(false);
  const trackPlayedHalfRef = useRef(false);

  const currentSong = songs[currentIndex] || null;

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? '' : prev));
    }, 2800);
  };

  const getPlayableUrl = (song) => {
    if (!song) return '';
    if (song.youtubeId) {
      return `${API_BASE}/stream/${song.youtubeId}`;
    }
    return song.audioUrl || '';
  };

  // Lưu trạng thái tự động vào localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          lastSongId: currentSong?.id,
          lastTime: Math.floor(currentTime),
          loopMode,
          shuffle,
          eqPreset,
          playbackRate
        })
      );
    } catch (_) {}
  }, [currentSong?.id, Math.floor(currentTime / 5), loopMode, shuffle, eqPreset, playbackRate]);

  // 1. Tải danh sách bài hát & Đề xuất theo gu khi khởi động
  useEffect(() => {
    fetch(`${API_BASE}/songs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSongs(data);
          if (savedState.lastSongId) {
            const idx = data.findIndex((s) => s.id === savedState.lastSongId);
            if (idx !== -1) setCurrentIndex(idx);
          }
        }
      })
      .catch(() => {
        showToast('Đang chờ kết nối tới NOCTRA Server...');
      });

    fetchRecommendations('all');
  }, []);

  const fetchRecommendations = (mood = selectedMood) => {
    setLoadingRecs(true);
    const queryParam = mood && mood !== 'all' ? `?mood=${encodeURIComponent(mood)}` : '';
    fetch(`${API_BASE}/recommendations${queryParam}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.items) setRecommendations(data.items);
        if (data?.topTags) setTopTags(data.topTags);
      })
      .catch(() => {})
      .finally(() => setLoadingRecs(false));
  };

  const sendTasteSignal = (songId, signal) => {
    if (!songId) return;
    fetch(`${API_BASE}/signals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, signal })
    })
      .then((r) => r.json())
      .then((res) => {
        if (signal === 'toggle_like' && res?.song) {
          setSongs((prev) => prev.map((s) => (s.id === songId ? { ...s, liked: res.song.liked } : s)));
          fetchRecommendations(selectedMood);
        }
      })
      .catch(() => {});
  };

  /**
   * 2. Khởi tạo Web Audio API Engine + iOS Keep-Alive Bridge:
   * - Giữ phiên âm thanh iOS luôn hoạt động ngay cả trong tích tắc chuyển bài khi màn hình khóa.
   */
  const ensureAudioEngineUnlocked = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx || !audioRef.current) return;

      if (!audioCtxRef.current) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;

        // Oscillator tần số siêu trầm (1Hz, gain 0.00001 - hoàn toàn không nghe thấy)
        // để giữ AudioSession của iPhone luôn ở trạng thái Active khi chuyển bài lúc tắt màn hình!
        const osc = ctx.createOscillator();
        const silentGain = ctx.createGain();
        osc.frequency.value = 1;
        silentGain.gain.value = 0.00001;
        osc.connect(silentGain);
        silentGain.connect(ctx.destination);
        osc.start();
        keepAliveOscRef.current = osc;
      }

      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    } catch (_) {}
  };

  // 3. Tự động nạp trước (Predictive Pre-fetch) bài tiếp theo để chuyển bài 0ms trễ
  const prefetchNextSong = () => {
    if (!songs.length) return;
    const nextIdx = (currentIndex + 1) % songs.length;
    const nextSong = songs[nextIdx];
    if (nextSong?.youtubeId && !prefetchedSetRef.current.has(nextSong.youtubeId)) {
      prefetchedSetRef.current.add(nextSong.youtubeId);
      fetch(`${API_BASE}/prefetch/${nextSong.youtubeId}`).catch(() => {});
    }
    if (recommendations[0]?.youtubeId && !prefetchedSetRef.current.has(recommendations[0].youtubeId)) {
      prefetchedSetRef.current.add(recommendations[0].youtubeId);
      fetch(`${API_BASE}/prefetch/${recommendations[0].youtubeId}`).catch(() => {});
    }
  };

  // 4. Đồng bộ thông tin với Màn hình khóa iPhone (Lock Screen, Dynamic Island, Control Center, AirPods)
  const updateMediaSessionMetadata = (song) => {
    if (!('mediaSession' in navigator) || !song) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'NOCTRA Pro',
        artist: song.artist || 'NOCTRA Audio',
        album: 'NOCTRA — Phát nền iPhone',
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

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const handlers = [
      ['play', () => playAudio()],
      ['pause', () => pauseAudio()],
      ['previoustrack', () => handlePrev()],
      ['nexttrack', () => handleNext(false)],
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

    for (const [action, fn] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch (_) {}
    }
  }, [songs, currentIndex, shuffle, loopMode, recommendations]);

  // Tự động khôi phục phiên âm thanh khi mở khóa hoặc quay lại sau cuộc gọi trên iPhone
  useEffect(() => {
    const onVisibilityChange = () => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended' && isPlaying) {
        audioCtxRef.current.resume().catch(() => {});
      }
      if (!document.hidden && audioRef.current && !audioRef.current.paused) {
        setIsPlaying(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isPlaying]);

  // 5. Xử lý khi đổi bài hát
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    const nextSrc = getPlayableUrl(currentSong);
    if (!nextSrc) return;

    trackPlayedHalfRef.current = false;
    updateMediaSessionMetadata(currentSong);
    audio.playbackRate = playbackRate;

    if (audio.src !== nextSrc) {
      audio.src = nextSrc;
      audio.load();
    }

    // Nạp trước bài kế tiếp ngay khi bắt đầu bài mới
    prefetchNextSong();

    if (isPlaying) {
      setLoadingTrack(true);
      audio
        .play()
        .then(() => {
          setLoadingTrack(false);
          sendTasteSignal(currentSong.id, 'play');
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        })
        .catch(() => {
          setLoadingTrack(false);
        });
    }
  }, [currentIndex, currentSong?.id]);

  // Cập nhật tốc độ phát
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 6. Bộ đếm Hẹn giờ đi ngủ (Sleep Timer) với hiệu ứng giảm dần âm lượng mượt mà
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
          if (audioRef.current) {
            let vol = audioRef.current.volume;
            const fade = setInterval(() => {
              vol = Math.max(0, vol - 0.1);
              if (audioRef.current) audioRef.current.volume = vol;
              if (vol <= 0.05) {
                clearInterval(fade);
                pauseAudio();
                if (audioRef.current) audioRef.current.volume = 1;
              }
            }, 300);
          }
          showToast('Đã tạm dừng nhạc theo hẹn giờ ngủ 🌙');
          return 0;
        }
        return prev - 1;
      });
    }, 60000);
    return () => clearInterval(timer);
  }, [sleepMinutesLeft]);

  const playAudio = async () => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    ensureAudioEngineUnlocked();

    if (!audio.src) {
      audio.src = getPlayableUrl(currentSong);
    }

    try {
      setLoadingTrack(true);
      await audio.play();
      setIsPlaying(true);
      setLoadingTrack(false);
      updateMediaSessionMetadata(currentSong);
      sendTasteSignal(currentSong.id, 'play');
      prefetchNextSong();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (err) {
      setLoadingTrack(false);
      handleAudioError();
    }
  };

  const pauseAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  };

  // Chuyển bài thông minh (Hỗ trợ Lặp 1 bài, Shuffle, và Auto-Radio tự phát nhạc hợp gu khi hết danh sách)
  const handleNext = async (isEndedEvent = false) => {
    if (!songs.length) return;

    // Nếu người dùng bấm qua bài sớm (< 12 giây) -> ghi nhận tín hiệu không hợp gu
    if (!isEndedEvent && currentTime > 1 && currentTime < 12 && currentSong) {
      sendTasteSignal(currentSong.id, 'early_skip');
    }

    // Nếu đang bật Lặp 1 bài và bài tự kết thúc
    if (isEndedEvent && loopMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

    // Nếu đang ở bài cuối cùng và bật chế độ Auto-Radio (Đề xuất theo gu vô tận)
    if (currentIndex === songs.length - 1 && loopMode === 'radio' && recommendations.length > 0) {
      const nextRec = recommendations[0];
      await handleQuickPlayTrack(nextRec, true);
      return;
    }

    if (shuffle && songs.length > 1) {
      let randIdx = Math.floor(Math.random() * songs.length);
      if (randIdx === currentIndex) randIdx = (currentIndex + 1) % songs.length;
      setCurrentIndex(randIdx);
    } else {
      setCurrentIndex((prev) => (prev + 1) % songs.length);
    }
    setIsPlaying(true);
  };

  const handlePrev = () => {
    if (!songs.length) return;
    if (audioRef.current && audioRef.current.currentTime > 4) {
      audioRef.current.currentTime = 0;
      return;
    }
    const prevIdx = (currentIndex - 1 + songs.length) % songs.length;
    setCurrentIndex(prevIdx);
    setIsPlaying(true);
  };

  const handleSelectSong = (index) => {
    ensureAudioEngineUnlocked();
    if (index === currentIndex) {
      togglePlay();
    } else {
      setCurrentIndex(index);
      setIsPlaying(true);
    }
  };

  // Tự động chữa lỗi luồng âm thanh mà không làm gián đoạn trải nghiệm khóa màn hình
  const handleAudioError = () => {
    const audio = audioRef.current;
    if (audio && currentSong?.audioUrl && !audio.src.includes(currentSong.audioUrl)) {
      audio.src = currentSong.audioUrl;
      if (isPlaying) audio.play().catch(() => {});
      return;
    }
    setLoadingTrack(false);
    showToast('Đang tự động chuyển sang luồng ổn định hơn...');
    if (songs.length > 1) {
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % songs.length);
      }, 900);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!hasRestoredPositionRef.current && savedState.lastTime > 5 && savedState.lastSongId === currentSong?.id) {
      hasRestoredPositionRef.current = true;
      if (audio.duration && savedState.lastTime < audio.duration - 10) {
        audio.currentTime = savedState.lastTime;
      }
    } else {
      hasRestoredPositionRef.current = true;
    }

    const cur = audio.currentTime || 0;
    const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
    setCurrentTime(cur);

    if (dur > 0) {
      setDuration(dur);
      if (!trackPlayedHalfRef.current && cur / dur > 0.6 && currentSong) {
        trackPlayedHalfRef.current = true;
        sendTasteSignal(currentSong.id, 'complete');
      }
      if (audio.buffered && audio.buffered.length > 0) {
        const bufEnd = audio.buffered.end(audio.buffered.length - 1);
        setBufferedPct(Math.min(100, Math.round((bufEnd / dur) * 100)));
      }
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

  // Tìm kiếm tức thì (Debounced YouTube Search) khi người dùng gõ tên bài hát
  useEffect(() => {
    const trimmed = omniQuery.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || /^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      fetch(`${API_BASE}/search?q=${encodeURIComponent(trimmed)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setSearchResults(data);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 350);

    return () => clearTimeout(timer);
  }, [omniQuery]);

  // Phát ngay 1 chạm từ danh sách Tìm kiếm hoặc Đề xuất theo Gu
  const handleQuickPlayTrack = async (track, autoAdvance = false) => {
    ensureAudioEngineUnlocked();
    try {
      setLoadingTrack(true);
      const res = await fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urlOrId: track.youtubeId || track.audioUrl,
          title: track.title,
          artist: track.artist,
          thumbnail: track.thumbnail,
          tags: track.tags
        })
      });
      const added = await res.json();
      if (!res.ok) throw new Error(added.error || 'Lỗi thêm bài');

      setSongs((prev) => {
        const filtered = prev.filter((s) => s.id !== added.id);
        return [added, ...filtered];
      });
      setCurrentIndex(0);
      setIsPlaying(true);
      if (!autoAdvance) {
        showToast(`Đang phát: ${added.title}`);
      }
      fetchRecommendations(selectedMood);
    } catch (err) {
      showToast(err.message || 'Không thể phát bài này');
      setLoadingTrack(false);
    }
  };

  // Xử lý ô Omni-Bar
  const handleOmniSubmit = async (e) => {
    e.preventDefault();
    const raw = omniQuery.trim();
    if (!raw) return;
    ensureAudioEngineUnlocked();
    setLoadingTrack(true);
    try {
      const res = await fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId: raw })
      });
      const added = await res.json();
      if (!res.ok) throw new Error(added.error || 'Không tìm thấy bài hát');
      setSongs((prev) => [added, ...prev.filter((s) => s.id !== added.id)]);
      setCurrentIndex(0);
      setIsPlaying(true);
      setOmniQuery('');
      setSearchResults([]);
      showToast(`Đã thêm & phát: ${added.title}`);
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
        showToast('Đã dán nội dung từ bộ nhớ tạm 📋');
      } else {
        showToast('Bộ nhớ tạm đang trống');
      }
    } catch (_) {
      showToast('Hãy chạm giữ vào ô tìm kiếm để dán');
    }
  };

  const handleDeleteSong = async (id, idx) => {
    try {
      await fetch(`${API_BASE}/songs/${id}`, { method: 'DELETE' });
      const updated = songs.filter((s) => s.id !== id);
      setSongs(updated);
      if (idx === currentIndex) {
        setCurrentIndex(0);
      } else if (idx < currentIndex) {
        setCurrentIndex((c) => Math.max(0, c - 1));
      }
    } catch (_) {}
  };

  const formatTime = (sec) => {
    if (!sec || Number.isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const activeEqObj = EQ_PRESETS.find((p) => p.id === eqPreset) || EQ_PRESETS[0];

  return (
    <div style={styles.page}>
      {/* Thẻ <audio> gốc duy nhất xuyên suốt */}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onEnded={() => handleNext(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setLoadingTrack(true)}
        onPlaying={() => setLoadingTrack(false)}
        onError={handleAudioError}
        style={{ display: 'none' }}
      />

      {/* Hiệu ứng ánh sáng nền động theo ảnh bìa bài hát (Dynamic Ambient Glow) */}
      {currentSong?.thumbnail && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: `url(${currentSong.thumbnail})`
          }}
        />
      )}

      <div style={styles.container}>
        {/* Thanh trạng thái đỉnh chuẩn iPhone */}
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={styles.badge}>🍏 iOS LOCK-SCREEN PRO</span>
            {sleepMinutesLeft > 0 && (
              <span style={styles.sleepBadge}>🌙 Tắt sau {sleepMinutesLeft}p</span>
            )}
          </div>
          <div style={styles.brandRow}>
            <div>
              <h1 style={styles.logo}>NOCTRA</h1>
              <p style={styles.subtitle}>
                Tải trước thông minh • Phát liên tục khi tắt màn hình iPhone
              </p>
            </div>
            <div style={styles.tasteChip}>
              Gu của bạn: {topTags.map((t) => `#${t}`).join(' ')}
            </div>
          </div>
        </header>

        {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

        {/* TRÌNH PHÁT CHÍNH (HERO PLAYER CARD) */}
        {currentSong && (
          <section style={styles.playerCard}>
            <div style={styles.nowPlayingRow}>
              <div style={styles.coverWrap}>
                <img
                  src={currentSong.thumbnail}
                  alt={currentSong.title}
                  style={{
                    ...styles.cover,
                    transform: isPlaying ? 'scale(1.03)' : 'scale(0.98)'
                  }}
                />
              </div>

              <div style={styles.trackMeta}>
                <div style={styles.statusRow}>
                  <span style={styles.statusPill}>
                    {loadingTrack
                      ? '⚡ Đang nạp luồng siêu tốc...'
                      : isPlaying
                        ? '🔊 Đang phát nền (Khóa màn hình OK)'
                        : '⏸ Đang tạm dừng'}
                  </span>
                  <button
                    type="button"
                    onClick={() => sendTasteSignal(currentSong.id, 'toggle_like')}
                    style={{
                      ...styles.likeBtn,
                      color: currentSong.liked ? '#f43f5e' : '#94a3b8'
                    }}
                    title="Yêu thích để AI học gu của bạn"
                  >
                    {currentSong.liked ? '♥ Đã thích' : '♡ Thích'}
                  </button>
                </div>

                <h2 style={styles.trackTitle}>{currentSong.title}</h2>
                <p style={styles.trackArtist}>{currentSong.artist}</p>

                <div style={styles.tagRow}>
                  {(currentSong.tags || ['chill']).slice(0, 3).map((tag) => (
                    <span key={tag} style={styles.miniTag}>
                      #{tag}
                    </span>
                  ))}
                  {bufferedPct > 0 && (
                    <span style={styles.bufferTag}>Đã nạp trước {bufferedPct}%</span>
                  )}
                </div>
              </div>
            </div>

            {/* Thanh tiến trình cảm ứng nhạy cho ngón cái iPhone */}
            <div style={styles.progressWrap}>
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
                style={styles.slider}
              />
              <div style={styles.timeRow}>
                <span>{formatTime(currentTime)}</span>
                <span>{activeEqObj.label} • {playbackRate}x</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Cụm nút điều khiển chính */}
            <div style={styles.controls}>
              <button
                type="button"
                onClick={() => setShuffle((s) => !s)}
                style={{
                  ...styles.iconBtn,
                  color: shuffle ? '#c084fc' : '#94a3b8',
                  background: shuffle ? 'rgba(192,132,252,0.16)' : 'rgba(255,255,255,0.06)'
                }}
                title="Trộn bài"
              >
                🔀
              </button>

              <button onClick={handlePrev} style={styles.secondaryBtn} type="button">
                ⏮ Trước
              </button>

              <button onClick={togglePlay} style={styles.primaryBtn} type="button">
                {isPlaying ? '⏸ Tạm dừng' : '▶ Phát ngay'}
              </button>

              <button onClick={() => handleNext(false)} style={styles.secondaryBtn} type="button">
                Tiếp ⏭
              </button>

              <button
                type="button"
                onClick={() => {
                  const modes = ['all', 'radio', 'one'];
                  const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
                  setLoopMode(next);
                  const names = {
                    all: '🔁 Chế độ: Lặp danh sách',
                    radio: '📻 Chế độ: Tự phát nhạc hợp Gu vô tận (Auto-Radio)',
                    one: '🔂 Chế độ: Lặp 1 bài hiện tại'
                  };
                  showToast(names[next]);
                }}
                style={{
                  ...styles.iconBtn,
                  color: loopMode !== 'all' ? '#38bdf8' : '#94a3b8',
                  background: loopMode !== 'all' ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.06)'
                }}
                title="Chế độ lặp / Auto-Radio"
              >
                {loopMode === 'one' ? '🔂' : loopMode === 'radio' ? '📻' : '🔁'}
              </button>
            </div>

            {/* Thanh công cụ tiện ích nhanh */}
            <div style={styles.utilityBar}>
              <button
                type="button"
                style={styles.utilChip}
                onClick={() => {
                  const idx = EQ_PRESETS.findIndex((p) => p.id === eqPreset);
                  const next = EQ_PRESETS[(idx + 1) % EQ_PRESETS.length];
                  setEqPreset(next.id);
                  showToast(`🎚 Âm thanh: ${next.label}`);
                }}
              >
                🎚 EQ: {activeEqObj.label}
              </button>

              <button
                type="button"
                style={styles.utilChip}
                onClick={() => {
                  const options = [0, 15, 30, 45, 60];
                  const curIdx = options.indexOf(sleepMinutesLeft);
                  const next = options[(curIdx + 1) % options.length];
                  setSleepMinutesLeft(next);
                  showToast(next ? `🌙 Hẹn giờ tắt nhạc sau ${next} phút` : 'Đã tắt hẹn giờ ngủ');
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
                  showToast(`⚡ Tốc độ phát: ${next}x`);
                }}
              >
                ⚡ Tốc độ: {playbackRate}x
              </button>
            </div>
          </section>
        )}

        {/* THANH TÌM KIẾM & DÁN LINK ĐA NĂNG (OMNI-BAR) */}
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
                title="Dán nhanh từ bộ nhớ tạm iPhone"
              >
                📋 Dán
              </button>
            )}
            <button type="submit" style={styles.omniSubmitBtn}>
              Phát
            </button>
          </form>

          {isSearching && (
            <div style={styles.searchingHint}>Đang tìm bài hát tốc độ cao...</div>
          )}

          {searchResults.length > 0 && (
            <div style={styles.searchDropdown}>
              <div style={styles.dropdownHeader}>
                <span>Kết quả tìm kiếm nhanh (Chạm để phát ngay)</span>
                <button
                  type="button"
                  onClick={() => setSearchResults([])}
                  style={styles.closeSearchBtn}
                >
                  Đóng
                </button>
              </div>
              {searchResults.map((item) => (
                <div
                  key={item.youtubeId}
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
                      {item.artist} {item.durationText ? `• ${item.durationText}` : ''}
                    </div>
                  </div>
                  <span style={styles.playNowPill}>▶ Phát</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* CHUYỂN ĐỔI TAB: DANH SÁCH PHÁT & ĐỀ XUẤT CHUẨN GU */}
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
            ✨ Đề xuất chuẩn Gu ({recommendations.length})
          </button>
        </div>

        {/* TAB 1: DANH SÁCH PHÁT */}
        {activeTab === 'library' && (
          <section style={styles.listSection}>
            {songs.map((song, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={song.id}
                  onClick={() => handleSelectSong(idx)}
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
                    <div style={styles.songSub}>
                      {song.artist}
                      {song.playCount > 0 ? ` • Nghe ${song.playCount} lần` : ''}
                    </div>
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

        {/* TAB 2: ĐỀ XUẤT THÔNG MINH THEO GU NGƯỜI DÙNG */}
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

            <div style={styles.recHeaderRow}>
              <span style={styles.recHint}>
                Tự động tinh chỉnh theo những bài bạn nghe hết & thả tim ♥
              </span>
              <button
                type="button"
                onClick={() => fetchRecommendations(selectedMood)}
                style={styles.refreshBtn}
              >
                {loadingRecs ? 'Đang làm mới...' : '🔄 Đổi gợi ý'}
              </button>
            </div>

            <div style={styles.listSection}>
              {recommendations.map((rec) => (
                <div
                  key={rec.youtubeId}
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
  header: {
    marginBottom: 14
  },
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
    letterSpacing: '0.08em',
    color: '#d8b4fe',
    background: 'rgba(168, 85, 247, 0.22)',
    border: '1px solid rgba(168, 85, 247, 0.35)',
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
    letterSpacing: '-0.03em',
    background: 'linear-gradient(90deg, #ffffff, #c084fc)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
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
    background: 'rgba(15, 23, 42, 0.94)',
    backdropFilter: 'blur(16px)',
    border: '1px solid rgba(192, 132, 252, 0.45)',
    color: '#f8fafc',
    padding: '10px 18px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 99,
    boxShadow: '0 10px 28px rgba(0,0,0,0.5)'
  },
  playerCard: {
    background: 'rgba(17, 20, 34, 0.78)',
    backdropFilter: 'blur(26px)',
    WebkitBackdropFilter: 'blur(26px)',
    border: '1px solid rgba(168, 85, 247, 0.32)',
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
  coverWrap: {
    position: 'relative',
    flexShrink: 0
  },
  cover: {
    width: 82,
    height: 82,
    borderRadius: 16,
    objectFit: 'cover',
    transition: 'transform 0.3s ease',
    boxShadow: '0 8px 20px rgba(0,0,0,0.4)'
  },
  trackMeta: {
    minWidth: 0,
    flex: 1
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  statusPill: {
    fontSize: 11,
    color: '#c084fc',
    fontWeight: 600
  },
  likeBtn: {
    background: 'transparent',
    border: 'none',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '2px 6px'
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
    margin: '0 0 6px',
    fontSize: 13,
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  tagRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  miniTag: {
    fontSize: 10,
    color: '#cbd5e1',
    background: 'rgba(255,255,255,0.07)',
    padding: '2px 7px',
    borderRadius: 6
  },
  bufferTag: {
    fontSize: 10,
    color: '#34d399',
    background: 'rgba(16, 185, 129, 0.14)',
    padding: '2px 7px',
    borderRadius: 6
  },
  progressWrap: {
    marginBottom: 12
  },
  slider: {
    width: '100%',
    height: 6,
    accentColor: '#a855f7',
    cursor: 'pointer'
  },
  timeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4
  },
  controls: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 12
  },
  iconBtn: {
    width: 42,
    height: 44,
    borderRadius: 12,
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
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
    cursor: 'pointer',
    boxShadow: '0 6px 18px rgba(147, 51, 234, 0.4)'
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
    gap: 6,
    justifyContent: 'space-between'
  },
  utilChip: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#cbd5e1',
    borderRadius: 10,
    padding: '7px 6px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
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
    padding: '10px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
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
    cursor: 'pointer',
    whiteSpace: 'nowrap'
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
    maxHeight: 290,
    overflowY: 'auto'
  },
  dropdownHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11,
    color: '#94a3b8',
    padding: '0 4px 4px'
  },
  closeSearchBtn: {
    background: 'transparent',
    border: 'none',
    color: '#cbd5e1',
    fontSize: 11,
    cursor: 'pointer'
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
  },
  recHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  recHint: {
    fontSize: 11,
    color: '#94a3b8'
  },
  refreshBtn: {
    background: 'rgba(255,255,255,0.07)',
    border: 'none',
    color: '#e2e8f0',
    padding: '6px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
};
