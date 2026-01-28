// Browser Panel Component
// Iframe-based Chrome browser with URL bar, navigation controls, tab management, and session persistence

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Plus,
  X,
  Loader2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  error: string | null;
  favicon: string | null;
}

interface BrowserPanelProps {
  className?: string;
  initialUrl?: string; // Optional initial URL to navigate to
}

const STORAGE_KEY_TABS = 'browser-tabs';
const STORAGE_KEY_ACTIVE_TAB = 'browser-active-tab';

export function BrowserPanel({ className, initialUrl }: BrowserPanelProps) {
  // Load from localStorage on mount, or use initialUrl if provided
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    // If initialUrl is provided, create a single tab with that URL (tab mode)
    if (initialUrl) {
      return [
        {
          id: 'tab_1',
          url: initialUrl,
          title: 'Browser',
          isLoading: false,
          error: null,
          favicon: null,
        },
      ];
    }

    // Otherwise load from localStorage (sidebar mode)
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TABS);
      if (saved) {
        return JSON.parse(saved) as BrowserTab[];
      }
    } catch (error) {
      console.warn('Failed to load browser tabs from storage:', error);
    }
    return [
      {
        id: 'tab_1',
        url: 'https://www.google.com',
        title: 'New Tab',
        isLoading: false,
        error: null,
        favicon: null,
      },
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
      if (saved) {
        return saved;
      }
    } catch (error) {
      console.warn('Failed to load active tab from storage:', error);
    }
    return 'tab_1';
  });

  const [urlInput, setUrlInput] = useState(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    return tab?.url || 'https://www.google.com';
  });
  const [canGoBack] = useState(false);
  const [canGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Persist tabs to localStorage whenever they change (only in sidebar mode)
  useEffect(() => {
    if (!initialUrl) {
      try {
        localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs));
      } catch (error) {
        console.warn('Failed to save browser tabs to storage:', error);
      }
    }
  }, [tabs, initialUrl]);

  // Persist active tab to localStorage whenever it changes (only in sidebar mode)
  useEffect(() => {
    if (!initialUrl) {
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTabId);
      } catch (error) {
        console.warn('Failed to save active tab to storage:', error);
      }
    }
  }, [activeTabId, initialUrl]);

  // Update URL input when active tab changes
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url);
    }
  }, [activeTab]);

  // Timeout for loading state (reset after 5 seconds if iframe never loads)
  useEffect(() => {
    if (!activeTab?.isLoading) return;

    const timeout = setTimeout(() => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId && tab.isLoading
            ? { ...tab, isLoading: false }
            : tab
        )
      );
    }, 5000);

    return () => clearTimeout(timeout);
  }, [activeTab?.isLoading, activeTabId]);

  // Normalize URL - add protocol if missing
  const normalizeUrl = useCallback((url: string): string => {
    const trimmed = url.trim();
    if (!trimmed) return 'about:blank';

    // If it looks like a search query (no dots, or spaces), search it
    if (!trimmed.includes('.') || trimmed.includes(' ')) {
      return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    }

    // Add https:// if no protocol
    if (!/^https?:\/\//i.test(trimmed)) {
      return `https://${trimmed}`;
    }

    return trimmed;
  }, []);

  // Handle URL navigation
  const handleNavigate = useCallback(
    (url: string) => {
      const normalizedUrl = normalizeUrl(url);
      setUrlInput(normalizedUrl);

      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, url: normalizedUrl, isLoading: true, error: null }
            : tab
        )
      );
    },
    [activeTabId, normalizeUrl]
  );

  // Handle URL input submit
  const handleUrlSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleNavigate(urlInput);
    },
    [urlInput, handleNavigate]
  );

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (iframeRef.current && canGoBack) {
      try {
        iframeRef.current.contentWindow?.history.back();
      } catch (error) {
        console.warn('Cannot access iframe history:', error);
      }
    }
  }, [canGoBack]);

  // Handle forward navigation
  const handleForward = useCallback(() => {
    if (iframeRef.current && canGoForward) {
      try {
        iframeRef.current.contentWindow?.history.forward();
      } catch (error) {
        console.warn('Cannot access iframe history:', error);
      }
    }
  }, [canGoForward]);

  // Handle reload
  const handleReload = useCallback(() => {
    if (iframeRef.current) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId ? { ...tab, isLoading: true, error: null } : tab
        )
      );
      iframeRef.current.src = iframeRef.current.src;
    }
  }, [activeTabId]);

  // Handle home navigation
  const handleHome = useCallback(() => {
    handleNavigate('https://www.google.com');
  }, [handleNavigate]);

  // Handle new tab
  const handleNewTab = useCallback(() => {
    const newTabId = `tab_${Date.now()}`;
    const newTab: BrowserTab = {
      id: newTabId,
      url: 'https://www.google.com',
      title: 'New Tab',
      isLoading: false,
      error: null,
      favicon: null,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    setUrlInput('https://www.google.com');
  }, []);

  // Handle close tab
  const handleCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);

        // If closing active tab, switch to another
        if (tabId === activeTabId && filtered.length > 0) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActiveTab = filtered[Math.min(closedIndex, filtered.length - 1)];
          if (newActiveTab) {
            setActiveTabId(newActiveTab.id);
            setUrlInput(newActiveTab.url);
          }
        }

        // If last tab, create new one
        if (filtered.length === 0) {
          const newTabId = `tab_${Date.now()}`;
          setActiveTabId(newTabId);
          setUrlInput('https://www.google.com');
          return [
            {
              id: newTabId,
              url: 'https://www.google.com',
              title: 'New Tab',
              isLoading: false,
              error: null,
              favicon: null,
            },
          ];
        }

        return filtered;
      });
    },
    [activeTabId]
  );

  // Handle tab switch
  const handleTabSwitch = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      setUrlInput(tab.url);
    }
  }, [tabs]);

  // Extract favicon from URL
  const extractFavicon = useCallback((url: string): string | null => {
    try {
      const urlObj = new URL(url);
      // Try common favicon locations
      return `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    } catch {
      return null;
    }
  }, []);

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, isLoading: false } : tab
      )
    );

    // Try to update URL and favicon from iframe (may fail due to CORS)
    try {
      if (iframeRef.current?.contentWindow?.location.href) {
        const iframeUrl = iframeRef.current.contentWindow.location.href;
        if (iframeUrl !== 'about:blank') {
          setUrlInput(iframeUrl);
          const favicon = extractFavicon(iframeUrl);
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTabId ? { ...tab, url: iframeUrl, favicon } : tab
            )
          );
        }
      }
    } catch {
      // CORS restriction - can't access iframe URL, but we can still try favicon from current URL
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) {
        const favicon = extractFavicon(tab.url);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, favicon } : t
          )
        );
      }
    }
  }, [activeTabId, extractFavicon, tabs]);

  // Handle iframe error
  const handleIframeError = useCallback(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              isLoading: false,
              error: 'Failed to load page. This website may have security policies (X-Frame-Options or CSP frame-ancestors) that prevent embedding in iframes.',
            }
          : tab
      )
    );
  }, [activeTabId]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => handleTabSwitch(tab.id)}
            data-testid="browser-tab"
            data-tab-id={tab.id}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-colors min-w-[120px] max-w-[200px]',
              tab.id === activeTabId
                ? 'bg-background border border-border'
                : 'hover:bg-muted/50'
            )}
          >
            {tab.isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
            ) : tab.error ? (
              <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
            ) : tab.favicon ? (
              <img
                src={tab.favicon}
                alt=""
                className="h-3 w-3 flex-shrink-0"
                onError={(e) => {
                  // Fallback to Globe icon if favicon fails to load
                  e.currentTarget.style.display = 'none';
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    const fallbackIcon = document.createElement('span');
                    fallbackIcon.innerHTML = '<svg class="h-3 w-3 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>';
                    parent.insertBefore(fallbackIcon, e.currentTarget);
                  }
                }}
              />
            ) : (
              <Globe className="h-3 w-3 flex-shrink-0" />
            )}
            <span className="flex-1 truncate">{tab.title}</span>
            <button
              onClick={(e) => handleCloseTab(tab.id, e)}
              className="hover:bg-muted/50 rounded p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
          onClick={handleNewTab}
          title="New tab"
          data-testid="browser-new-tab-button"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/20">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleBack}
          disabled={!canGoBack}
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleForward}
          disabled={!canGoForward}
          title="Forward"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleReload}
          disabled={activeTab?.isLoading}
          title="Reload"
        >
          {activeTab?.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCw className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleHome}
          title="Home"
        >
          <Home className="h-4 w-4" />
        </Button>

        {/* URL bar */}
        <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center">
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL or search term..."
            className="h-7 text-xs"
          />
        </form>
      </div>

      {/* Browser viewport */}
      <div className="flex-1 relative bg-white">
        {activeTab?.error ? (
          <Card className="m-4 p-4">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle className="h-5 w-5" />
              <div className="flex-1">
                <p className="font-medium">Unable to load page</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {activeTab.error}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Some websites (like Google, GitHub, etc.) block iframe embedding for security.
                  Click the button below to open this URL in your default browser.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => window.open(activeTab.url, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in External Browser
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <iframe
            ref={iframeRef}
            src={activeTab?.url}
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
            title="Browser"
          />
        )}
      </div>
    </div>
  );
}

export default BrowserPanel;
