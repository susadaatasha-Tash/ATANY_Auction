// backend/src/tests/auctionPresence.test.js — live-viewer presence:
// unique users, multi-tab safety, disconnect/end cleanup, wiring contracts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  joinWatcher, leaveWatcher, removeSocket, watcherCount, clearAuction,
  isValidAuctionId, onPresenceChange, __resetPresence,
  removeUser, auctionsForUser,
} from '../services/auctionPresence.js';

beforeEach(() => __resetPresence());

describe('presence core', () => {
  it('1. first authenticated join → count 1', () => {
    expect(joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' })).toBe(1);
    expect(watcherCount('a1')).toBe(1);
  });

  it('2. second unique customer → count 2', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    expect(joinWatcher({ auctionId: 'a1', userId: 'u2', socketId: 's2' })).toBe(2);
  });

  it('3. same user, second socket (two tabs) → still 1', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    expect(joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's2' })).toBe(1);
    expect(watcherCount('a1')).toBe(1);
  });

  it('4. leaving one of two sockets keeps the user (count unchanged)', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's2' });
    expect(leaveWatcher({ auctionId: 'a1', socketId: 's1' })).toMatchObject({ count: 1, removed: true });
    expect(watcherCount('a1')).toBe(1);
  });

  it('5. leaving the final socket decrements to 0', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'u2', socketId: 's2' });
    leaveWatcher({ auctionId: 'a1', socketId: 's1' });
    expect(leaveWatcher({ auctionId: 'a1', socketId: 's2' })).toMatchObject({ count: 0 });
    expect(watcherCount('a1')).toBe(0);
  });

  it('6. disconnect removes the socket from every auction', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    joinWatcher({ auctionId: 'a2', userId: 'u1', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'u2', socketId: 's2' });
    const changed = removeSocket('s1');
    expect(changed).toEqual(expect.arrayContaining([
      expect.objectContaining({ auctionId: 'a1', count: 1 }),
      expect.objectContaining({ auctionId: 'a2', count: 0 }),
    ]));
    expect(watcherCount('a1')).toBe(1);
    expect(watcherCount('a2')).toBe(0);
    expect(removeSocket('ghost')).toEqual([]);
  });

  it('7. auction end clears presence to 0', () => {
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    expect(clearAuction('a1')).toBe(true);
    expect(watcherCount('a1')).toBe(0);
    expect(clearAuction('a1')).toBe(false);
  });

  it('9. malformed auction ids rejected', () => {
    expect(joinWatcher({ auctionId: '', userId: 'u1', socketId: 's1' })).toBe(-1);
    expect(joinWatcher({ auctionId: '!!!', userId: 'u1', socketId: 's1' })).toBe(-1);
    expect(joinWatcher({ auctionId: null, userId: 'u1', socketId: 's1' })).toBe(-1);
    expect(isValidAuctionId('228795bc-a0c6-4ac8-a5c9-68924dcfd6d0')).toBe(true);
    expect(watcherCount('nope')).toBe(0);
  });

  it('change listener fires on join/leave/clear', () => {
    const seen = [];
    const off = onPresenceChange((id, count) => seen.push([id, count]));
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    leaveWatcher({ auctionId: 'a1', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'u1', socketId: 's1' });
    clearAuction('a1');
    off();
    expect(seen).toEqual([['a1', 1], ['a1', 0], ['a1', 1], ['a1', 0]]);
  });
});

describe('presence wiring contracts', () => {
  it('8/role-gate: only customers counted (role checked in socket handler)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toContain('auction:watch');
    expect(indexSrc).toContain('auction:unwatch');
    expect(indexSrc).toContain('leave:auction');
    expect(indexSrc).toMatch(/role.*customer|customer.*role/);
  });

  it('10. manage enrich exposes live presence count (+ saved_count kept separate)', () => {
    const manageSrc = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/auctionManage.controller.js'), 'utf8');
    expect(manageSrc).toMatch(/liveWatcherCount|watcherCount\(a\.id\)/);
    expect(manageSrc).toContain('saved_count');
  });

  it('end path clears presence via closeSingleAuction', () => {
    const closerSrc = fs.readFileSync(path.join(__dirname, '../services/auctionClosingService.js'), 'utf8');
    expect(closerSrc).toContain('clearAuction');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Account-suspension presence rules.
 * Eligibility is role === 'customer' AND status === 'active'. A suspended
 * account must never linger in the count as a ghost watcher, across any number
 * of tabs, and removing it must broadcast the corrected number.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('presence under account suspension', () => {
  beforeEach(() => __resetPresence());

  it('s. a suspended user is removed from EVERY auction they watch (all tabs)', () => {
    joinWatcher({ auctionId: 'a1', userId: 'suspend-me', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'suspend-me', socketId: 's2' }); // second tab
    joinWatcher({ auctionId: 'a2', userId: 'suspend-me', socketId: 's3' });
    joinWatcher({ auctionId: 'a1', userId: 'stay', socketId: 's4' });

    const changed = removeUser('suspend-me');
    expect(watcherCount('a1')).toBe(1);      // only the untouched customer remains
    expect(watcherCount('a2')).toBe(0);
    expect(changed.map((c) => c.auctionId).sort()).toEqual(['a1', 'a2']);
    expect(changed.find((c) => c.auctionId === 'a1').count).toBe(1);
  });

  it('t. other customers are unaffected by a suspension', () => {
    joinWatcher({ auctionId: 'a1', userId: 'maria', socketId: 's1' });
    joinWatcher({ auctionId: 'a1', userId: 'britz', socketId: 's2' });
    removeUser('britz');
    expect(watcherCount('a1')).toBe(1);
  });

  it('u. a reactivated user is NOT auto-re-added — they must reopen an auction', () => {
    joinWatcher({ auctionId: 'a1', userId: 'britz', socketId: 's1' });
    removeUser('britz');
    expect(watcherCount('a1')).toBe(0);
    expect(auctionsForUser('britz')).toEqual([]);
    // deliberate reopen by the customer
    joinWatcher({ auctionId: 'a1', userId: 'britz', socketId: 's9' });
    expect(watcherCount('a1')).toBe(1);
  });

  it('v. removing an unknown user is a no-op and never goes negative', () => {
    joinWatcher({ auctionId: 'a1', userId: 'maria', socketId: 's1' });
    expect(removeUser('ghost')).toEqual([]);
    expect(watcherCount('a1')).toBe(1);
  });

  it('w. auctionsForUser lists every auction a user is watching', () => {
    joinWatcher({ auctionId: 'a1', userId: 'britz', socketId: 's1' });
    joinWatcher({ auctionId: 'a3', userId: 'britz', socketId: 's2' });
    expect(auctionsForUser('britz').sort()).toEqual(['a1', 'a3']);
  });
});
