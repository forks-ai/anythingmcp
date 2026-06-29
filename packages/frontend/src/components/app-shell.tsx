'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTheme } from '@/lib/theme-context';
import { AppSidebar } from '@/components/app-sidebar';
import { Footer } from '@/components/footer';
import { TrialBanner } from '@/components/trial-banner';
import { UsageBanner } from '@/components/usage-banner';
import { cn } from '@/lib/utils';

interface AppShellProps {
  /** Page title shown in the content header. */
  title?: string;
  /** Optional muted subtitle under the title. */
  subtitle?: string;
  /** Breadcrumb trail; the last entry is rendered as the current title when no `title` is given. */
  breadcrumbs?: { label: string; href: string }[];
  /** Right-aligned header actions (primary buttons, etc.). */
  actions?: React.ReactNode;
  /** Constrain the content column width (default 1180px to match the redesign). */
  maxWidth?: number | string;
  /** Hide the footer (e.g. for full-bleed graph pages). */
  hideFooter?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  title,
  subtitle,
  breadcrumbs,
  actions,
  maxWidth = 1180,
  hideFooter = false,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const headerTitle = title ?? breadcrumbs?.[breadcrumbs.length - 1]?.label;

  return (
    <div className="flex h-screen items-stretch overflow-hidden">
      <AppSidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Global banners (in-flow, above the header) */}
        <div className="flex-shrink-0">
          <TrialBanner />
          <UsageBanner />
        </div>
        {/* Content header */}
        <header
          className="sticky top-0 z-30 flex h-[60px] flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 backdrop-blur-md sm:px-6"
          style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)' }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] md:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
            <div className="min-w-0">
              {breadcrumbs && breadcrumbs.length > 0 && (
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
                  {breadcrumbs.map((c, i) => (
                    <span key={c.href} className="flex items-center gap-1.5">
                      {i > 0 && <span>/</span>}
                      <Link href={c.href} className="hover:text-[var(--text)] hover:underline">{c.label}</Link>
                    </span>
                  ))}
                </div>
              )}
              {headerTitle && (
                <div className="truncate text-[16px] font-semibold tracking-[-0.02em]">{headerTitle}</div>
              )}
              {subtitle && (
                <div className="mt-px truncate text-[12.5px] text-[var(--text-3)]">{subtitle}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title="Toggle theme"
              aria-label="Toggle theme"
              className="flex h-9 w-9 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            >
              {isDark ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" /></svg>
              )}
            </button>
            {actions}
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className={cn('mx-auto w-full')} style={{ maxWidth }}>
            {children}
          </div>
          {!hideFooter && (
            <div className="mx-auto w-full" style={{ maxWidth }}>
              <Footer />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
