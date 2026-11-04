import React, { useEffect, useRef, useState } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin.includes(':5173') ? 'http://localhost:5000/api' : '/api')).replace(/\/$/, '');

export default function App() {
  const [songs, setSongs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Form thêm bài hát
  const [urlOrId, setUrlOrId] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // QUAN TRỌNG CHO iOS: Dùng duy nhất 1 thẻ <audio> xuyên suốt vòng đời ứng dụng.
  // Khi màn hình iPhone tắt, iOS chỉ cho phép chuyển bài tự động nếu tái sử dụng cùng 1 thẻ <audio>.
  const audioRef = useRef(null);

  const currentSong = songs[currentIndex] || null;

  const getPlayableUrl = (song) => {
    if (!song) return '';
    if (song.youtubeId) {
      return `${API_BASE}/stream/${song.youtubeId}`;
    }
    return song.audioUrl || '';
  };

  useEffect(() => {
    fetch(`${API_BASE}/songs`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSongs(data);
      })
      .catch(() => {
        setErrorMsg('Không kết nối được tới server API.');
      });
  }, []);

  // Cập nhật thông tin lên Màn hình khóa iPhone & Dynamic Island / Control Center
  const updateMediaSessionMetadata = (song) => {
    if (!('mediaSession' in navigator) || !song) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'NOCTRA Music',
      artist: song.artist || 'NOCTRA',
      album: 'NOCTRA Background Audio',
      artwork: [
        {
          src: song.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=512&q=80',
          sizes: '512x512',
          type: 'image/jpeg'
        }
      ]
    });
  };

  // Đăng ký các nút bấm trên màn hình khóa iPhone (Play, Pause, Next, Previous, Tua nhạc)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actions = [
      ['play', () => playAudio()],
      ['pause', () => pauseAudio()],
      ['previoustrack', () => handlePrev()],
      ['nexttrack', () => handleNext()],
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
  }, [songs, currentIndex]);

  // Khi đổi bài hát
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    const nextSrc = getPlayableUrl(currentSong);
    if (!nextSrc) return;

    setErrorMsg('');
    updateMediaSessionMetadata(currentSong);

    if (audio.src !== nextSrc) {
      audio.src = nextSrc;
      audio.load();
    }

    if (isPlaying) {
      setLoadingTrack(true);
      audio
        .play()
        .then(() => {
          setLoadingTrack(false);
          if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        })
        .catch((err) => {
          console.warn('Autoplay chờ thao tác chạm từ người dùng:', err.message);
          setLoadingTrack(false);
        });
    }
  }, [currentIndex, currentSong?.id]);

  const playAudio = async () => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;

    setErrorMsg('');
    if (!audio.src) {
      audio.src = getPlayableUrl(currentSong);
    }

    try {
      setLoadingTrack(true);
      await audio.play();
      setIsPlaying(true);
      setLoadingTrack(false);
      updateMediaSessionMetadata(currentSong);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    } catch (err) {
      setLoadingTrack(false);
      setIsPlaying(false);
      setErrorMsg('Không thể phát luồng âm thanh này. Hãy thử bài có sẵn hoặc dán link MP3/M4A.');
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

  const handleNext = () => {
    if (!songs.length) return;
    const nextIdx = (currentIndex + 1) % songs.length;
    setCurrentIndex(nextIdx);
    setIsPlaying(true);
  };

  const handlePrev = () => {
    if (!songs.length) return;
    const prevIdx = (currentIndex - 1 + songs.length) % songs.length;
    setCurrentIndex(prevIdx);
    setIsPlaying(true);
  };

  const handleSelectSong = (index) => {
    setCurrentIndex(index);
    setIsPlaying(true);
  };

  const handleAudioError = () => {
    // Nếu luồng YouTube bị lỗi nhưng bài hát có audioUrl dự phòng thì tự động chuyển sang audioUrl
    const audio = audioRef.current;
    if (audio && currentSong?.audioUrl && !audio.src.includes(currentSong.audioUrl)) {
      audio.src = currentSong.audioUrl;
      if (isPlaying) {
        audio.play().catch(() => {});
      }
      return;
    }
    setLoadingTrack(false);
    setErrorMsg('Luồng âm thanh gặp sự cố hoặc bị chặn. Đang thử chuyển bài hoặc dùng link trực tiếp.');
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime || 0);
    if (audio.duration && !Number.isNaN(audio.duration)) {
      setDuration(audio.duration);
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime, audio.duration)
          });
        } catch (_) {}
      }
    }
  };

  const handleAddSong = async (e) => {
    e.preventDefault();
    if (!urlOrId.trim()) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrId, title, artist })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không thêm được bài hát');
      setSongs((prev) => [data, ...prev]);
      setCurrentIndex(0);
      setUrlOrId('');
      setTitle('');
      setArtist('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
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
      {/* Thẻ <audio> gốc duy nhất giúp iOS tiếp tục phát nhạc khi tắt màn hình */}
      <audio
        ref={audioRef}
        playsInline
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onEnded={handleNext}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setLoadingTrack(true)}
        onPlaying={() => setLoadingTrack(false)}
        onError={handleAudioError}
        style={{ display: 'none' }}
      />

      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <span style={styles.badge}>iOS LOCK SCREEN AUDIO READY</span>
            <h1 style={styles.logo}>NOCTRA</h1>
            <p style={styles.subtitle}>
              Phát bằng luồng HTML5 Audio trực tiếp — tiếp tục nghe khi tắt màn hình iPhone
            </p>
          </div>
        </header>

        {errorMsg && <div style={styles.alert}>{errorMsg}</div>}

        {/* Trình phát chính */}
        {currentSong && (
          <section style={styles.playerCard}>
            <div style={styles.nowPlayingRow}>
              <img
                src={currentSong.thumbnail}
                alt={currentSong.title}
                style={styles.cover}
              />
              <div style={styles.trackMeta}>
                <div style={styles.statusPill}>
                  {loadingTrack ? 'Đang tải luồng âm thanh...' : isPlaying ? 'Đang phát nền (hỗ trợ khóa màn hình)' : 'Đang tạm dừng'}
                </div>
                <h2 style={styles.trackTitle}>{currentSong.title}</h2>
                <p style={styles.trackArtist}>{currentSong.artist}</p>
              </div>
            </div>

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
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div style={styles.controls}>
              <button onClick={handlePrev} style={styles.secondaryBtn} type="button">
                ⏮ Trước
              </button>
              <button onClick={togglePlay} style={styles.primaryBtn} type="button">
                {isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
              </button>
              <button onClick={handleNext} style={styles.secondaryBtn} type="button">
                Tiếp ⏭
              </button>
            </div>
          </section>
        )}

        {/* Form thêm bài */}
        <form onSubmit={handleAddSong} style={styles.formCard}>
          <h3 style={styles.sectionTitle}>Thêm bài hát mới</h3>
          <input
            type="text"
            placeholder="Dán link YouTube, ID video hoặc link trực tiếp .mp3 / .m4a..."
            value={urlOrId}
            onChange={(e) => setUrlOrId(e.target.value)}
            style={styles.input}
            required
          />
          <div style={styles.formRow}>
            <input
              type="text"
              placeholder="Tên bài hát (tự điền nếu để trống)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={styles.input}
            />
            <input
              type="text"
              placeholder="Nghệ sĩ (tự điền nếu để trống)"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              style={styles.input}
            />
          </div>
          <button type="submit" disabled={submitting} style={styles.addBtn}>
            {submitting ? 'Đang xử lý luồng nhạc...' : '+ Thêm vào danh sách phát'}
          </button>
        </form>

        {/* Danh sách bài hát */}
        <section style={styles.listSection}>
          <h3 style={styles.sectionTitle}>Danh sách phát ({songs.length})</h3>
          {songs.map((song, idx) => {
            const active = idx === currentIndex;
            return (
              <div
                key={song.id}
                onClick={() => handleSelectSong(idx)}
                style={{
                  ...styles.songItem,
                  borderColor: active ? '#8b5cf6' : 'rgba(255,255,255,0.08)',
                  background: active ? 'rgba(139, 92, 246, 0.16)' : 'rgba(255,255,255,0.03)'
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
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#090a10',
    color: '#f3f4f6',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: '20px 14px 48px'
  },
  container: {
    maxWidth: 540,
    margin: '0 auto'
  },
  header: {
    marginBottom: 18
  },
  badge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#c4b5fd',
    background: 'rgba(139, 92, 246, 0.2)',
    padding: '4px 10px',
    borderRadius: 999,
    marginBottom: 8
  },
  logo: {
    margin: '0 0 4px',
    fontSize: 28,
    fontWeight: 800,
    letterSpacing: '-0.02em'
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: '#9ca3af'
  },
  alert: {
    background: 'rgba(239, 68, 68, 0.16)',
    border: '1px solid rgba(239, 68, 68, 0.4)',
    color: '#fca5a5',
    padding: '10px 12px',
    borderRadius: 12,
    fontSize: 13,
    marginBottom: 16
  },
  playerCard: {
    background: 'linear-gradient(145deg, #151828, #0f111c)',
    border: '1px solid rgba(139, 92, 246, 0.35)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    boxShadow: '0 12px 32px rgba(0,0,0,0.45)'
  },
  nowPlayingRow: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    marginBottom: 14
  },
  cover: {
    width: 76,
    height: 76,
    borderRadius: 14,
    objectFit: 'cover',
    flexShrink: 0
  },
  trackMeta: {
    minWidth: 0,
    flex: 1
  },
  statusPill: {
    fontSize: 11,
    color: '#a78bfa',
    marginBottom: 4,
    fontWeight: 600
  },
  trackTitle: {
    margin: '0 0 4px',
    fontSize: 17,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  trackArtist: {
    margin: 0,
    fontSize: 13,
    color: '#9ca3af'
  },
  progressWrap: {
    marginBottom: 12
  },
  slider: {
    width: '100%',
    accentColor: '#8b5cf6',
    cursor: 'pointer'
  },
  timeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4
  },
  controls: {
    display: 'flex',
    gap: 10,
    justifyContent: 'center'
  },
  primaryBtn: {
    flex: 1.4,
    background: '#8b5cf6',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer'
  },
  secondaryBtn: {
    flex: 1,
    background: 'rgba(255,255,255,0.08)',
    color: '#e5e7eb',
    border: 'none',
    borderRadius: 12,
    padding: '12px 12px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer'
  },
  formCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  sectionTitle: {
    margin: '0 0 6px',
    fontSize: 15,
    fontWeight: 700
  },
  formRow: {
    display: 'flex',
    gap: 8
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    background: '#121420',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: '10px 12px',
    color: '#fff',
    fontSize: 13
  },
  addBtn: {
    background: '#6d28d9',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '11px 14px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer'
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
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer'
  },
  thumbSmall: {
    width: 46,
    height: 46,
    borderRadius: 10,
    objectFit: 'cover'
  },
  songName: {
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  songSub: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2
  },
  deleteBtn: {
    background: 'transparent',
    color: '#9ca3af',
    border: 'none',
    fontSize: 15,
    padding: '4px 8px',
    cursor: 'pointer'
  }
};
