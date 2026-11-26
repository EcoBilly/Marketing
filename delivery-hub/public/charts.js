/* 의존성 없는 작은 SVG 막대 차트 (누적/단일). 툴팁은 카테고리 열 전체가 히트 영역. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var tip = function () { return document.getElementById('tooltip'); };

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / exp;
    var steps = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]; // 4등분 눈금이 깔끔한 값
    var nf = steps.filter(function (s) { return s >= f - 1e-9; })[0];
    return nf * exp;
  }

  // 위쪽 모서리만 둥근 막대 (데이터 끝 4px 라운드, 기준선 쪽은 각짐)
  function topRounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  function showTip(evt, title, rows) {
    var t = tip();
    t.textContent = '';
    var h = document.createElement('div'); h.className = 't'; h.textContent = title; t.appendChild(h);
    rows.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'r';
      var s = document.createElement('span');
      var i = document.createElement('i'); i.style.background = r.color; s.appendChild(i);
      s.appendChild(document.createTextNode(r.label));
      var b = document.createElement('b'); b.textContent = r.value;
      row.appendChild(s); row.appendChild(b); t.appendChild(row);
    });
    t.hidden = false;
    var x = evt.clientX, y = evt.clientY;
    if (x === undefined) { var rect = evt.target.getBoundingClientRect(); x = rect.left + rect.width / 2; y = rect.top; }
    var tw = t.offsetWidth, th = t.offsetHeight;
    var left = x + 14 + tw > window.innerWidth ? x - tw - 14 : x + 14;
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, y - th - 10) + 'px';
  }
  function hideTip() { tip().hidden = true; }

  /**
   * opts: {
   *   categories: string[], tickLabel(i) => string|null,
   *   series: [{ key, label, color }], value(key, i) => number,
   *   format(v) => string, tipTitle(i) => string, showTotal: bool
   * }
   */
  function barChart(container, opts) {
    container.textContent = '';
    var W = container.clientWidth || 600, H = container.clientHeight || 240;
    var m = { top: 8, right: 8, bottom: 24, left: 56 };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.ariaLabel || '' }, container);
    var n = opts.categories.length;
    var totals = opts.categories.map(function (_, i) {
      return opts.series.reduce(function (s, se) { return s + (opts.value(se.key, i) || 0); }, 0);
    });
    var max = niceMax(Math.max.apply(null, totals.concat([0])));
    var iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    var y = function (v) { return m.top + ih - (v / max) * ih; };

    for (var g = 0; g <= 4; g++) {
      var v = (max / 4) * g, yy = Math.round(y(v)) + 0.5;
      el('line', { x1: m.left, x2: W - m.right, y1: yy, y2: yy, class: g === 0 ? 'baseline' : 'gridline' }, svg);
      var t = el('text', { x: m.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'tick' }, svg);
      t.textContent = opts.format(v, true);
    }
    if (!totals.some(function (x) { return x > 0; })) {
      var e = el('text', { x: m.left + iw / 2, y: m.top + ih / 2, 'text-anchor': 'middle', class: 'empty' }, svg);
      e.textContent = opts.emptyText || '데이터가 없습니다';
      return;
    }

    var band = iw / n;
    var bw = Math.max(2, Math.min(36, band * 0.68));
    var gap = band > 6 ? 2 : 0; // 막대 사이·누적 조각 사이 2px 표면 간격
    for (var i = 0; i < n; i++) {
      var cx = m.left + band * i + band / 2;
      var x = cx - bw / 2;
      var acc = 0;
      var visible = opts.series.filter(function (se) { return (opts.value(se.key, i) || 0) > 0; });
      visible.forEach(function (se, si) {
        var val = opts.value(se.key, i) || 0;
        var y0 = y(acc), y1 = y(acc + val);
        var h = Math.max(0, y0 - y1 - (si > 0 ? gap : 0));
        var isTop = si === visible.length - 1;
        if (h > 0) {
          if (isTop) el('path', { d: topRounded(x, y1, bw, h, 4), fill: se.color }, svg);
          else el('rect', { x: x, y: y1 + (si > 0 ? 0 : 0), width: bw, height: h, fill: se.color }, svg);
        }
        acc += val;
      });
      var label = opts.tickLabel(i);
      if (label) {
        var tl = el('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg);
        tl.textContent = label;
      }
      // 히트 영역: 카테고리 열 전체 (막대보다 크게)
      var hit = el('rect', { x: m.left + band * i, y: m.top, width: band, height: ih, class: 'hit', tabindex: 0 }, svg);
      (function (idx) {
        var rows = function () {
          var r = opts.series.map(function (se) {
            return { label: se.label, color: se.color, value: opts.format(opts.value(se.key, idx) || 0) };
          });
          if (opts.showTotal && opts.series.length > 1) r.push({ label: '합계', color: 'transparent', value: opts.format(totals[idx]) });
          return r;
        };
        hit.addEventListener('pointermove', function (ev) { showTip(ev, opts.tipTitle(idx), rows()); });
        hit.addEventListener('focus', function (ev) { showTip(ev, opts.tipTitle(idx), rows()); });
        hit.addEventListener('pointerleave', hideTip);
        hit.addEventListener('blur', hideTip);
      })(i);
    }
  }

  window.Charts = { barChart: barChart, hideTip: hideTip };
})();
