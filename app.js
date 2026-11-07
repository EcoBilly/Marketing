(function () {
  'use strict';
  var C = window.MarketingCore;
  var KEY = 'marketing.followState.v1';
  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(C.emptyState(), JSON.parse(raw));
    } catch (e) { /* 저장소 사용 불가 */ }
    return C.emptyState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { flash('backupMsg', '브라우저 저장에 실패했습니다. 백업 파일을 저장해 두세요.', 'warn'); }
  }
  function $(id) { return document.getElementById(id); }
  function fmt(ts) { return ts ? new Date(ts).toLocaleDateString('ko-KR') : '-'; }
  function link(u) { return '<a href="https://www.instagram.com/' + encodeURIComponent(u) + '/" target="_blank" rel="noopener">@' + esc(u) + '</a>'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function flash(id, text, cls) { var el = $(id); el.textContent = text; el.className = 'msg ' + (cls || ''); }

  // 탭
  document.querySelectorAll('nav button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('nav button, section').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      $(b.dataset.tab).classList.add('on');
      render();
    });
  });

  // 파일 읽기 (zip / json)
  function readFiles(fileList) {
    var jobs = Array.prototype.map.call(fileList, function (file) {
      if (/\.zip$/i.test(file.name)) {
        if (!window.JSZip) return Promise.reject(new Error('zip 해제 라이브러리를 불러오지 못했습니다. zip을 풀어 json 파일을 직접 넣어 주세요.'));
        return JSZip.loadAsync(file).then(function (zip) {
          var entries = Object.keys(zip.files).filter(function (n) { return /\.json$/i.test(n) && /follow/i.test(n); });
          return Promise.all(entries.map(function (n) {
            return zip.files[n].async('string').then(function (t) { return { name: n, json: safeParse(t) }; });
          }));
        });
      }
      return file.text().then(function (t) { return [{ name: file.name, json: safeParse(t) }]; });
    });
    return Promise.all(jobs).then(function (lists) {
      return [].concat.apply([], lists).filter(function (f) { return f.json; });
    });
  }
  function safeParse(t) { try { return JSON.parse(t); } catch (e) { return null; } }

  $('file').addEventListener('change', function (e) {
    var files = e.target.files;
    if (!files.length) return;
    flash('importMsg', '읽는 중…');
    readFiles(files).then(function (list) {
      var parsed = C.parseExport(list);
      if (!parsed.recognized.length) {
        flash('importMsg', '팔로워/팔로잉 파일을 찾지 못했습니다. JSON 형식으로 다운로드했는지 확인해 주세요.', 'warn');
        return;
      }
      C.mergeImport(state, parsed);
      save();
      var nF = Object.keys(parsed.following).length, nR = Object.keys(parsed.followers).length;
      flash('importMsg', '완료: 팔로잉 ' + nF + '명, 팔로워 ' + nR + '명, 언팔 기록 ' + Object.keys(parsed.unfollowed).length + '건을 반영했습니다.', 'ok');
      render();
    }).catch(function (err) { flash('importMsg', err.message, 'warn'); });
    e.target.value = '';
  });

  // 맞팔 안 한 계정
  $('days').addEventListener('input', render);
  var selected = {};
  var shown = [];
  function applyTo(names, act) {
    names.forEach(function (u) {
      if (act === 'unf') C.markUnfollowed(state, u);
      if (act === 'keep') state.whitelist[u] = true;
      delete selected[u];
    });
    save(); render();
  }
  $('nfbBody').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    applyTo([b.dataset.u], b.dataset.act);
  });
  $('nfbBody').addEventListener('change', function (e) {
    var c = e.target; if (!c.dataset.sel) return;
    if (c.checked) selected[c.dataset.sel] = true; else delete selected[c.dataset.sel];
    c.closest('.item').classList.toggle('sel', c.checked);
    updateSel();
  });
  $('selAll').addEventListener('change', function (e) {
    var on = e.target.checked;
    shown.forEach(function (u) { if (on) selected[u] = true; else delete selected[u]; });
    render();
  });
  function selectedList() { return shown.filter(function (u) { return selected[u]; }); }
  function updateSel() {
    var n = selectedList().length;
    $('selCount').textContent = n + '명 선택';
    $('bulkUnf').disabled = $('bulkKeep').disabled = n === 0;
    $('selAll').checked = n > 0 && n === shown.length;
    $('selAll').indeterminate = n > 0 && n < shown.length;
  }
  $('bulkUnf').addEventListener('click', function () {
    var list = selectedList();
    if (!confirm(list.length + '명을 언팔 완료로 기록할까요?\n(인스타그램에서 실제로 언팔하지는 않습니다. 언팔은 인스타에서 직접 해 주세요.)')) return;
    applyTo(list, 'unf');
  });
  $('bulkKeep').addEventListener('click', function () {
    var list = selectedList();
    if (!confirm(list.length + '명을 유지 목록에 넣을까요? 앞으로 이 목록에 나오지 않습니다.')) return;
    applyTo(list, 'keep');
  });

  // 후보 검사
  $('candBtn').addEventListener('click', function () {
    var r = C.checkCandidates(state, $('candText').value);
    function col(title, list, cls, withFollow) {
      return '<div class="col"><h3 class="' + cls + '">' + title + ' (' + list.length + ')</h3><ul>' +
        list.map(function (u) {
          return '<li>' + link(u) + (withFollow ? ' <button class="btn ghost" data-f="' + esc(u) + '" style="padding:2px 8px;font-size:12px">팔로우함</button>' : '') + '</li>';
        }).join('') + '</ul></div>';
    }
    $('candOut').innerHTML =
      col('새 후보 · 팔로우 가능', r.fresh, 'ok', true) +
      col('이미 팔로우 중', r.alreadyFollowing, '', false) +
      col('예전에 팔로우했던 계정 · 제외', r.previouslyFollowed, 'warn', false);
  });
  $('candOut').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-f]'); if (!b) return;
    C.markFollowed(state, b.dataset.f);
    save();
    b.textContent = '기록됨'; b.disabled = true;
    renderStats();
  });

  // 백업
  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'marketing-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('restore').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) {
      var data = safeParse(t);
      if (!data || !data.history) { flash('backupMsg', '올바른 백업 파일이 아닙니다.', 'warn'); return; }
      state = Object.assign(C.emptyState(), data);
      save(); render();
      flash('backupMsg', '백업을 불러왔습니다.', 'ok');
    });
    e.target.value = '';
  });
  $('resetBtn').addEventListener('click', function () {
    if (!confirm('모든 이력을 지울까요? 되돌릴 수 없습니다.')) return;
    state = C.emptyState(); save(); render();
  });
  $('search').addEventListener('input', render);

  function renderStats() {
    var s = C.stats(state);
    $('stats').innerHTML = [
      ['현재 팔로잉', s.following], ['맞팔 중', s.mutual],
      ['언팔한 계정', s.unfollowed], ['팔로우 이력 전체', s.everFollowed]
    ].map(function (x) { return '<div class="stat"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>'; }).join('');
  }

  function render() {
    renderStats();
    var days = parseInt($('days').value, 10); if (isNaN(days)) days = 14;
    var list = C.nonFollowBacks(state, days);
    $('nfbMsg').textContent = state.lastImportAt
      ? list.length + '명 · 마지막 데이터: ' + fmt(state.lastImportAt) + ' (최신 맞팔 여부를 보려면 데이터를 새로 받아 불러오세요)'
      : '먼저 ① 데이터 불러오기를 해 주세요.';
    shown = list.map(function (x) { return x.username; });
    Object.keys(selected).forEach(function (u) { if (shown.indexOf(u) < 0) delete selected[u]; });
    $('nfbBar').style.display = list.length ? '' : 'none';
    $('nfbBody').innerHTML = list.map(function (x) {
      var u = esc(x.username), on = !!selected[x.username];
      return '<div class="item' + (on ? ' sel' : '') + '">' +
        '<input type="checkbox" data-sel="' + u + '"' + (on ? ' checked' : '') + ' aria-label="@' + u + ' 선택">' +
        '<div class="who">' + link(x.username) + '<div class="meta">' + fmt(x.firstFollowedAt) + ' 팔로우 · ' + x.days + '일 경과</div></div>' +
        '<div class="acts"><button class="btn" data-act="unf" data-u="' + u + '">언팔 완료</button>' +
        '<button class="btn ghost" data-act="keep" data-u="' + u + '">유지</button></div></div>';
    }).join('');
    updateSel();

    var q = C.normalizeUsername($('search').value);
    var names = Object.keys(state.history).filter(function (u) { return state.history[u].firstFollowedAt && (!q || u.indexOf(q) >= 0); })
      .sort(function (a, b) { return state.history[b].firstFollowedAt - state.history[a].firstFollowedAt; });
    $('histBody').innerHTML = names.slice(0, 500).map(function (u) {
      var r = state.history[u];
      var st = r.unfollowedAt ? '<span class="warn">언팔 (' + fmt(r.unfollowedAt) + ')</span>' : '팔로잉';
      return '<tr><td>' + link(u) + '</td><td>' + fmt(r.firstFollowedAt) + '</td><td>' + st + '</td><td>' + (r.followsMe ? '<span class="ok">✓</span>' : '-') + '</td></tr>';
    }).join('') + (names.length > 500 ? '<tr><td colspan="4" class="msg">상위 500개만 표시합니다. 검색으로 찾아 주세요.</td></tr>' : '');
  }

  render();
})();
