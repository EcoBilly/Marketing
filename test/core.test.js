const assert = require('assert');
const C = require('../core.js');
const DAY = 86400000, now = Date.UTC(2026, 10, 7);
const s = t => Math.floor(t / 1000);

const following = { relationships_following: [
  { title: 'old_friend', string_list_data: [{ href: 'https://www.instagram.com/_u/old_friend', timestamp: s(now - 30 * DAY) }] },
  { title: '', string_list_data: [{ href: 'https://www.instagram.com/no_back', value: 'no_back', timestamp: s(now - 20 * DAY) }] },
  { title: 'recent', string_list_data: [{ href: 'https://www.instagram.com/recent', timestamp: s(now - 3 * DAY) }] },
]};
const followers = [
  { title: '', media_list_attachments: [], string_list_data: [{ href: 'https://www.instagram.com/old_friend', value: 'old_friend', timestamp: s(now - 29 * DAY) }] },
];
const unfollowed = { relationships_unfollowed_users: [
  { title: '', string_list_data: [{ href: 'https://www.instagram.com/gone_user', value: 'gone_user', timestamp: s(now - 40 * DAY) }] },
]};

let st = C.emptyState();
const parsed = C.parseExport([
  { name: 'connections/followers_and_following/following.json', json: following },
  { name: 'connections/followers_and_following/followers_1.json', json: followers },
  { name: 'connections/followers_and_following/recently_unfollowed_profiles.json', json: unfollowed },
]);
assert.strictEqual(parsed.recognized.length, 3);
C.mergeImport(st, parsed, now);

// 14일 지난 비맞팔은 no_back 만
assert.deepStrictEqual(C.nonFollowBacks(st, 14, now).map(x => x.username), ['no_back']);
assert.deepStrictEqual(C.nonFollowBacks(st, 2, now).map(x => x.username), ['no_back', 'recent']);

// 후보 검사: 예전에 팔로우했던 계정 제외
let r = C.checkCandidates(st, 'gone_user, https://www.instagram.com/new_one/ old_friend @Another.One');
assert.deepStrictEqual(r.fresh, ['new_one', 'another.one']);
assert.deepStrictEqual(r.alreadyFollowing, ['old_friend']);
assert.deepStrictEqual(r.previouslyFollowed, ['gone_user']);

// 언팔 표시 → 목록에서 빠지고, 다시 후보로 안 나옴
C.markUnfollowed(st, 'no_back', now);
assert.deepStrictEqual(C.nonFollowBacks(st, 14, now), []);
assert.deepStrictEqual(C.checkCandidates(st, 'no_back').previouslyFollowed, ['no_back']);

// 다음 내보내기에서 recent 가 사라지면 언팔로 기록, 이력은 유지
const later = now + 7 * DAY;
C.mergeImport(st, C.parseExport([{ name: 'following.json', json: { relationships_following: following.relationships_following.slice(0, 1) } }]), later);
assert.strictEqual(st.history.recent.unfollowedAt, later);
assert.deepStrictEqual(C.checkCandidates(st, 'recent').previouslyFollowed, ['recent']);

// 유지(화이트리스트)
let st2 = C.emptyState(); C.mergeImport(st2, parsed, now); st2.whitelist.no_back = true;
assert.deepStrictEqual(C.nonFollowBacks(st2, 14, now), []);

console.log('all tests passed');
