import { describe, it, expect, beforeEach } from 'vitest';
import { isSidebarOpen, toggleSidebar, openSidebar, closeSidebar, setSidebarOpen } from './sidebar';

describe('sidebarStore', () => {
  beforeEach(() => {
    isSidebarOpen.set(false);
  });

  it('defaults to closed', () => {
    expect(isSidebarOpen.get()).toBe(false);
  });

  it('can open, close, and set state explicitly', () => {
    openSidebar();
    expect(isSidebarOpen.get()).toBe(true);

    closeSidebar();
    expect(isSidebarOpen.get()).toBe(false);

    setSidebarOpen(true);
    expect(isSidebarOpen.get()).toBe(true);

    setSidebarOpen(false);
    expect(isSidebarOpen.get()).toBe(false);
  });

  it('toggles state back and forth', () => {
    toggleSidebar();
    expect(isSidebarOpen.get()).toBe(true);

    toggleSidebar();
    expect(isSidebarOpen.get()).toBe(false);
  });
});
