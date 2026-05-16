// ============================================================
// CloudMusic PWA — 网易云音乐个人听歌应用 (离线缓存版)
// ============================================================

let API_BASE = localStorage.getItem('api_base') || 'https://netease-api-09sq.onrender.com';
let API_LOCAL = 'http://10.78.51.231:3000';

async function api(path, useLocal = false) {
  if (useLocal) {
    try {
      const res = await fetch(API_LOCAL + path, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return res.json();
    } catch(e) {}
  }
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

// ============================================================
// 音频缓存 (Cache API)
// ============================================================
const AUDIO_CACHE = 'cloudmusic-audio-v1';
let cachedSongs = new Set(JSON.parse(localStorage.getItem('cached_songs') || '[]'));

function saveCacheList() {
  localStorage.setItem('cached_songs', JSON.stringify([...cachedSongs]));
}

async function cacheAudio(songId, url) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    // 如果已缓存就跳过
    if (await cache.match(`/audio/${songId}`)) return;
    const res = await fetch(url);
    if (res.ok) {
      await cache.put(`/audio/${songId}`, res.clone());
      cachedSongs.add(songId);
      saveCacheList();
      updateCacheIndicators();
    }
  } catch (e) {
    console.error('缓存失败:', e);
  }
}

async function getCachedAudio(songId) {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const res = await cache.match(`/audio/${songId}`);
    return res ? res.url : null;
  } catch (e) { return null; }
}

async function removeCachedAudio(songId) {
  const cache = await caches.open(AUDIO_CACHE);
  await cache.delete(`/audio/${songId}`);
  cachedSongs.delete(songId);
  saveCacheList();
  updateCacheIndicators();
}

// ============================================================
// 状态
// ============================================================
let currentSong = null;
let isPlaying = false;
let audio = new Audio();
let playQueue = [];
let queueIndex = -1;
let playMode = 'sequential'; // sequential | repeat-all | repeat-one | shuffle
let shuffledQueue = [];
let playlists = JSON.parse(localStorage.getItem('playlists') || '{}');

const MODE_ICONS = {
  'sequential': '🔀',
  'repeat-all': '🔁',
  'repeat-one': '🔂',
  'shuffle': '🔀'
};
const MODE_LABELS = {
  'sequential': '顺序播放',
  'repeat-all': '列表循环',
  'repeat-one': '单曲循环',
  'shuffle': '随机播放'
};

// ============================================================
// 标签切换
// ============================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'playlist') renderPlaylists();
  });
});

// ============================================================
// 搜索
// ============================================================
document.getElementById('search-btn').addEventListener('click', doSearch);
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  document.getElementById('search-empty').style.display = 'none';
  const container = document.getElementById('search-results');
  container.innerHTML = '<div class="empty-hint">搜索中...</div>';

  try {
    const data = await api(`/search?keywords=${encodeURIComponent(q)}&limit=30`);
    const songs = (data.result?.songs || []).map(s => ({
      id: s.id,
      name: s.name,
      artist: (s.artists || s.ar || []).map(a => a.name).join('/'),
      album: (s.album || s.al || {}).name || '',
      cover: ( (s.al || s.album || {}).picUrl || '').replace(/^http:/, 'https:') + '?param=120y120',
      duration: (s.duration || s.dt || 0) / 1000
    }));
    renderSongList(container, songs);
  } catch (e) {
    container.innerHTML = '<div class="empty-hint">搜索失败，检查后端是否运行</div>';
  }
}

// ============================================================
// 渲染歌曲列表
// ============================================================
function renderSongList(container, songs, playlistName = null) {
  if (songs.length === 0) {
    container.innerHTML = '<div class="empty-hint">没有结果</div>';
    return;
  }
  container.innerHTML = songs.map((s, i) => `
    <div class="song-item" data-id="${s.id}" data-index="${i}">
      <img class="song-cover" src="${s.cover || ''}" alt="" loading="lazy"
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22><rect fill=%22%23333%22 width=%2244%22 height=%2244%22/><text fill=%22%23666%22 x=%2210%22 y=%2228%22 font-size=%2214%22>♪</text></svg>'">
      <div class="song-info">
        <div class="song-name">
          ${cachedSongs.has(s.id) ? '<span class="cached-badge">💾</span> ' : ''}${escapeHtml(s.name)}
        </div>
        <div class="song-artist">${escapeHtml(s.artist)}${s.album ? ' · ' + escapeHtml(s.album) : ''}</div>
      </div>
      <button class="song-more" data-id="${s.id}" title="缓存到本地">⬇</button>
      <button class="song-add" data-id="${s.id}" title="添加到歌单">+</button>
    </div>
  `).join('');

  // 点击播放
  container.querySelectorAll('.song-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('song-more') || e.target.classList.contains('song-add')) return;
      const i = +item.dataset.index;
      playQueue = songs;
      queueIndex = i;
      playSong(songs[i]);
    });
  });

  // 下载按钮
  container.querySelectorAll('.song-more').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = +btn.dataset.id;
      const song = songs.find(s => s.id === id);
      if (song) {
        btn.textContent = '⏳';
        await downloadSong(song);
        btn.textContent = cachedSongs.has(id) ? '💾' : '⬇';
      }
    });
  });

  // 添加到歌单
  container.querySelectorAll('.song-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = +btn.dataset.id;
      const song = songs.find(s => s.id === id);
      if (song) showAddToPlaylistModal(song);
    });
  });

  updateCacheIndicators();
}

function updateCacheIndicators() {
  document.querySelectorAll('.song-more').forEach(btn => {
    const id = +btn.dataset.id;
    btn.textContent = cachedSongs.has(id) ? '💾' : '⬇';
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ============================================================
// 下载歌曲到本地
// ============================================================
async function downloadSong(song) {
  try {
    const data = await api(`/song/url?id=${song.id}&level=standard`, true);
    const url = data.data?.[0]?.url;
    if (!url) {
      toast('该歌曲无可用播放源，可能需在家 WiFi 下载');
      return;
    }
    await cacheAudio(song.id, url);
    toast(`已缓存: ${song.name}`);
  } catch (e) {
    toast('下载失败，请在家 WiFi 下操作');
  }
}

// ============================================================
// 播放器
// ============================================================
async function playSong(song) {
  currentSong = song;
  document.getElementById('player-bar').classList.remove('hidden');
  document.getElementById('player-cover').src = song.cover || '';
  document.getElementById('player-title').textContent = song.name;
  document.getElementById('player-artist').textContent = song.artist;
  document.getElementById('player-cover-large').src = song.cover || '';
  document.getElementById('player-cover-large').onerror = function() {
    this.style.display = 'none';
  };
  document.getElementById('player-title-large').textContent = song.name;
  document.getElementById('player-artist-large').textContent = song.artist;

  // 异步加载歌词
  fetchLyrics(song.id);

  // 1. 先检查本地缓存
  const cachedUrl = await getCachedAudio(song.id);
  if (cachedUrl) {
    audio.src = cachedUrl;
    audio.play();
    isPlaying = true;
    updatePlayButtons();
    // 后台更新缓存
    try {
      const data = await api(`/song/url?id=${song.id}&level=standard`);
      const url = data.data?.[0]?.url;
      if (url) cacheAudio(song.id, url);
    } catch(e) {}
    return;
  }

  // 2. 尝试获取播放链接（优先本地API）并缓存
  try {
    const data = await api(`/song/url?id=${song.id}&level=standard`, true);
    const url = data.data?.[0]?.url;
    if (!url) {
      toast('无播放源。请在家 WiFi 下先下载此歌曲');
      return;
    }
    audio.src = url;
    audio.play();
    isPlaying = true;
    updatePlayButtons();
    // 后台缓存
    cacheAudio(song.id, url);
  } catch (e) {
    toast('获取播放链接失败');
  }
}

function updatePlayButtons() {
  const icon = isPlaying ? '⏸' : '▶';
  document.getElementById('btn-play').textContent = icon;
  document.getElementById('btn-play-large').textContent = icon;
}

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-play-large').addEventListener('click', togglePlay);

function togglePlay() {
  if (!audio.src) return;
  if (isPlaying) { audio.pause(); isPlaying = false; }
  else { audio.play(); isPlaying = true; }
  updatePlayButtons();
}

// 播放模式切换
document.getElementById('btn-mode').addEventListener('click', () => {
  const modes = ['sequential', 'repeat-all', 'repeat-one', 'shuffle'];
  const idx = modes.indexOf(playMode);
  playMode = modes[(idx + 1) % modes.length];
  document.getElementById('btn-mode').textContent = MODE_ICONS[playMode];
  document.getElementById('btn-mode').title = MODE_LABELS[playMode];
  toast('切换: ' + MODE_LABELS[playMode]);
});

// 歌词开关
document.getElementById('btn-lyrics-toggle').addEventListener('click', () => {
  document.getElementById('lyrics-container').classList.toggle('hidden');
});

document.getElementById('btn-prev').addEventListener('click', () => { prevSong(); });
document.getElementById('btn-next').addEventListener('click', () => { nextSong(); });

document.getElementById('player-bar-click').addEventListener('click', () => {
  document.getElementById('player-full').classList.remove('hidden');
});
document.getElementById('player-collapse').addEventListener('click', () => {
  document.getElementById('player-full').classList.add('hidden');
});

function prevSong() {
  if (playQueue.length === 0) return;
  if (playMode === 'shuffle') {
    if (shuffledQueue.length === 0) shuffleArray([...Array(playQueue.length).keys()]);
    queueIndex = shuffledQueue[Math.max(0, shuffledQueue.indexOf(queueIndex) - 1)];
  } else {
    queueIndex = queueIndex > 0 ? queueIndex - 1 : playQueue.length - 1;
  }
  playSong(playQueue[queueIndex]);
}

function nextSong() {
  if (playQueue.length === 0) return;
  if (playMode === 'repeat-one') {
    // 单曲循环：重播当前曲
    playSong(playQueue[queueIndex]);
    return;
  }
  if (playMode === 'shuffle') {
    if (shuffledQueue.length === 0 || shuffledQueue.indexOf(queueIndex) === shuffledQueue.length - 1) {
      shuffleArray([...Array(playQueue.length).keys()]);
    }
    const sidx = shuffledQueue.indexOf(queueIndex);
    queueIndex = shuffledQueue[sidx + 1];
  } else {
    if (queueIndex < playQueue.length - 1) {
      queueIndex++;
    } else if (playMode === 'repeat-all') {
      queueIndex = 0;
    } else {
      isPlaying = false; updatePlayButtons(); return;
    }
  }
  playSong(playQueue[queueIndex]);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  shuffledQueue = arr;
}

audio.addEventListener('ended', () => { nextSong(); });

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-thumb').style.left = pct + '%';
  document.getElementById('time-current').textContent = formatTime(audio.currentTime);
  document.getElementById('time-total').textContent = formatTime(audio.duration);
});

document.getElementById('progress-track').addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

function formatTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + (Math.floor(s % 60) < 10 ? '0' : '') + Math.floor(s % 60);
}

// ============================================================
// 歌单管理
// ============================================================
function savePlaylists() {
  localStorage.setItem('playlists', JSON.stringify(playlists));
}

function createPlaylist(name) {
  if (playlists[name]) { toast('歌单已存在'); return; }
  playlists[name] = [];
  savePlaylists();
  renderPlaylists();
}

function addToPlaylist(playlistName, song) {
  if (!playlists[playlistName]) playlists[playlistName] = [];
  if (playlists[playlistName].some(s => s.id === song.id)) { toast('已在歌单中'); return; }
  playlists[playlistName].push(song);
  savePlaylists();
  toast(`已添加到「${playlistName}」`);
}

function removeFromPlaylist(playlistName, songId) {
  playlists[playlistName] = playlists[playlistName].filter(s => s.id !== songId);
  savePlaylists();
  renderPlaylistSongs(playlistName);
  toast('已移除');
}

function deletePlaylist(name) {
  if (confirm(`删除歌单「${name}」？`)) {
    delete playlists[name];
    savePlaylists();
    renderPlaylists();
  }
}

document.getElementById('new-playlist-btn').addEventListener('click', () => {
  const name = prompt('歌单名称:');
  if (name && name.trim()) createPlaylist(name.trim());
});

document.getElementById('playlist-back').addEventListener('click', () => {
  document.getElementById('playlist-list').style.display = '';
  document.getElementById('playlist-songs').style.display = 'none';
  document.getElementById('playlist-back').style.display = 'none';
  document.getElementById('new-playlist-btn').style.display = '';
});

function renderPlaylists() {
  const container = document.getElementById('playlist-list');
  document.getElementById('playlist-songs').style.display = 'none';
  document.getElementById('playlist-back').style.display = 'none';
  document.getElementById('new-playlist-btn').style.display = '';
  container.style.display = '';
  const names = Object.keys(playlists);
  if (names.length === 0) {
    container.innerHTML = '<div class="empty-hint">还没有歌单，点击上方按钮创建</div>';
    return;
  }
  container.innerHTML = names.map(name => `
    <div class="playlist-item">
      <div style="flex:1" data-name="${escapeHtml(name)}" class="playlist-click">
        <div class="playlist-name">${escapeHtml(name)}</div>
        <div class="playlist-count">${playlists[name].length} 首</div>
      </div>
      <button class="song-more" data-delete="${escapeHtml(name)}">🗑</button>
    </div>
  `).join('');
  container.querySelectorAll('.playlist-click').forEach(el => {
    el.addEventListener('click', () => renderPlaylistSongs(el.dataset.name));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deletePlaylist(btn.dataset.delete); });
  });
}

function renderPlaylistSongs(name) {
  document.getElementById('playlist-list').style.display = 'none';
  document.getElementById('new-playlist-btn').style.display = 'none';
  document.getElementById('playlist-back').style.display = '';
  const container = document.getElementById('playlist-songs');
  container.style.display = '';
  renderSongList(container, playlists[name] || [], name);
}

// ============================================================
// 添加到歌单弹窗
// ============================================================
let pendingSong = null;

function showAddToPlaylistModal(song) {
  pendingSong = song;
  const container = document.getElementById('modal-playlists');
  const names = Object.keys(playlists);
  if (names.length === 0) {
    container.innerHTML = '<div style="color:#999;padding:12px;">请先在歌单页创建歌单</div>';
  } else {
    container.innerHTML = names.map(n => `
      <div class="modal-item" data-name="${escapeHtml(n)}">📁 ${escapeHtml(n)} (${playlists[n].length})</div>
    `).join('');
    container.querySelectorAll('.modal-item').forEach(el => {
      el.addEventListener('click', () => {
        addToPlaylist(el.dataset.name, pendingSong);
        document.getElementById('modal-overlay').classList.add('hidden');
      });
    });
  }
  document.getElementById('modal-overlay').classList.remove('hidden');
}

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('modal-overlay').classList.add('hidden');
});

// ============================================================
// 歌词
// ============================================================
let lyricsLines = [];
let lyricsTimes = [];

async function fetchLyrics(songId) {
  const lc = document.getElementById('lyrics-content');
  lc.innerHTML = '加载歌词中...';
  lyricsLines = [];
  lyricsTimes = [];
  try {
    const data = await api(`/lyric?id=${songId}`);
    const lrc = data?.lrc?.lyric || data?.lyric || '';
    if (!lrc || lrc === '') { lc.innerHTML = '暂无歌词'; return; }
    const parsed = parseLRC(lrc);
    lyricsLines = parsed.lines;
    lyricsTimes = parsed.times;
    lc.innerHTML = lyricsLines.map((l, i) => `<div class="lyric-line" data-lyric="${i}">${escapeHtml(l)}</div>`).join('\n');
  } catch (e) {
    lc.innerHTML = '歌词加载失败';
  }
}

function parseLRC(lrc) {
  const lines = []; const times = [];
  const regex = /^\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)$/;
  for (const raw of lrc.split('\n')) {
    const m = raw.match(regex);
    if (m) {
      const min = +m[1], sec = +m[2];
      let ms = m[3] ? +m[3] : 0;
      if (ms > 100) ms /= 10; // 百分位 -> 毫秒
      times.push(min * 60 + sec + ms / 100);
      lines.push(m[4].trim() || '...');
    }
  }
  return { lines, times };
}

function updateLyricHighlight(currentTime) {
  if (lyricsTimes.length === 0) return;
  let idx = 0;
  for (let i = 0; i < lyricsTimes.length; i++) {
    if (currentTime >= lyricsTimes[i]) idx = i;
    else break;
  }
  document.querySelectorAll('.lyric-line').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.lyric-line[data-lyric="${idx}"]`);
  if (active) { active.classList.add('active'); active.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

// 在 timeupdate 里调用歌词高亮
const origTimeUpdate = audio.ontimeupdate;
audio.addEventListener('timeupdate', () => {
  updateLyricHighlight(audio.currentTime);
});

// ============================================================
// Toast
// ============================================================
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ============================================================
// 初始化
// ============================================================
renderPlaylists();
updateCacheIndicators();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
