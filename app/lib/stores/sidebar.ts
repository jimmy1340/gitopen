import { atom } from 'nanostores';

export const isSidebarOpen = atom<boolean>(false);

export function toggleSidebar(): void {
  isSidebarOpen.set(!isSidebarOpen.get());
}

export function openSidebar(): void {
  isSidebarOpen.set(true);
}

export function closeSidebar(): void {
  isSidebarOpen.set(false);
}

export function setSidebarOpen(open: boolean): void {
  isSidebarOpen.set(open);
}
