/**
 * Vitest setup.
 *
 * Node 24 ships an experimental global `localStorage` that is disabled unless
 * the process is started with `--localstorage-file`. When vitest populates
 * globals from jsdom's window, that disabled global wins, and
 * `window.localStorage` ends up `undefined` even though the jsdom document has
 * a perfectly good non-opaque origin.
 *
 * Rather than pass a Node flag (which every contributor and CI job would then
 * have to remember), this installs a minimal in-memory Storage. It implements
 * the whole surface the application uses — getItem, setItem, removeItem, key,
 * length, clear — with the same string coercion the real API performs, so the
 * tests exercise real code paths rather than a stub with different semantics.
 *
 * Browser behaviour that this does NOT emulate — quota exhaustion and blocked
 * site data — is handled in the application by try/catch around every access,
 * and those paths are covered by tests that write invalid values directly.
 */
import { beforeEach } from "vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    const value = this.store.get(String(key));
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(String(key));
  }

  setItem(key: string, value: string): void {
    // The real API coerces both arguments to strings.
    this.store.set(String(key), String(value));
  }
}

function install(name: "localStorage" | "sessionStorage") {
  const existing = (globalThis as Record<string, unknown>)[name];
  if (existing && typeof (existing as Storage).getItem === "function") return;
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
  }
}

install("localStorage");
install("sessionStorage");

// Isolation between test files and cases: a leaked key would make an ordering
// bug look like a passing test.
beforeEach(() => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
});
