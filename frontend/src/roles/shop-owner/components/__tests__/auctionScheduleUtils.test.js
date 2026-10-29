import { describe, it, expect } from 'vitest';
import {
  getLocalToday,
  toDateKey,
  scheduleValidation,
} from '../auctionScheduleUtils';

describe('getLocalToday (no UTC shifting)', () => {
  it('returns local year/month/day/dateKey', () => {
    const t = getLocalToday();
    const n = new Date();
    expect(t).toEqual({
      year: n.getFullYear(),
      month: n.getMonth(),
      day: n.getDate(),
      dateKey: toDateKey(n),
    });
  });

  it('matches the wall-clock date key, not UTC', () => {
    expect(toDateKey(new Date(2026, 9, 11, 23, 30))).toBe('2026-10-11');
  });
});

describe('scheduleValidation (preserved rules)', () => {
  it('rejects past start', () => {
    const past = new Date(Date.now() - 3600000);
    const pad = (x) => String(x).padStart(2, '0');
    const local = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;
    const end = new Date(Date.now() + 3600000);
    const endLocal = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
    const v = scheduleValidation(local, endLocal);
    expect(v?.field).toBe('start');
  });

  it('rejects end before start', () => {
    const s = new Date(Date.now() + 7200000);
    const e = new Date(Date.now() + 3600000);
    const fmt = (d) => {
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const v = scheduleValidation(fmt(s), fmt(e));
    expect(v?.field).toBe('end');
  });

  it('accepts a valid future window', () => {
    const s = new Date(Date.now() + 7200000);
    const e = new Date(Date.now() + 86400000);
    const fmt = (d) => {
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    expect(scheduleValidation(fmt(s), fmt(e))).toBeNull();
  });
});
