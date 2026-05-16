// ============================================================
// CloudMusic PWA — 网易云音乐个人听歌应用
// ============================================================

// API 地址：优先 localStorage，否则用 Render 云端地址
let API_BASE = localStorage.getItem('api_base') || 'https://netease-api-09sq.onrender.com';

async function api(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

// ============================================================
// 状态
// ============================================================
let currentSong = null;           // 当前播放歌曲 { id, name, artist, cover, url }
let isPlaying = false;
let audio = new Audio();
let playQueue = [];               // 播放队列
let queueIndex = -1;
let playlists = JSON.parse(localStorage.getItem('playlists') || '{}');

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
      cover: ((s.album || s.al || {}).picUrl || '').replace(/^http:/, 'https:') + '?param=120y120',
      duration: (s.duration || s.dt || 0) / 1000
    }));
    renderSongList(container, songs);
  } catch (e) {
    container.innerHTML = '<div class="empty-hint">搜索失败，检查后端是否运行</div>';
    console.error(e);
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
        <div class="song-name">${escapeHtml(s.name)}</div>
        <div class="song-artist">${escapeHtml(s.artist)}${s.album ? ' · ' + escapeHtml(s.album) : ''}</div>
      </div>
      <button class="song-more" data-id="${s.id}" title="添加到歌单">+</button>
    </div>
  `).join('');

  // 点击播放
  container.querySelectorAll('.song-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('song-more')) return;
      const i = +item.dataset.index;
      playQueue = songs;
      queueIndex = i;
      playSong(songs[i]);
    });
  });

  // 添加到歌单
  container.querySelectorAll('.song-more').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const song = songs.find(s => s.id == id);
      if (song) showAddToPlaylistModal(song);
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ============================================================
// 播放器
// ============================================================
async function playSong(song) {
  currentSong = song;
  document.getElementById('player-bar').classList.remove('hidden');

  // 更新迷你播放条
  document.getElementById('player-cover').src = song.cover || '';
  document.getElementById('player-title').textContent = song.name;
  document.getElementById('player-artist').textContent = song.artist;

  // 更新展开页
  document.getElementById('player-cover-large').src = song.cover || '';
  document.getElementById('player-title-large').textContent = song.name;
  document.getElementById('player-artist-large').textContent = song.artist;

  // 获取播放链接
  try {
    const data = await api(`/song/url?id=${song.id}&level=standard`);
    const url = data.data?.[0]?.url;
    if (!url) {
      toast('该歌曲暂无播放源');
      return;
    }
    audio.src = url;
    audio.play();
    isPlaying = true;
    updatePlayButtons();
  } catch (e) {
    toast('获取播放链接失败');
    console.error(e);
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
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
  } else {
    audio.play();
    isPlaying = true;
  }
  updatePlayButtons();
}

// 上一首/下一首
document.getElementById('btn-prev').addEventListener('click', () => {
  if (queueIndex > 0) {
    queueIndex--;
    playSong(playQueue[queueIndex]);
  }
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (queueIndex < playQueue.length - 1) {
    queueIndex++;
    playSong(playQueue[queueIndex]);
  }
});

// 展开/收起播放器
document.getElementById('player-bar-click').addEventListener('click', () => {
  document.getElementById('player-full').classList.remove('hidden');
});
document.getElementById('player-collapse').addEventListener('click', () => {
  document.getElementById('player-full').classList.add('hidden');
});

// 播放结束自动下一首
audio.addEventListener('ended', () => {
  if (queueIndex < playQueue.length - 1) {
    queueIndex++;
    playSong(playQueue[queueIndex]);
  } else {
    isPlaying = false;
    updatePlayButtons();
  }
});

// 进度更新
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-thumb').style.left = pct + '%';
  document.getElementById('time-current').textContent = formatTime(audio.currentTime);
  document.getElementById('time-total').textContent = formatTime(audio.duration);
});

// 点击进度条
document.getElementById('progress-track').addEventListener('click', e => {
  if (!audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pct * audio.duration;
});

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
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
  const exists = playlists[playlistName].some(s => s.id === song.id);
  if (exists) { toast('已在歌单中'); return; }
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
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deletePlaylist(btn.dataset.delete);
    });
  });
}

function renderPlaylistSongs(name) {
  document.getElementById('playlist-list').style.display = 'none';
  document.getElementById('new-playlist-btn').style.display = 'none';
  document.getElementById('playlist-back').style.display = '';
  const container = document.getElementById('playlist-songs');
  container.style.display = '';
  const songs = playlists[name] || [];
  renderSongList(container, songs, name);
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

// 注册 Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
