/*
 * Marketing - 팔로우 관리 도구 핵심 로직
 * 인스타그램 "내 정보 다운로드"(JSON) 파일을 해석하고,
 * 맞팔 여부 / 팔로우 이력을 계산한다. 브라우저와 Node 양쪽에서 동작.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;

  function normalizeUsername(name) {
    return String(name || '').trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
  }

  function usernameFromHref(href) {
    if (!href) return '';
    var m = String(href).match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
    return m ? normalizeUsername(m[1]) : '';
  }

  // string_list_data 를 가진 항목들을 { username, timestamp(ms) } 로 변환
  function extractEntries(node) {
    var out = [];
    (function walk(n) {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.string_list_data)) {
        var d = n.string_list_data[0] || {};
        var username = normalizeUsername(d.value) || normalizeUsername(n.title) || usernameFromHref(d.href);
        if (username) out.push({ username: username, timestamp: d.timestamp ? d.timestamp * 1000 : null });
        return;
      }
      Object.keys(n).forEach(function (k) { walk(n[k]); });
    })(node);
    return out;
  }

  // 파일 종류 판별 (파일명 + 최상위 키)
  function classify(fileName, json) {
    var name = String(fileName || '').toLowerCase().split('/').pop();
    var keys = json && !Array.isArray(json) ? Object.keys(json).join(' ') : '';
    if (/relationships_following/.test(keys) || /^following(_\d+)?\.json$/.test(name)) return 'following';
    if (/relationships_unfollowed_users/.test(keys) || /recently_unfollowed/.test(name)) return 'unfollowed';
    if (/relationships_followers/.test(keys) || /^followers(_\d+)?\.json$/.test(name)) return 'followers';
    if (/follow_requests/.test(keys) || /follow_requests/.test(name)) return 'requests';
    return null;
  }

  /**
   * files: [{ name, json }]
   * 반환: { following: Map, followers: Set, unfollowed: Map, requests: Map, recognized: [] }
   */
  function parseExport(files) {
    var result = { following: {}, followers: {}, unfollowed: {}, requests: {}, recognized: [] };
    files.forEach(function (f) {
      var kind = classify(f.name, f.json);
      if (!kind) return;
      result.recognized.push({ name: f.name, kind: kind });
      extractEntries(f.json).forEach(function (e) {
        var bucket = result[kind];
        var prev = bucket[e.username];
        if (!prev || (e.timestamp && (!prev.timestamp || e.timestamp < prev.timestamp))) bucket[e.username] = e;
      });
    });
    return result;
  }

  function emptyState() {
    return {
      version: 1,
      // username -> { firstFollowedAt, lastSeenFollowingAt, unfollowedAt, followsMe }
      history: {},
      whitelist: {},
      lastImportAt: null
    };
  }

  /** 내보내기 데이터를 이력(state)에 병합. 이력은 절대 삭제하지 않는다. */
  function mergeImport(state, parsed, now) {
    now = now || Date.now();
    var h = state.history;
    function rec(u) { return h[u] || (h[u] = { firstFollowedAt: null, lastSeenFollowingAt: null, unfollowedAt: null, followsMe: false }); }
    function setFirst(r, ts) { if (ts && (!r.firstFollowedAt || ts < r.firstFollowedAt)) r.firstFollowedAt = ts; }

    var hasFollowing = Object.keys(parsed.following).length > 0;
    var hasFollowers = Object.keys(parsed.followers).length > 0 || parsed.recognized.some(function (r) { return r.kind === 'followers'; });

    Object.keys(parsed.following).forEach(function (u) {
      var r = rec(u);
      setFirst(r, parsed.following[u].timestamp || now);
      r.lastSeenFollowingAt = now;
      r.unfollowedAt = null;
    });
    Object.keys(parsed.requests).forEach(function (u) { setFirst(rec(u), parsed.requests[u].timestamp || now); });
    Object.keys(parsed.unfollowed).forEach(function (u) {
      var r = rec(u);
      if (parsed.following[u]) return;
      r.unfollowedAt = r.unfollowedAt || parsed.unfollowed[u].timestamp || now;
      if (!r.firstFollowedAt) r.firstFollowedAt = r.unfollowedAt;
    });
    // 이번 팔로잉 목록에 없는데 이전에 팔로잉 중이던 계정 → 언팔된 것으로 기록
    if (hasFollowing) {
      Object.keys(h).forEach(function (u) {
        var r = h[u];
        if (!parsed.following[u] && r.firstFollowedAt && !r.unfollowedAt) r.unfollowedAt = now;
      });
    }
    if (hasFollowers) {
      Object.keys(h).forEach(function (u) { h[u].followsMe = !!parsed.followers[u]; });
      Object.keys(parsed.followers).forEach(function (u) { if (h[u]) h[u].followsMe = true; });
    }
    state.lastImportAt = now;
    return state;
  }

  function isFollowing(r) { return !!(r && r.firstFollowedAt && !r.unfollowedAt); }

  /** 팔로우한 지 days 일 이상 지났는데 맞팔 안 한 계정 */
  function nonFollowBacks(state, days, now) {
    now = now || Date.now();
    var limit = (days == null ? 14 : days) * DAY;
    return Object.keys(state.history).filter(function (u) {
      var r = state.history[u];
      return isFollowing(r) && !r.followsMe && !state.whitelist[u] && now - r.firstFollowedAt >= limit;
    }).map(function (u) {
      return { username: u, firstFollowedAt: state.history[u].firstFollowedAt, days: Math.floor((now - state.history[u].firstFollowedAt) / DAY) };
    }).sort(function (a, b) { return a.firstFollowedAt - b.firstFollowedAt; });
  }

  /** 직접 언팔했다고 표시 */
  function markUnfollowed(state, username, now) {
    var r = state.history[normalizeUsername(username)];
    if (r) r.unfollowedAt = now || Date.now();
    return state;
  }

  /** 직접 팔로우했다고 표시 (내보내기 전이라도 이력에 남기기) */
  function markFollowed(state, username, now) {
    var u = normalizeUsername(username);
    if (!u) return state;
    var r = state.history[u] || (state.history[u] = { firstFollowedAt: null, lastSeenFollowingAt: null, unfollowedAt: null, followsMe: false });
    if (!r.firstFollowedAt) r.firstFollowedAt = now || Date.now();
    return state;
  }

  /**
   * 후보 목록 검사: 한 번이라도 팔로우했던 계정은 제외.
   * 반환: { fresh: [], alreadyFollowing: [], previouslyFollowed: [] }
   */
  function checkCandidates(state, text) {
    var seen = {};
    var res = { fresh: [], alreadyFollowing: [], previouslyFollowed: [] };
    String(text || '').split(/[\s,]+/).forEach(function (tok) {
      var u = usernameFromHref(tok) || normalizeUsername(tok);
      if (!u || seen[u] || !/^[a-z0-9._]{1,30}$/.test(u)) return;
      seen[u] = true;
      var r = state.history[u];
      if (!r || !r.firstFollowedAt) res.fresh.push(u);
      else if (isFollowing(r)) res.alreadyFollowing.push(u);
      else res.previouslyFollowed.push(u);
    });
    return res;
  }

  function stats(state) {
    var s = { following: 0, mutual: 0, everFollowed: 0, unfollowed: 0 };
    Object.keys(state.history).forEach(function (u) {
      var r = state.history[u];
      if (!r.firstFollowedAt) return;
      s.everFollowed++;
      if (isFollowing(r)) { s.following++; if (r.followsMe) s.mutual++; } else s.unfollowed++;
    });
    return s;
  }

  return {
    normalizeUsername: normalizeUsername,
    parseExport: parseExport,
    emptyState: emptyState,
    mergeImport: mergeImport,
    nonFollowBacks: nonFollowBacks,
    markUnfollowed: markUnfollowed,
    markFollowed: markFollowed,
    checkCandidates: checkCandidates,
    stats: stats
  };
});
