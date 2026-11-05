import React, { useEffect, useRef, useState } from 'react';

/**
 * Kết nối thẳng tới cổng 5000 của Express Server khi chạy dev trên mạng Wi-Fi (bỏ qua Vite proxy)
 * để iOS AVPlayer giữ kết nối HTTP 206 Partial Content không bị ngắt khi khóa màn hình.
 */
function resolveApiBase() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if (port === '5173' || port === '4173' || port === '3000') {
      return `${protocol}//${hostname}:5000/api`;
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
    return `${API_BASE}/stream/${key}.m4a`;
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
    fetch(`${API_BASE}/prefetch/${encodeURIComponent(song.id)}.m4a`).catch(() => {});
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
    fetch(`${API_BASE}/songs`)
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
    const queryParam = mood && mood !== 'all' ? `?mood=${encodeURIComponent(mood)}` : '';
    fetch(`${API_BASE}/recommendations${queryParam}`)
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
        return `${m}:${s < 10 ? '0' : ''}${s}`;
      };
      timeLabelRef.current.textContent = `${format(cur)} / ${format(dur)}`;
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

      const newList = [added, ...songsRef.current.filter((s) => s.id !== added.id)];
      songsRef.current = newList;
      setSongs(newList);
      playSongImperatively(added, 0, true);
      showToast(`Đang phát: ${added.title}`);
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
      const res = await fetch(`${API_BASE}/songs`, {
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
            backgroundImage: `url(${currentSong.thumbnail})`
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
              Gu: {topTags.map((t) => `#${t}`).join(' ')}
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
