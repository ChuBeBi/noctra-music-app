import React, { useEffect, useRef, useState, useMemo } from 'react';

/**
 * Tự động nhận diện địa chỉ API:
 * - Nếu có biến môi trường VITE_API_URL -> dùng biến đó.
 * - Nếu chạy qua Vite dev server (đã cấu hình proxy '/api' trong vite.config.js) hoặc cùng domain -> dùng '/api'.
 * Nhờ vậy khi mở bằng iPhone qua Wi-Fi (http://192.168.x.x:5173), iPhone KHÔNG bị gọi nhầm vào localhost!
 */
const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
const STORAGE_KEY = 'noctra_ios_hardware_v3';

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
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const [activeTab, setActiveTab] = useState('library');
  const [loopMode, setLoopMode] = useState(savedState.loopMode || 'all'); // 'all' | 'radio' | 'one'
  const [shuffle, setShuffle] = useState(Boolean(savedState.shuffle));
  const [playbackRate, setPlaybackRate] = useState(savedState.playbackRate || 1);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);

  // Tìm kiếm & Đề xuất
  const [omniQuery, setOmniQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMood, setSelectedMood] = useState('all');
  const [recommendations, setRecommendations] = useState([]);
  const [topTags, setTopTags] = useState(['lofi', 'chill']);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Thẻ <audio> phần cứng duy nhất (HIỂN THỊ TRỰC TIẾP TRÊN GIAO DIỆN ĐỂ IOS KHÔNG BAO GIỜ ĐÓNG BĂNG)
  const audioRef = useRef(null);
  const prefetchedSetRef = useRef(new Set());
  const trackPlayedHalfRef = useRef(false);

  const currentSong = songs[currentIndex] || null;

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? '' : prev));
    }, 3000);
  };

  /**
   * Luôn đi qua endpoint /api/stream/:id của Server để đảm bảo 100% có HTTP 206 Partial Content
   * và Content-Range chuẩn xác cho trình phát nền của iOS Safari.
   */
  const getPlayableUrl = (song) => {
    if (!song) return '';
    return `${API_BASE}/stream/${encodeURIComponent(song.id || song.youtubeId)}`;
  };

  /**
   * KÍCH HOẠT CHẾ ĐỘ PHÁT NỀN CHÍNH THỨC CỦA APPLE (iOS 17/18+ AudioSession API):
   * Đặt navigator.audioSession.type = 'playback' báo cho iOS biết đây là trình phát nhạc chuyên dụng,
   * giúp nhạc tiếp tục phát khi bấm nút nguồn tắt màn hình VÀ kể cả khi gạt cần gạt Im lặng (Silent Mode).
   */
  const activateIosPlaybackSession = () => {
    try {
      if ('audioSession' in navigator) {
        navigator.audioSession.type = 'playback';
      }
    } catch (_) {}
  };

  useEffect(() => {
    activateIosPlaybackSession();
    fetch(`${API_BASE}/songs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSongs(data);
        }
      })
      .catch(() => {
        showToast('Không kết nối được API. Hãy kiểm tra server đang chạy.');
      });

    fetchRecommendations('all');
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          loopMode,
          shuffle,
          playbackRate
        })
      );
    } catch (_) {}
  }, [loopMode, shuffle, playbackRate]);

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
          setSongs((prev) =>
            prev.map((s) => (s.id === songId ? { ...s, liked: res.song.liked } : s))
          );
          fetchRecommendations(selectedMood);
        }
      })
      .catch(() => {});
  };

  // Nạp trước bài tiếp theo vào bộ đệm RAM của Server
  const prefetchNextSong = () => {
    if (!songs.length) return;
    const nextIdx = (currentIndex + 1) % songs.length;
    const nextSong = songs[nextIdx];
    if (nextSong?.id && !prefetchedSetRef.current.has(nextSong.id)) {
      prefetchedSetRef.current.add(nextSong.id);
      fetch(`${API_BASE}/prefetch/${encodeURIComponent(nextSong.id)}`).catch(() => {});
    }
  };

  // Đồng bộ Metadata & Nút bấm lên Màn hình khóa iPhone (Lock Screen & Dynamic Island)
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

  // Khi chuyển bài hát
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    activateIosPlaybackSession();
    trackPlayedHalfRef.current = false;
    updateMediaSessionMetadata(currentSong);

    const nextSrc = getPlayableUrl(currentSong);
    if (!audio.src.endsWith(nextSrc)) {
      audio.src = nextSrc;
      audio.playbackRate = playbackRate;
    }

    prefetchNextSong();

    if (isPlaying) {
      setLoadingTrack(true);
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
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
    }
  }, [currentIndex, currentSong?.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Hẹn giờ tắt nhạc khi ngủ
  useEffect(() => {
    if (sleepMinutesLeft <= 0) return;
    const timer = setInterval(() => {
      setSleepMinutesLeft((prev) => {
        if (prev <= 1) {
          pauseAudio();
          showToast('Đã tự động dừng nhạc theo hẹn giờ ngủ 🌙');
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

    activateIosPlaybackSession();

    const targetSrc = getPlayableUrl(currentSong);
    if (!audio.src || !audio.src.endsWith(targetSrc)) {
      audio.src = targetSrc;
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
      showToast('Hãy chạm trực tiếp vào nút ▶ trên thanh trình phát để cấp quyền iOS.');
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

  const handleNext = async (isEndedEvent = false) => {
    if (!songs.length) return;

    if (!isEndedEvent && currentTime > 1 && currentTime < 12 && currentSong) {
      sendTasteSignal(currentSong.id, 'early_skip');
    }

    if (isEndedEvent && loopMode === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }

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
    activateIosPlaybackSession();
    if (index === currentIndex) {
      togglePlay();
    } else {
      setCurrentIndex(index);
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const cur = audio.currentTime || 0;
    const dur = audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0;
    setCurrentTime(cur);

    if (dur > 0) {
      setDuration(dur);
      if (!trackPlayedHalfRef.current && cur / dur > 0.6 && currentSong) {
        trackPlayedHalfRef.current = true;
        sendTasteSignal(currentSong.id, 'complete');
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

  // Tìm kiếm tức thì
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
    }, 300);

    return () => clearTimeout(timer);
  }, [omniQuery]);

  const handleQuickPlayTrack = async (track, autoAdvance = false) => {
    activateIosPlaybackSession();
    try {
      setLoadingTrack(true);
      const res = await fetch(`${API_BASE}/songs`, {
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

      setSongs((prev) => [added, ...prev.filter((s) => s.id !== added.id)]);
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

  const handleOmniSubmit = async (e) => {
    e.preventDefault();
    const raw = omniQuery.trim();
    if (!raw) return;
    activateIosPlaybackSession();
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
        showToast('Đã dán từ bộ nhớ tạm 📋');
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

  return (
    <div style={styles.page}>
      {currentSong?.thumbnail && (
        <div
          style={{
            ...styles.ambientGlow,
            backgroundImage: `url(${currentSong.thumbnail})`
          }}
        />
      )}

      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerTop}>
            <span style={styles.badge}>🍏 CHẾ ĐỘ PHẦN CỨNG iOS LOCK-SCREEN</span>
            {sleepMinutesLeft > 0 && (
              <span style={styles.sleepBadge}>🌙 Tắt sau {sleepMinutesLeft}p</span>
            )}
          </div>
          <div style={styles.brandRow}>
            <div>
              <h1 style={styles.logo}>NOCTRA</h1>
              <p style={styles.subtitle}>
                Phát trực tiếp qua trình phát phần cứng iPhone — Tắt màn hình vẫn phát 100%
              </p>
            </div>
            <div style={styles.tasteChip}>
              Gu: {topTags.map((t) => `#${t}`).join(' ')}
            </div>
          </div>
        </header>

        {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

        {currentSong && (
          <section style={styles.playerCard}>
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
                      ? '⚡ Đang nạp bộ đệm...'
                      : isPlaying
                        ? '🔊 Đang phát (Có thể tắt màn hình iPhone)'
                        : '⏸ Sẵn sàng phát'}
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
                <div style={styles.timeRow}>
                  <span>{formatTime(currentTime)}</span>
                  <span>•</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>

            {/*
              THANH <AUDIO CONTROLS> PHẦN CỨNG GỐC CỦA IPHONE (HIỂN THỊ TRỰC TIẾP - KHÔNG DÙNG DISPLAY: NONE!)
              Đây là bí quyết quan trọng nhất trên iOS Safari: khi thẻ <audio controls playsInline> hiển thị trực tiếp,
              hệ điều hành iOS cấp quyền AVAudioSessionCategoryPlayback tối đa và KHÔNG BAO GIỜ tắt nhạc khi khóa màn hình!
            */}
            <div style={styles.nativeAudioWrap}>
              <audio
                ref={audioRef}
                controls
                playsInline
                preload="auto"
                src={getPlayableUrl(currentSong)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleTimeUpdate}
                onEnded={() => handleNext(true)}
                onPlay={() => {
                  activateIosPlaybackSession();
                  setIsPlaying(true);
                  setLoadingTrack(false);
                  updateMediaSessionMetadata(currentSong);
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
                🔀
              </button>

              <button onClick={handlePrev} style={styles.secondaryBtn} type="button">
                ⏮ Trước
              </button>

              <button onClick={togglePlay} style={styles.primaryBtn} type="button">
                {isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
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
                    all: '🔁 Lặp danh sách',
                    radio: '📻 Tự động phát nhạc hợp Gu (Auto-Radio)',
                    one: '🔂 Lặp 1 bài'
                  };
                  showToast(names[next]);
                }}
                style={{
                  ...styles.iconBtn,
                  color: loopMode !== 'all' ? '#38bdf8' : '#94a3b8',
                  background: loopMode !== 'all' ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.06)'
                }}
              >
                {loopMode === 'one' ? '🔂' : loopMode === 'radio' ? '📻' : '🔁'}
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
                  showToast(`⚡ Tốc độ: ${next}x`);
                }}
              >
                ⚡ Tốc độ: {playbackRate}x
              </button>
            </div>
          </section>
        )}

        {/* Thanh tìm kiếm & Dán nhanh */}
        <section style={styles.omniCard}>
          <form onSubmit={handleOmniSubmit} style={styles.omniRow}>
            <input
              type="text"
              placeholder="🔍 Gõ tên bài hát, ca sĩ hoặc dán link..."
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
            <div style={styles.searchingHint}>Đang tìm nguồn nhạc chuẩn iOS...</div>
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
                        {item.source === 'apple_cdn' ? '🍏 Apple M4A Siêu tốc' : 'YouTube Audio'}
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
