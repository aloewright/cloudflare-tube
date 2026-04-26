import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Watch } from './pages/Watch';
import { Upload } from './pages/Upload';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { signOut, useSession } from './lib/auth-client';
import './styles/strand.css';

type TrendingVideo = {
  id: string;
  title: string;
  description: string;
  channel_name?: string | null;
  view_count: number;
  recent_views?: number;
};

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }): JSX.Element {
  return (
    <Link to="/" aria-label="spooool" className={size === 'sm' ? 'ds-wordmark ds-wordmark--sm' : 'ds-wordmark'}>
      spooool
    </Link>
  );
}

function HeaderNav(): JSX.Element {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  if (isPending) {
    return <span className="ds-meta">…</span>;
  }

  if (!session) {
    return (
      <nav className="app-header__nav">
        <Link to="/login">
          <button type="button" className="btn btn--ghost btn--sm">Sign in</button>
        </Link>
        <Link to="/signup">
          <button type="button" className="btn btn--secondary btn--sm">Sign up</button>
        </Link>
      </nav>
    );
  }

  return (
    <nav className="app-header__nav">
      <span className="ds-meta">{session.user.email}</span>
      <Link to="/upload">
        <button type="button" className="btn btn--secondary btn--sm">Upload</button>
      </Link>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => {
          void signOut().then(() => navigate('/', { replace: true }));
        }}
      >
        Sign out
      </button>
    </nav>
  );
}

function AppHeader(): JSX.Element {
  return (
    <header className="app-header">
      <Wordmark size="sm" />
      <HeaderNav />
    </header>
  );
}

const SUGGESTIONS: { title: string; helper: string; to: string }[] = [
  { title: 'Upload a clip', helper: 'Drop in an MP4, WebM, MOV, or MKV.', to: '/upload' },
  { title: 'Open a channel', helper: 'Visit a creator and skim their library.', to: '/channel/explore' },
  { title: 'Watch something', helper: 'Jump into a video by id.', to: '/watch/demo' },
];

function TrendingCard({ video }: { video: TrendingVideo }): JSX.Element {
  return (
    <Link to={`/watch/${video.id}`} className="suggestion-card">
      <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{video.title}</div>
      <div className="ds-meta" style={{ marginTop: 4 }}>
        {video.channel_name ?? 'Unknown channel'} · {video.view_count} views
      </div>
    </Link>
  );
}

function Home(): JSX.Element {
  const [trending, setTrending] = useState<TrendingVideo[] | null>(null);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/videos/trending?limit=12')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load trending videos');
        }
        return (await response.json()) as { videos: TrendingVideo[] };
      })
      .then((data) => {
        if (!cancelled) {
          setTrending(data.videos);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTrendingError(err instanceof Error ? err.message : 'Unknown error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-main app-main--narrow stack-lg fade-in">
      <section
        className="stack-sm"
        style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'var(--space-8)' }}
      >
        <Wordmark />
        <p className="ds-meta" style={{ maxWidth: 420 }}>
          A video host that respects your time. Upload, stream, share — no friction.
        </p>
      </section>

      <section className="stack-sm" aria-label="Trending">
        <span className="ds-label">Trending this week</span>
        {trendingError ? (
          <p className="status-error">{trendingError}</p>
        ) : trending === null ? (
          <p className="ds-meta">Loading…</p>
        ) : trending.length === 0 ? (
          <p className="ds-meta">No trending videos yet — be the first to upload.</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--space-3)',
            }}
          >
            {trending.map((video) => (
              <TrendingCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </section>

      <section className="stack-sm" aria-label="Get started">
        <span className="ds-label">Start here</span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {SUGGESTIONS.map((item) => (
            <Link key={item.title} to={item.to} className="suggestion-card">
              <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{item.title}</div>
              <div className="ds-meta" style={{ marginTop: 4 }}>
                {item.helper}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

function Channel(): JSX.Element {
  return (
    <main className="app-main stack fade-in">
      <h1 className="ds-h2">Channel</h1>
      <p className="ds-meta">No videos yet.</p>
    </main>
  );
}

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <main className="app-main stack">
        <p className="ds-meta">Loading…</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return children;
}

export default function App(): JSX.Element {
  return (
    <div className="app-shell">
      <AppHeader />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/watch/:id" element={<Watch />} />
        <Route
          path="/upload"
          element={
            <RequireAuth>
              <Upload />
            </RequireAuth>
          }
        />
        <Route path="/channel/:username" element={<Channel />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
