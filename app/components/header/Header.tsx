import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { toggleSidebar } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames('flex items-center px-4 border-b h-[var(--header-height)]', {
        'border-transparent': !chat.started,
        'border-bolt-elements-borderColor': chat.started,
      })}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary">
        <button
          type="button"
          onClick={toggleSidebar}
          title="Toggle Menu"
          aria-label="Toggle Menu"
          className="flex items-center justify-center p-1.5 rounded-md hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors focus:outline-none"
        >
          <div className="i-ph:sidebar-simple-duotone text-xl" />
        </button>
        <a href="/" className="text-2xl font-semibold text-accent flex items-center">
          {/* <span className="i-bolt:logo-text?mask w-[46px] inline-block" /> */}
          <img src="/logo-light-styled.png" alt="logo" className="w-[90px] inline-block dark:hidden" />
          <img src="/logo-dark-styled.png" alt="logo" className="w-[90px] inline-block hidden dark:block" />
        </a>
      </div>
      {chat.started ? (
        <>
          <span className="flex-1 px-4 truncate text-center text-bolt-elements-textPrimary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      ) : (
        <div className="flex-1 flex justify-end items-center gap-2">
          <ClientOnly>
            {() => (
              <>
                <ThemeSwitch />
                <a
                  href="https://github.com/jimmy1340/gitopen"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center p-1.5 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary rounded-md hover:bg-bolt-elements-item-backgroundActive transition-colors"
                  title="GitHub Repository"
                  aria-label="GitHub Repository"
                >
                  <div className="i-ph:github-logo text-xl" />
                </a>
              </>
            )}
          </ClientOnly>
        </div>
      )}
    </header>
  );
}
