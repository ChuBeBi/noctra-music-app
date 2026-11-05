import React, { useEffect, useRef, useState } from 'react';

/**
 * Tự động chọn đường dẫn API thông minh:
 * - Nếu người dùng mở qua địa chỉ IP mạng LAN (192.168.x.x / 10.x.x.x / localhost) ở cổng 5173 -> kết nối thẳng cổng 5000.
 * - Nếu người dùng mở qua 5G / Tunnel / Domain (ngrok, cloudflare, devtunnels, hosting) -> đi qua '/api' (Vite proxy)
 *   để iPhone dùng 5G không bị lỗi từ chối kết nối cổng 5000!
 */
function resolveApiBase() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    const isLanOrLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    if (isLanOrLocal && (port === '5173' || port === '4173' || port === '3000')) {
      return `${protocol}//${hostname}:5000/api`;
    }
  }
  return '/api';
}

const API_BASE = resolveApiBase();

const MOOD_FILTERS = [
  { id: 'all', label: '✨ Chuẩn Gu Của Bạn' },
  { id: 'vpop', label: '🇻🇳 V-Pop Thịnh Hành' },
  { id: 'lofi', label: '☕ Lofi Chill' },
  { id: 'indie', label: '🎸 Indie Việt' },
  { id: 'rnb', label: '🔥 Rap & R&B' },
  { id: 'remix', label: '⚡ Remix Sôi Động' },
  { id: 'piano', label: '🎹 Piano & Mưa' },
  { id: 'usuk', label: '🌍 US-UK Hits' }
];

const Icons = {
  Play: () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  ),
  Pause: () => (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  ),
  Prev: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  ),
  Next: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  ),
  Shuffle: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  ),
  Repeat: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  Heart: ({ filled }) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={filled ? '#f43f5e' : 'none'} stroke={filled ? '#f43f5e' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Search: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  YouTube: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#ef4444">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
};

export default function App() {
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const [activeTab, setActiveTab] = useState('library');
  const [loopMode, setLoopMode] = useState('radio');
  const [shuffle, setShuffle] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState(0);

  const [omniQuery, setOmniQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedMood, setSelectedMood] = useState('all');
  const [recommendations, setRecommendations] = useState([]);
  const [topTags, setTopTags] = useState(['vpop', 'chill']);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const isStandaloneWebClip =
    typeof window !== 'undefined' && Boolean(window.navigator?.standalone);

  const audioRef = useRef(null);
  const progressInputRef = useRef(null);
  const progressFillRef = useRef(null);
  const curTimeTextRef = useRef(null);
  const durTimeTextRef = useRef(null);

  const songsRef = useRef([]);
  const currentIndexRef = useRef(0);
  const loopModeRef = useRef('radio');
  const shuffleRef = useRef(false);
  const recommendationsRef = useRef([]);
  const prefetchedSetRef = useRef(new Set());
  const trackPlayedHalfRef = useRef(false);
  const trackPrefetchedNextRef = useRef(false);
  const lastPositionUpdateRef = useRef(0);
  const isSeekingRef = useRef(false);
  // Bộ đếm chặn lỗi tự nhảy bài dây chuyền nếu người dùng mất mạng đột ngột
  const consecutiveErrorCountRef = useRef(0);

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
    }, 3200);
  };

  const formatTime = (sec) => {
    if (!sec || Number.isNaN(sec) || !Number.isFinite(sec)) return '0:00';
    const total = Math.floor(sec);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getPlayableUrl = (song) => {
    if (!song) return '';
    const key = encodeURIComponent(song.youtubeId || song.id);
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
        title: song.title || 'NOCTRA YouTube Music',
        artist: song.artist || 'YouTube Audio',
        album: 'NOCTRA YouTube Stream',
        artwork: [
          {
            src:
              song.thumbnail ||
              `https://i.ytimg.com/vi/${song.youtubeId || 'lTRiuFIWV54'}/hqdefault.jpg`,
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      });
    } catch (_) {}
  };

  const prefetchSong = (song) => {
    const key = song?.youtubeId || song?.id;
    if (!key || prefetchedSetRef.current.has(key)) return;
    prefetchedSetRef.current.add(key);
    fetch(`${API_BASE}/prefetch/${encodeURIComponent(key)}.m4a`).catch(() => {});
  };

  const playSongImperatively = (targetSong, targetIdx, autoPlay = true) => {
    const audio = audioRef.current;
    if (!audio || !targetSong) return;

    activateIosPlaybackSession();
    trackPlayedHalfRef.current = false;
    trackPrefetchedNextRef.current = false;

    const url = getPlayableUrl(targetSong);
    if (audio.src !== url) {
      audio.src = url;
      audio.load();
    }
    audio.playbackRate = playbackRate;

    currentIndexRef.current = targetIdx;
    setCurrentIndex(targetIdx);
    updateMediaSessionMetadata(targetSong);

    if (progressInputRef.current) progressInputRef.current.value = 0;
    if (progressFillRef.current) progressFillRef.current.style.width = '0%';
    if (curTimeTextRef.current) curTimeTextRef.current.textContent = '0:00';
    if (durTimeTextRef.current) {
      durTimeTextRef.current.textContent = targetSong.durationText || '0:00';
    }

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
          // Chỉ bật trạng thái đang phát khi luồng thực sự chạy
          setIsPlaying(true);
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
          sendTasteSignal(targetSong.id, 'play');
        }).catch(() => {
          setLoadingTrack(false);
          setIsPlaying(false);
        });
      }
    }
  };

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
          if (data[0]) prefetchSong(data[0]);
          if (data[1]) prefetchSong(data[1]);
        }
      })
      .catch(() => {
        showToast('Đang kết nối tới NOCTRA Server...');
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
          if (data.items[0]) prefetchSong(data.items[0]);
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

    if (
      idx === list.length - 1 &&
      loopModeRef.current === 'radio' &&
      recommendationsRef.current.length > 0
    ) {
      const nextRec = recommendationsRef.current[0];
      const remainingRecs = recommendationsRef.current.slice(1);
      recommendationsRef.current = remainingRecs;
      setRecommendations(remainingRecs);

      const newSongObj = {
        ...nextRec,
        id: `yt-${nextRec.youtubeId}`,
        liked: false,
        playCount: 1
      };
      const updatedList = [...list, newSongObj];
      songsRef.current = updatedList;
      setSongs(updatedList);
      playSongImperatively(newSongObj, updatedList.length - 1, true);

      fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSongObj)
      }).catch(() => {});
      return;
    }

    let nextIdx = (idx + 1) % list.length;
    if (shuffleRef.current && list.length > 1) {
      nextIdx = Math.floor(Math.random() * list.length);
      if (nextIdx === idx) nextIdx = (idx + 1) % list.length;
    }

    playSongImperatively(list[nextIdx], nextIdx, true);
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
    playSongImperatively(list[prevIdx], prevIdx, true);
  };

  const playCurrentSync = () => {
    const audio = audioRef.current;
    const list = songsRef.current;
    const song = list[currentIndexRef.current];
    if (!audio || !song) return;

    consecutiveErrorCountRef.current = 0;
    activateIosPlaybackSession();
    if (!audio.src) {
      audio.src = getPlayableUrl(song);
    }
    setLoadingTrack(true);
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      })
      .catch(() => {
        setLoadingTrack(false);
        setIsPlaying(false);
      });
  };

  const pauseCurrentSync = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setLoadingTrack(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  };

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

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const cur = audio.currentTime || 0;
    const dur = audio.duration && Number.isFinite(audio.duration) ? audio.duration : 0;

    // Khi nhạc đã thực sự nhích qua giây 0.5 -> reset bộ đếm lỗi về 0 và tắt trạng thái loading
    if (cur > 0.5) {
      consecutiveErrorCountRef.current = 0;
    }

    if (!document.hidden && !isSeekingRef.current) {
      if (curTimeTextRef.current) {
        curTimeTextRef.current.textContent = formatTime(cur);
      }
      if (dur > 0) {
        if (durTimeTextRef.current) {
          durTimeTextRef.current.textContent = formatTime(dur);
        }
        if (progressInputRef.current) {
          progressInputRef.current.max = dur;
          progressInputRef.current.value = cur;
        }
        if (progressFillRef.current) {
          const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
          progressFillRef.current.style.width = `${pct}%`;
        }
      }
    }

    if (dur > 0) {
      const activeSong = songsRef.current[currentIndexRef.current];
      if (!trackPlayedHalfRef.current && cur / dur > 0.6 && activeSong) {
        trackPlayedHalfRef.current = true;
        sendTasteSignal(activeSong.id, 'complete');
      }

      if (!trackPrefetchedNextRef.current && cur / dur > 0.8) {
        trackPrefetchedNextRef.current = true;
        const list = songsRef.current;
        if (list.length > 1) {
          const nextSong = list[(currentIndexRef.current + 1) % list.length];
          prefetchSong(nextSong);
        }
        if (recommendationsRef.current[0]) {
          prefetchSong(recommendationsRef.current[0]);
        }
      }

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
    }, 320);

    return () => clearTimeout(timer);
  }, [omniQuery]);

  const handleQuickPlayYouTubeTrack = (track) => {
    consecutiveErrorCountRef.current = 0;
    activateIosPlaybackSession();

    const newSongObj = {
      id: `yt-${track.youtubeId}`,
      youtubeId: track.youtubeId,
      title: track.title,
      artist: track.artist,
      durationText: track.durationText || '',
      thumbnail: track.thumbnail || `https://i.ytimg.com/vi/${track.youtubeId}/hqdefault.jpg`,
      tags: track.tags || ['chill'],
      liked: false,
      playCount: 1
    };

    const newList = [
      newSongObj,
      ...songsRef.current.filter((s) => s.youtubeId !== track.youtubeId)
    ];
    songsRef.current = newList;
    setSongs(newList);

    playSongImperatively(newSongObj, 0, true);
    showToast(`Đang phát từ YouTube: ${newSongObj.title}`);

    fetch(`${API_BASE}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSongObj)
    })
      .then(() => fetchRecommendations(selectedMood))
      .catch(() => {});
  };

  const handleOmniSubmit = async (e) => {
    e.preventDefault();
    const raw = omniQuery.trim();
    if (!raw) return;
    consecutiveErrorCountRef.current = 0;
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
      if (!res.ok) throw new Error(added.error || 'Không tìm thấy video YouTube');

      const newList = [added, ...songsRef.current.filter((s) => s.id !== added.id)];
      songsRef.current = newList;
      setSongs(newList);
      playSongImperatively(added, 0, true);
      setOmniQuery('');
      setSearchResults([]);
      showToast(`Đã phát từ YouTube: ${added.title}`);
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
        showToast('Đã dán link YouTube từ bộ nhớ tạm 📋');
      }
    } catch (_) {
      showToast('Hãy chạm giữ vào ô tìm kiếm để dán link YouTube');
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
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onEnded={() => triggerNextTrackSync(true)}
        onPlay={() => {
          activateIosPlaybackSession();
          setIsPlaying(true);
        }}
        onPlaying={() => {
          // Chỉ tắt chữ "Đang giải mã..." khi thực sự có dữ liệu âm thanh phát ra
          setLoadingTrack(false);
          setIsPlaying(true);
          consecutiveErrorCountRef.current = 0;
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
        onError={() => {
          setLoadingTrack(false);
          consecutiveErrorCountRef.current += 1;
          // Chặn vòng lặp tự nhảy bài vô tận như trong video: chỉ thử sang 1 bài kế tiếp duy nhất
          if (consecutiveErrorCountRef.current <= 1 && songsRef.current.length > 1) {
            showToast('Đang chuyển sang luồng dự phòng ổn định...');
            setTimeout(() => triggerNextTrackSync(true), 1200);
          } else {
            setIsPlaying(false);
            showToast('Luồng này đang bận. Hãy chạm chọn bài khác hoặc tìm bài mới.');
          }
        }}
        style={styles.hiddenHardwareAudio}
      />

      {currentSong?.thumbnail && (
        <>
          <div
            style={{
              ...styles.ambientOrbTop,
              backgroundImage: `url(${currentSong.thumbnail})`
            }}
          />
          <div
            style={{
              ...styles.ambientOrbBottom,
              backgroundImage: `url(${currentSong.thumbnail})`
            }}
          />
        </>
      )}

      <div style={styles.container}>
        {isStandaloneWebClip && (
          <div style={styles.safariBanner}>
            💡 Để thoát ra màn hình chính & tắt màn hình nghe nhạc không bị ngắt, hãy mở địa chỉ này trực tiếp bằng trình duyệt <strong>Safari</strong> trên iPhone.
          </div>
        )}

        <header style={styles.topNav}>
          <div style={styles.brandGroup}>
            <div style={styles.logoMark}>
              <Icons.YouTube />
            </div>
            <div>
              <div style={styles.brandNameRow}>
                <span style={styles.brandTitle}>NOCTRA</span>
                <span style={styles.proPill}>YOUTUBE PRO</span>
              </div>
              <p style={styles.brandSub}>iOS Lock-Screen Audio Streamer</p>
            </div>
          </div>

          <div style={styles.topRightGroup}>
            {sleepMinutesLeft > 0 && (
              <span style={styles.sleepBadge}>🌙 {sleepMinutesLeft}p</span>
            )}
            <div style={styles.tasteBadge}>
              {topTags.slice(0, 2).map((t) => `#${t}`).join(' ')}
            </div>
          </div>
        </header>

        {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

        <section style={styles.searchWrapper}>
          <form onSubmit={handleOmniSubmit} style={styles.searchBox}>
            <span style={styles.searchIconWrap}>
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Tìm bài hát, ca sĩ trên YouTube hoặc dán link..."
              value={omniQuery}
              onChange={(e) => setOmniQuery(e.target.value)}
              style={styles.searchInput}
            />
            {omniQuery ? (
              <button
                type="button"
                onClick={() => {
                  setOmniQuery('');
                  setSearchResults([]);
                }}
                style={styles.clearSearchBtn}
              >
                ✕
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                style={styles.pastePillBtn}
              >
                Dán link
              </button>
            )}
          </form>

          {isSearching && (
            <div style={styles.searchingBar}>
              <Icons.YouTube />
              <span>Đang tìm kiếm trên YouTube...</span>
            </div>
          )}

          {searchResults.length > 0 && (
            <div style={styles.searchDropdown}>
              <div style={styles.dropdownHeader}>
                <span>KẾT QUẢ TỪ YOUTUBE (CHẠM ĐỂ PHÁT NGAY)</span>
                <button
                  type="button"
                  onClick={() => setSearchResults([])}
                  style={styles.closeDropBtn}
                >
                  Đóng
                </button>
              </div>
              {searchResults.map((item) => (
                <div
                  key={item.youtubeId}
                  onClick={() => {
                    handleQuickPlayYouTubeTrack(item);
                    setOmniQuery('');
                    setSearchResults([]);
                  }}
                  style={styles.dropdownItem}
                >
                  <div style={styles.dropThumbWrap}>
                    <img src={item.thumbnail} alt={item.title} style={styles.dropThumb} />
                    {item.durationText && (
                      <span style={styles.durationBadge}>{item.durationText}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.dropTitle}>{item.title}</div>
                    <div style={styles.dropSub}>{item.artist}</div>
                  </div>
                  <div style={styles.playBadgeBtn}>
                    <Icons.Play />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {currentSong && (
          <section style={styles.heroCard}>
            <div style={styles.artworkShowcase}>
              <div style={styles.artworkGlowWrap}>
                <img
                  src={currentSong.thumbnail}
                  alt={currentSong.title}
                  style={{
                    ...styles.heroArtwork,
                    transform: isPlaying && !loadingTrack ? 'scale(1.02)' : 'scale(0.97)'
                  }}
                />
                <div style={styles.liveStatusOverlay}>
                  <Icons.YouTube />
                  <span>
                    {loadingTrack
                      ? 'Đang giải mã luồng YouTube...'
                      : isPlaying
                        ? 'YouTube M4A • Khóa màn hình OK'
                        : 'Đã sẵn sàng phát'}
                  </span>
                  {isPlaying && !loadingTrack && (
                    <div style={styles.eqBars}>
                      <span style={{ ...styles.eqBar, animation: 'eqBar1 0.8s infinite ease-in-out' }} />
                      <span style={{ ...styles.eqBar, animation: 'eqBar2 0.7s infinite ease-in-out' }} />
                      <span style={{ ...styles.eqBar, animation: 'eqBar3 0.9s infinite ease-in-out' }} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={styles.trackHeaderRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={styles.heroTitle}>{currentSong.title}</h2>
                <p style={styles.heroArtist}>{currentSong.artist}</p>
              </div>
              <button
                type="button"
                onClick={() => sendTasteSignal(currentSong.id, 'toggle_like')}
                style={styles.heartButton}
                title="Yêu thích"
              >
                <Icons.Heart filled={currentSong.liked} />
              </button>
            </div>

            <div style={styles.seekSection}>
              <div style={styles.seekTrackBg}>
                <div ref={progressFillRef} style={styles.seekTrackFill} />
                <input
                  ref={progressInputRef}
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={0}
                  step="0.1"
                  className="noctra-range"
                  onTouchStart={() => {
                    isSeekingRef.current = true;
                  }}
                  onMouseDown={() => {
                    isSeekingRef.current = true;
                  }}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const max = Number(e.target.max) || 100;
                    if (progressFillRef.current) {
                      progressFillRef.current.style.width = `${Math.min(100, (val / max) * 100)}%`;
                    }
                    if (curTimeTextRef.current) {
                      curTimeTextRef.current.textContent = formatTime(val);
                    }
                  }}
                  onTouchEnd={(e) => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = Number(e.target.value);
                    }
                    isSeekingRef.current = false;
                  }}
                  onMouseUp={(e) => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = Number(e.target.value);
                    }
                    isSeekingRef.current = false;
                  }}
                />
              </div>
              <div style={styles.timeLineRow}>
                <span ref={curTimeTextRef}>0:00</span>
                <span ref={durTimeTextRef}>{currentSong.durationText || '0:00'}</span>
              </div>
            </div>

            <div style={styles.mainControlsRow}>
              <button
                type="button"
                onClick={() => {
                  setShuffle((s) => !s);
                  showToast(!shuffle ? '🔀 Đã bật Trộn bài ngẫu nhiên' : 'Đã tắt Trộn bài');
                }}
                style={{
                  ...styles.sideControlBtn,
                  color: shuffle ? '#c084fc' : '#64748b',
                  background: shuffle ? 'rgba(192, 132, 252, 0.15)' : 'transparent'
                }}
              >
                <Icons.Shuffle />
              </button>

              <button
                type="button"
                onClick={() => {
                  consecutiveErrorCountRef.current = 0;
                  triggerPrevTrackSync();
                }}
                style={styles.skipControlBtn}
              >
                <Icons.Prev />
              </button>

              <button
                type="button"
                onClick={() => {
                  consecutiveErrorCountRef.current = 0;
                  if (isPlaying) {
                    pauseCurrentSync();
                  } else {
                    const s = songsRef.current[currentIndexRef.current];
                    if (s) playSongImperatively(s, currentIndexRef.current, true);
                  }
                }}
                style={styles.playCircleBtn}
              >
                {isPlaying ? <Icons.Pause /> : <Icons.Play />}
              </button>

              <button
                type="button"
                onClick={() => {
                  consecutiveErrorCountRef.current = 0;
                  triggerNextTrackSync(false);
                }}
                style={styles.skipControlBtn}
              >
                <Icons.Next />
              </button>

              <button
                type="button"
                onClick={() => {
                  const modes = ['radio', 'all', 'one'];
                  const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
                  setLoopMode(next);
                  const labels = {
                    radio: '📻 Auto-Radio: Tự phát tiếp nhạc YouTube hợp Gu',
                    all: '🔁 Lặp lại danh sách phát',
                    one: '🔂 Lặp lại 1 bài hiện tại'
                  };
                  showToast(labels[next]);
                }}
                style={{
                  ...styles.sideControlBtn,
                  color: loopMode !== 'all' ? '#38bdf8' : '#64748b',
                  background: loopMode !== 'all' ? 'rgba(56, 189, 248, 0.15)' : 'transparent'
                }}
              >
                <Icons.Repeat />
              </button>
            </div>

            <div style={styles.quickActionRow}>
              <button
                type="button"
                style={styles.quickPill}
                onClick={() => {
                  const modes = ['radio', 'all', 'one'];
                  const next = modes[(modes.indexOf(loopMode) + 1) % modes.length];
                  setLoopMode(next);
                }}
              >
                {loopMode === 'radio'
                  ? '📻 Tự phát theo Gu: BẬT'
                  : loopMode === 'one'
                    ? '🔂 Chế độ: Lặp 1 bài'
                    : '🔁 Chế độ: Lặp danh sách'}
              </button>

              <button
                type="button"
                style={styles.quickPill}
                onClick={() => {
                  const options = [0, 15, 30, 45, 60];
                  const next = options[(options.indexOf(sleepMinutesLeft) + 1) % options.length];
                  setSleepMinutesLeft(next);
                  showToast(next ? `🌙 Hẹn giờ tắt nhạc sau ${next} phút` : 'Đã tắt hẹn giờ ngủ');
                }}
              >
                🌙 {sleepMinutesLeft > 0 ? `Ngủ: ${sleepMinutesLeft}p` : 'Hẹn giờ ngủ'}
              </button>

              <button
                type="button"
                style={styles.quickPill}
                onClick={() => {
                  const speeds = [1, 1.15, 1.25, 0.9];
                  const next = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
                  setPlaybackRate(next);
                  if (audioRef.current) audioRef.current.playbackRate = next;
                  showToast(`⚡ Tốc độ: ${next}x`);
                }}
              >
                ⚡ {playbackRate}x
              </button>
            </div>
          </section>
        )}

        <div style={styles.segmentedControl}>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            style={{
              ...styles.segmentBtn,
              ...(activeTab === 'library' ? styles.segmentBtnActive : {})
            }}
          >
            Danh sách phát ({songs.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('discover');
              if (recommendations.length === 0) fetchRecommendations(selectedMood);
            }}
            style={{
              ...styles.segmentBtn,
              ...(activeTab === 'discover' ? styles.segmentBtnActive : {})
            }}
          >
            ✨ Đề xuất YouTube ({recommendations.length})
          </button>
        </div>

        {activeTab === 'library' && (
          <section style={styles.trackList}>
            {songs.map((song, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={song.id || song.youtubeId}
                  onClick={() => {
                    consecutiveErrorCountRef.current = 0;
                    if (active) {
                      if (isPlaying) pauseCurrentSync();
                      else playSongImperatively(song, idx, true);
                    } else {
                      playSongImperatively(song, idx, true);
                    }
                  }}
                  style={{
                    ...styles.trackCard,
                    ...(active ? styles.trackCardActive : {})
                  }}
                >
                  <div style={styles.trackThumbWrap}>
                    <img src={song.thumbnail} alt={song.title} style={styles.trackThumb} />
                    {song.durationText && (
                      <span style={styles.durationMini}>{song.durationText}</span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        ...styles.trackItemTitle,
                        color: active ? '#e879f9' : '#f8fafc'
                      }}
                    >
                      {song.title}
                    </div>
                    <div style={styles.trackItemArtist}>{song.artist}</div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      sendTasteSignal(song.id, 'toggle_like');
                    }}
                    style={styles.miniActionBtn}
                  >
                    <Icons.Heart filled={song.liked} />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSong(song.id, idx);
                    }}
                    style={styles.deleteTrackBtn}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {activeTab === 'discover' && (
          <section style={styles.discoverWrap}>
            <div style={styles.moodRow}>
              {MOOD_FILTERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedMood(m.id);
                    fetchRecommendations(m.id);
                  }}
                  style={{
                    ...styles.moodChip,
                    ...(selectedMood === m.id ? styles.moodChipActive : {})
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={styles.recSubHeader}>
              <span>Gợi ý trực tiếp từ YouTube dựa trên gu nghe nhạc của bạn</span>
              <button
                type="button"
                onClick={() => fetchRecommendations(selectedMood)}
                style={styles.refreshRecBtn}
              >
                {loadingRecs ? 'Đang tải...' : 'Làm mới'}
              </button>
            </div>

            <div style={styles.trackList}>
              {recommendations.map((rec) => (
                <div
                  key={rec.youtubeId}
                  onClick={() => handleQuickPlayYouTubeTrack(rec)}
                  style={styles.trackCard}
                >
                  <div style={styles.trackThumbWrap}>
                    <img src={rec.thumbnail} alt={rec.title} style={styles.trackThumb} />
                    {rec.durationText && (
                      <span style={styles.durationMini}>{rec.durationText}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.trackItemTitle}>{rec.title}</div>
                    <div style={styles.trackItemArtist}>
                      {rec.artist} • <span style={{ color: '#c084fc' }}>{rec.reason}</span>
                    </div>
                  </div>
                  <div style={styles.playBadgeBtn}>
                    <Icons.Play />
                  </div>
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
    background: '#050508',
    color: '#f8fafc',
    paddingTop: 'max(16px, env(safe-area-inset-top))',
    paddingBottom: 'max(48px, env(safe-area-inset-bottom))',
    paddingLeft: 16,
    paddingRight: 16,
    position: 'relative',
    overflowX: 'hidden'
  },
  hiddenHardwareAudio: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0.01,
    pointerEvents: 'none',
    zIndex: -1
  },
  ambientOrbTop: {
    position: 'fixed',
    top: '-18%',
    left: '-20%',
    width: '140%',
    height: '58%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(95px) saturate(210%)',
    opacity: 0.34,
    pointerEvents: 'none',
    zIndex: 0,
    transition: 'background-image 0.8s ease'
  },
  ambientOrbBottom: {
    position: 'fixed',
    bottom: '-25%',
    right: '-20%',
    width: '120%',
    height: '50%',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(110px) saturate(190%)',
    opacity: 0.18,
    pointerEvents: 'none',
    zIndex: 0
  },
  container: {
    maxWidth: 460,
    margin: '0 auto',
    position: 'relative',
    zIndex: 2
  },
  safariBanner: {
    background: 'rgba(245, 158, 11, 0.16)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    color: '#fde68a',
    padding: '10px 14px',
    borderRadius: 16,
    fontSize: 12,
    lineHeight: 1.45,
    marginBottom: 14
  },
  topNav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14
  },
  brandGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: 'rgba(239, 68, 68, 0.14)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '-0.03em',
    color: '#ffffff'
  },
  proPill: {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.08em',
    padding: '3px 7px',
    borderRadius: 999,
    background: 'linear-gradient(135deg, #a855f7, #ec4899)',
    color: '#ffffff'
  },
  brandSub: {
    margin: '1px 0 0',
    fontSize: 11,
    color: '#94a3b8'
  },
  topRightGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6
  },
  sleepBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#fde047',
    background: 'rgba(250, 204, 21, 0.14)',
    padding: '5px 10px',
    borderRadius: 999
  },
  tasteBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#e2e8f0',
    background: 'rgba(255, 255, 255, 0.07)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '5px 10px',
    borderRadius: 999
  },
  toast: {
    position: 'fixed',
    bottom: 'max(24px, env(safe-area-inset-bottom))',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(15, 18, 30, 0.94)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(168, 85, 247, 0.5)',
    color: '#ffffff',
    padding: '10px 18px',
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    zIndex: 100,
    boxShadow: '0 14px 34px rgba(0, 0, 0, 0.6)',
    whiteSpace: 'nowrap'
  },
  searchWrapper: {
    position: 'relative',
    marginBottom: 16
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(255, 255, 255, 0.06)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: '1px solid rgba(255, 255, 255, 0.11)',
    borderRadius: 16,
    padding: '6px 8px 6px 14px'
  },
  searchIconWrap: {
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center'
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#ffffff',
    fontSize: 13.5,
    padding: '7px 0'
  },
  clearSearchBtn: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: 15,
    padding: '6px 8px',
    cursor: 'pointer'
  },
  pastePillBtn: {
    background: 'rgba(255, 255, 255, 0.1)',
    border: 'none',
    color: '#f1f5f9',
    fontSize: 11.5,
    fontWeight: 700,
    padding: '8px 12px',
    borderRadius: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  searchingBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#cbd5e1',
    padding: '8px 12px'
  },
  searchDropdown: {
    marginTop: 8,
    background: 'rgba(13, 16, 27, 0.96)',
    backdropFilter: 'blur(28px)',
    WebkitBackdropFilter: 'blur(28px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    padding: 10,
    maxHeight: 330,
    overflowY: 'auto',
    boxShadow: '0 20px 50px rgba(0,0,0,0.75)'
  },
  dropdownHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: '#94a3b8',
    padding: '2px 6px 8px'
  },
  closeDropBtn: {
    background: 'transparent',
    border: 'none',
    color: '#cbd5e1',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer'
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px',
    borderRadius: 14,
    cursor: 'pointer',
    transition: 'background 0.15s ease'
  },
  dropThumbWrap: {
    position: 'relative',
    width: 64,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    flexShrink: 0
  },
  dropThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  durationBadge: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    background: 'rgba(0,0,0,0.82)',
    color: '#fff',
    fontSize: 9.5,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 4
  },
  dropTitle: {
    fontSize: 13.5,
    fontWeight: 700,
    color: '#f8fafc',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  dropSub: {
    fontSize: 11.5,
    color: '#94a3b8',
    marginTop: 2
  },
  playBadgeBtn: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: 'rgba(168, 85, 247, 0.2)',
    color: '#e879f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  heroCard: {
    background: 'linear-gradient(165deg, rgba(25, 28, 46, 0.78), rgba(11, 13, 23, 0.88))',
    backdropFilter: 'blur(32px)',
    WebkitBackdropFilter: 'blur(32px)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 28,
    padding: '18px 18px 16px',
    marginBottom: 18,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)'
  },
  artworkShowcase: {
    marginBottom: 16
  },
  artworkGlowWrap: {
    position: 'relative',
    width: '100%',
    height: 215,
    borderRadius: 20,
    overflow: 'hidden',
    boxShadow: '0 16px 38px rgba(0, 0, 0, 0.55)'
  },
  heroArtwork: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
  },
  liveStatusOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    background: 'rgba(8, 10, 18, 0.78)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: 12,
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 11,
    fontWeight: 600,
    color: '#e2e8f0'
  },
  eqBars: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2.5,
    height: 18
  },
  eqBar: {
    width: 3,
    height: 10,
    borderRadius: 2,
    background: 'linear-gradient(180deg, #ec4899, #a855f7)'
  },
  trackHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14
  },
  heroTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#ffffff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heroArtist: {
    margin: '4px 0 0',
    fontSize: 13.5,
    fontWeight: 500,
    color: '#94a3b8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  heartButton: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.09)',
    color: '#cbd5e1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0
  },
  seekSection: {
    marginBottom: 16
  },
  seekTrackBg: {
    position: 'relative',
    height: 6,
    borderRadius: 999,
    background: 'rgba(255, 255, 255, 0.14)',
    display: 'flex',
    alignItems: 'center'
  },
  seekTrackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '0%',
    borderRadius: 999,
    background: 'linear-gradient(90deg, #a855f7, #ec4899, #38bdf8)',
    pointerEvents: 'none',
    zIndex: 1
  },
  timeLineRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11.5,
    fontWeight: 600,
    color: '#94a3b8',
    marginTop: 8,
    fontVariantNumeric: 'tabular-nums'
  },
  mainControlsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 6px',
    marginBottom: 14
  },
  sideControlBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  skipControlBtn: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.07)',
    border: '1px solid rgba(255, 255, 255, 0.09)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer'
  },
  playCircleBtn: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #a855f7, #ec4899)',
    border: 'none',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 10px 28px rgba(168, 85, 247, 0.55)'
  },
  quickActionRow: {
    display: 'flex',
    gap: 6
  },
  quickPill: {
    flex: 1,
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#cbd5e1',
    borderRadius: 11,
    padding: '7px 6px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  segmentedControl: {
    display: 'flex',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 15,
    padding: 4,
    marginBottom: 14
  },
  segmentBtn: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: 700,
    padding: '9px 10px',
    borderRadius: 11,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  segmentBtnActive: {
    background: 'rgba(168, 85, 247, 0.24)',
    color: '#ffffff',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)'
  },
  trackList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  },
  trackCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '9px 11px',
    borderRadius: 16,
    background: 'rgba(255, 255, 255, 0.035)',
    border: '1px solid rgba(255, 255, 255, 0.07)',
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  trackCardActive: {
    background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.08))',
    borderColor: 'rgba(192, 132, 252, 0.45)'
  },
  trackThumbWrap: {
    position: 'relative',
    width: 62,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    flexShrink: 0
  },
  trackThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  durationMini: {
    position: 'absolute',
    bottom: 2,
    right: 3,
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 4px',
    borderRadius: 4
  },
  trackItemTitle: {
    fontSize: 13.5,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  trackItemArtist: {
    fontSize: 11.5,
    color: '#94a3b8',
    marginTop: 2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  miniActionBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer'
  },
  deleteTrackBtn: {
    background: 'transparent',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    padding: '6px',
    cursor: 'pointer'
  },
  discoverWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  moodRow: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 4
  },
  moodChip: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.09)',
    color: '#cbd5e1',
    padding: '7px 13px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer'
  },
  moodChipActive: {
    background: 'linear-gradient(135deg, #a855f7, #ec4899)',
    borderColor: 'transparent',
    color: '#ffffff'
  },
  recSubHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 11.5,
    color: '#94a3b8',
    padding: '0 4px'
  },
  refreshRecBtn: {
    background: 'rgba(255, 255, 255, 0.08)',
    border: 'none',
    color: '#f1f5f9',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    borderRadius: 8,
    cursor: 'pointer'
  }
};
