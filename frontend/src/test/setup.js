import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Node's Web Storage globals can shadow jsdom's browser storage in Vitest 1.
// Use this worker's native, origin-scoped jsdom Storage rather than disk-backed
// Node storage. Keep draft persistence real and isolate it between tests.
for (const key of ['localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: globalThis.jsdom.window[key],
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
