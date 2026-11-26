/* 대시보드 화면 동작 */
(function () {
  'use strict';
  var PLATFORMS = [
    { key: 'baemin', label: '배달의민족', css: '--s1' },
    { key: 'coupangeats', label: '쿠팡이츠', css: '--s2' },
    { key: 'mukkebi', label: '먹깨비', css: '--s3' },
  ];
  var LABEL = {}; PLATFORMS.forEach(function (p) { LABEL[p.key] = p.label; });
  var SOURCE_LABEL = { mock: '샘플 데이터', live: '하이픈 실연동', import: '파일 가져오기', empty: '데이터 없음' };
  var $ = function (id) { return document.getElementById(id); };
  var state = { days: 30, data: null };

  var won = function (v) { return Math.round(v).toLocaleString('ko-KR') + '원'; };
  var short = function (v) {
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
    if (a >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
    return Math.round(v).toLocaleString('ko-KR');
  };
  var pct = function (v) { return (v * 100).toFixed(1) + '%'; };
  var cnt = function (v) { return Math.round(v).toLocaleString('ko-KR') + '건'; };
  var color = function (css) { return getComputedStyle(document.documentElement).getPropertyValue(css).trim(); };
  var seriesFor = function (keys) {
    return PLATFORMS.filter(function (p) { return keys.indexOf(p.key) >= 0; })
      .map(function (p) { return { key: p.key, label: p.label, color: color(p.css) }; });
  };
  function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  function td(text, cls) { var c = document.createElement('td'); c.textContent = text; if (cls) c.className = cls; return c; }
  function th(text) { var c = document.createElement('th'); c.textContent = text; return c; }
  function mdLabel(d) { return Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)); }

  // ── 조회 조건 ──
  function selectedPlatforms() {
    return Array.prototype.slice.call(document.querySelectorAll('input[name=platform]:checked')).map(function (i) { return i.value; });
  }
  function setPreset(days) {
    state.days = days;
    var to = kstToday();
    $('to').value = to;
    $('from').value = addDays(to, -(days - 1));
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.days) === days); });
  }
  document.querySelectorAll('.seg button').forEach(function (b) {
    b.addEventListener('click', function () { setPreset(Number(b.dataset.days)); load(); });
  });
  ['from', 'to'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      document.querySelectorAll('.seg button').forEach(function (b) { b.classList.remove('on'); });
      load();
    });
  });
  document.querySelectorAll('input[name=platform]').forEach(function (i) { i.addEventListener('change', load); });
  $('onlyLow').addEventListener('change', renderReviews);
  $('onlyUnreplied').addEventListener('change', renderReviews);

  function load() {
    var plats = selectedPlatforms();
    if (!plats.length) { $('status').textContent = '플랫폼을 하나 이상 선택하세요.'; return; }
    var q = new URLSearchParams({ from: $('from').value, to: $('to').value, platforms: plats.join(',') });
    $('status').textContent = '불러오는 중…';
    fetch('/api/dashboard?' + q).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error);
      state.data = j;
      render();
    }).catch(function (e) { $('status').textContent = '오류: ' + e.message; });
  }

  // ── 렌더 ──
  function render() {
    var j = state.data, d = j.dashboard;
    $('modeBadge').hidden = !j.mock;
    renderStatus(j.status);
    renderKpis(d);
    renderPlatformTable(d);
    renderLegends(d.platforms);
    renderDaily(d);
    renderHourWeek(d);
    renderAds(d, j.status);
    renderReviews();
    loadMukkebiFiles();
  }

  function renderStatus(status) {
    var box = $('status'); box.textContent = '';
    status.forEach(function (s) {
      var p = document.createElement('span');
      p.className = 'pill' + (!s.account.ok || s.errors.length ? ' err' : '');
      var b = document.createElement('b'); b.textContent = LABEL[s.platform];
      p.appendChild(b);
      var msg = ' · ' + (SOURCE_LABEL[s.account.source] || s.account.source);
      if (!s.account.ok && s.account.message) msg += ' — ' + s.account.message;
      if (s.errors.length) msg += ' — ' + s.errors.join(' / ');
      p.appendChild(document.createTextNode(msg));
      box.appendChild(p);
    });
  }

  function renderKpis(d) {
    var t = d.totals;
    var items = [
      { label: '총 매출 (음식)', value: won(t.salesAmount), hint: '배달팁 ' + won(t.deliveryTip) + ' 별도' },
      { label: '완료 주문', value: cnt(t.orderCount), hint: '객단가 ' + won(t.avgOrderValue) + ' · 취소 ' + cnt(t.cancelCount) },
      { label: '수수료 합계', value: won(t.fees.total), hint: '총액 대비 ' + pct(t.feeShare) },
      { label: '순 정산액 (입금)', value: won(t.payout), hint: '광고비 빼면 ' + won(t.netAfterAds) },
      { label: '리뷰 평균 별점', value: t.avgRating == null ? '-' : '★ ' + t.avgRating.toFixed(2), hint: '리뷰 ' + cnt(t.reviewCount) + ' · 낮은 별점 ' + cnt(t.lowRatingCount) },
    ];
    var box = $('kpis'); box.textContent = '';
    items.forEach(function (it) {
      var k = document.createElement('div'); k.className = 'kpi';
      ['label', 'value', 'hint'].forEach(function (f) {
        var x = document.createElement('div'); x.className = f; x.textContent = it[f]; k.appendChild(x);
      });
      box.appendChild(k);
    });
  }

  function renderPlatformTable(d) {
    var tbl = $('platformTable'); tbl.textContent = '';
    var head = document.createElement('tr');
    ['플랫폼', '음식 매출', '배달팁', '주문', '중개수수료', '결제수수료', '배달비', '부가세', '기타차감', '수수료 합계', '수수료 비중', '순 정산액', '광고비']
      .forEach(function (h) { head.appendChild(th(h)); });
    var thead = document.createElement('thead'); thead.appendChild(head); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    var maxShare = Math.max.apply(null, d.byPlatform.map(function (p) { return p.feeShare; }).concat([0.0001]));
    var adsSupported = {};
    (state.data.status || []).forEach(function (s) { adsSupported[s.platform] = s.capabilities.ads; });
    d.byPlatform.concat([d.totals]).forEach(function (p) {
      var tr = document.createElement('tr');
      if (p.platform === 'all') tr.className = 'total';
      var first = document.createElement('td');
      if (p.platform !== 'all') {
        var k = document.createElement('i'); k.className = 'key ' + PLATFORMS.filter(function (x) { return x.key === p.platform; })[0].css.slice(2);
        k.style.marginRight = '6px'; first.appendChild(k);
      }
      first.appendChild(document.createTextNode(p.platform === 'all' ? '합계' : LABEL[p.platform]));
      tr.appendChild(first);
      [p.salesAmount, p.deliveryTip].forEach(function (v) { tr.appendChild(td(won(v))); });
      tr.appendChild(td(cnt(p.orderCount)));
      [p.fees.commission, p.fees.payment, p.fees.delivery, p.fees.vat, p.fees.other, p.fees.total].forEach(function (v) { tr.appendChild(td(won(v))); });
      var shareTd = document.createElement('td');
      var sb = document.createElement('span'); sb.className = 'sharebar';
      var bar = document.createElement('i'); bar.style.width = Math.round((p.feeShare / maxShare) * 60) + 'px';
      sb.appendChild(bar); sb.appendChild(document.createTextNode(pct(p.feeShare)));
      shareTd.appendChild(sb); tr.appendChild(shareTd);
      tr.appendChild(td(won(p.payout)));
      var adText = p.platform !== 'all' && adsSupported[p.platform] === false ? '미지원' : won(p.adSpend);
      tr.appendChild(td(adText, adText === '미지원' ? 'muted' : ''));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  function renderLegends(keys) {
    document.querySelectorAll('[data-legend]').forEach(function (box) {
      box.textContent = '';
      seriesFor(keys).forEach(function (s) {
        var sp = document.createElement('span');
        var i = document.createElement('i'); i.className = 'key'; i.style.background = s.color;
        sp.appendChild(i); sp.appendChild(document.createTextNode(s.label));
        box.appendChild(sp);
      });
    });
  }

  function renderDaily(d) {
    var n = d.daily.length, step = Math.ceil(n / 10);
    Charts.barChart($('dailyChart'), {
      ariaLabel: '일별 매출 누적 막대 차트',
      categories: d.daily.map(function (x) { return x.date; }),
      tickLabel: function (i) { return i % step === 0 ? mdLabel(d.daily[i].date) : null; },
      series: seriesFor(d.platforms),
      value: function (k, i) { return d.daily[i].sales[k] || 0; },
      format: function (v, axis) { return axis ? short(v) : won(v); },
      tipTitle: function (i) { return d.daily[i].date; },
      showTotal: true,
    });
    var tbl = $('dailyTable'); tbl.textContent = '';
    var hr = document.createElement('tr'); hr.appendChild(th('날짜'));
    d.platforms.forEach(function (p) { hr.appendChild(th(LABEL[p] + ' 매출')); hr.appendChild(th(LABEL[p] + ' 주문')); });
    var thead = document.createElement('thead'); thead.appendChild(hr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    d.daily.slice().reverse().forEach(function (row) {
      var tr = document.createElement('tr'); tr.appendChild(td(row.date));
      d.platforms.forEach(function (p) { tr.appendChild(td(won(row.sales[p] || 0))); tr.appendChild(td(cnt(row.orders[p] || 0))); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  function renderHourWeek(d) {
    var series = seriesFor(d.platforms);
    Charts.barChart($('hourlyChart'), {
      ariaLabel: '시간대별 주문 차트',
      categories: d.hourly.map(function (h) { return String(h.hour); }),
      tickLabel: function (i) { return i % 3 === 0 ? i + '시' : null; },
      series: series,
      value: function (k, i) { return d.hourly[i].orders[k] || 0; },
      format: function (v, axis) { return axis ? short(v) : cnt(v); },
      tipTitle: function (i) { return i + '시 ~ ' + (i + 1) + '시'; },
      showTotal: true,
    });
    Charts.barChart($('weekdayChart'), {
      ariaLabel: '요일별 주문 차트',
      categories: d.weekday.map(function (w) { return w.label; }),
      tickLabel: function (i) { return d.weekday[i].label; },
      series: series,
      value: function (k, i) { return d.weekday[i].orders[k] || 0; },
      format: function (v, axis) { return axis ? short(v) : cnt(v); },
      tipTitle: function (i) { return d.weekday[i].label + '요일'; },
      showTotal: true,
    });
  }

  function renderAds(d, status) {
    var a = d.ads;
    var unsupported = status.filter(function (s) { return !s.capabilities.ads; }).map(function (s) { return LABEL[s.platform]; });
    $('adSub').textContent = (a.platforms.length ? '광고 데이터: ' + a.platforms.map(function (p) { return LABEL[p]; }).join(', ') : '광고 데이터가 없습니다') +
      (unsupported.length ? ' · 광고 조회 미지원: ' + unsupported.join(', ') : '') + ' · 기간형 광고(월 정액)는 하루 단위로 나눠 계산';
    var spend = a.daily.reduce(function (s, x) { return s + x.spend; }, 0);
    var sales = a.daily.reduce(function (s, x) { return s + x.sales; }, 0);
    var box = $('adKpis'); box.textContent = '';
    [['광고비 합계', won(spend)], ['같은 플랫폼 매출', won(sales)], ['매출 대비 광고비', sales ? pct(spend / sales) : '-'], ['광고비 1원당 매출', spend ? (sales / spend).toFixed(1) + '원' : '-']]
      .forEach(function (kv) { var x = document.createElement('div'); var b = document.createElement('b'); b.textContent = kv[1]; x.appendChild(b); x.appendChild(document.createTextNode(kv[0])); box.appendChild(x); });

    var n = a.daily.length, step = Math.ceil(n / 7);
    var adColor = a.platforms.length === 1 ? color(PLATFORMS.filter(function (p) { return p.key === a.platforms[0]; })[0].css) : color('--neutral-bar');
    var common = {
      categories: a.daily.map(function (x) { return x.date; }),
      tickLabel: function (i) { return i % step === 0 ? mdLabel(a.daily[i].date) : null; },
      tipTitle: function (i) { return a.daily[i].date; },
      emptyText: '광고 데이터가 없습니다',
    };
    // 단위가 다른 두 값은 이중 축 대신 같은 x축의 차트 두 개로 나란히
    Charts.barChart($('adSpendChart'), Object.assign({}, common, {
      ariaLabel: '일별 광고비', series: [{ key: 'spend', label: '광고비', color: adColor }],
      value: function (_, i) { return a.daily[i].spend; }, format: function (v, axis) { return axis ? short(v) : won(v); },
    }));
    Charts.barChart($('adSalesChart'), Object.assign({}, common, {
      ariaLabel: '광고 플랫폼 일별 매출', series: [{ key: 'sales', label: '매출', color: adColor }],
      value: function (_, i) { return a.daily[i].sales; }, format: function (v, axis) { return axis ? short(v) : won(v); },
    }));

    var tbl = $('adTable'); tbl.textContent = '';
    if (!a.byProduct.length) return;
    var hr = document.createElement('tr');
    ['플랫폼 · 광고 상품', '광고비', '클릭', '클릭당 비용'].forEach(function (h) { hr.appendChild(th(h)); });
    var thead = document.createElement('thead'); thead.appendChild(hr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    a.byProduct.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.appendChild(td(LABEL[p.platform]));
      tr.cells[0].appendChild(document.createTextNode(' · ' + p.product));
      tr.appendChild(td(won(p.spend)));
      tr.appendChild(td(p.clicks == null ? '정액' : cnt(p.clicks).replace('건', '회'), p.clicks == null ? 'muted' : ''));
      tr.appendChild(td(p.clicks ? won(p.spend / p.clicks) : '-', p.clicks ? '' : 'muted'));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  function renderReviews() {
    if (!state.data) return;
    var d = state.data.dashboard;
    var onlyLow = $('onlyLow').checked, onlyUn = $('onlyUnreplied').checked;
    var list = d.reviews.filter(function (r) { return (!onlyLow || r.low) && (!onlyUn || !r.reply); });
    var t = d.totals;
    $('reviewSub').textContent = '최신순 · 전체 ' + cnt(t.reviewCount) + ' · 별점 ' + d.lowRatingThreshold + '점 이하 ' + cnt(t.lowRatingCount) + ' (빨간 테두리) · 답글 없음 ' + cnt(t.unrepliedCount);
    var ul = $('reviews'); ul.textContent = '';
    if (!list.length) { var li0 = document.createElement('li'); li0.className = 'sub'; li0.textContent = '해당하는 리뷰가 없습니다.'; ul.appendChild(li0); return; }
    list.slice(0, 200).forEach(function (r) {
      var li = document.createElement('li'); li.className = 'review' + (r.low ? ' low' : '');
      var meta = document.createElement('div'); meta.className = 'meta';
      var plat = document.createElement('span'); plat.className = 'plat';
      var k = document.createElement('i'); k.className = 'key'; k.style.background = color(PLATFORMS.filter(function (p) { return p.key === r.platform; })[0].css);
      plat.appendChild(k); plat.appendChild(document.createTextNode(LABEL[r.platform])); meta.appendChild(plat);
      var stars = document.createElement('span'); stars.className = 'stars'; stars.setAttribute('aria-label', '별점 ' + r.rating + '점');
      stars.appendChild(document.createTextNode('★'.repeat(r.rating)));
      var off = document.createElement('span'); off.className = 'off'; off.textContent = '★'.repeat(5 - r.rating); stars.appendChild(off);
      meta.appendChild(stars);
      if (r.low) { var f = document.createElement('span'); f.className = 'flag'; f.textContent = '⚠ 낮은 별점'; meta.appendChild(f); }
      var when = document.createElement('span'); when.textContent = r.createdAt.slice(0, 16).replace('T', ' '); meta.appendChild(when);
      if (r.authorName) { var au = document.createElement('span'); au.textContent = r.authorName; meta.appendChild(au); }
      if (r.imageUrls && r.imageUrls.length) { var im = document.createElement('span'); im.textContent = '📷 사진 ' + r.imageUrls.length; meta.appendChild(im); }
      li.appendChild(meta);
      var c = document.createElement('p'); c.className = 'content'; c.textContent = r.content; li.appendChild(c);
      if (r.menuSummary) { var m = document.createElement('div'); m.className = 'menu'; m.textContent = '주문: ' + r.menuSummary; li.appendChild(m); }
      if (r.reply) { var rp = document.createElement('div'); rp.className = 'reply'; rp.textContent = '↳ 사장님: ' + r.reply.content; li.appendChild(rp); }
      else { var nr = document.createElement('div'); nr.className = 'noreply'; nr.textContent = '답글 없음'; li.appendChild(nr); }
      ul.appendChild(li);
    });
  }

  // ── 먹깨비 파일 가져오기 ──
  function loadMukkebiFiles() {
    fetch('/api/mukkebi/files').then(function (r) { return r.json(); }).then(function (j) {
      var ul = $('mkbFiles'); ul.textContent = '';
      if (!j.files.length) { var li = document.createElement('li'); li.textContent = '가져온 파일이 없습니다 — 지금은 샘플 데이터를 보여 줍니다.'; ul.appendChild(li); return; }
      j.files.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = '📄 ' + f.name.replace(/^\d+_/, '') + ' · ' + (f.kind === 'orders' ? '주문' : f.kind === 'reviews' ? '리뷰' : f.kind) + ' ' + f.rows + '건';
        if (f.errors.length) { var e = document.createElement('div'); e.className = 'err'; e.textContent = f.errors.slice(0, 3).join(' / ') + (f.errors.length > 3 ? ' 외 ' + (f.errors.length - 3) + '건' : ''); li.appendChild(e); }
        ul.appendChild(li);
      });
    });
  }
  $('mkbFile').addEventListener('change', function (ev) {
    var files = Array.prototype.slice.call(ev.target.files);
    Promise.all(files.map(function (f) {
      return fetch('/api/mukkebi/import?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.error) throw new Error(f.name + ': ' + j.error); });
    })).then(load).catch(function (e) { alert(e.message); load(); });
    ev.target.value = '';
  });
  $('mkbClear').addEventListener('click', function () {
    if (!confirm('가져온 먹깨비 파일을 모두 지울까요? (샘플 데이터로 돌아갑니다)')) return;
    fetch('/api/mukkebi/files', { method: 'DELETE' }).then(load);
  });

  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (state.data) render(); }, 150); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (state.data) render(); });

  setPreset(30);
  load();
})();
