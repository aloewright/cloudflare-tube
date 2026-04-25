import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Watch } from './pages/Watch';
import { Upload } from './pages/Upload';
import './styles/strand.css';

function Wordmark({ size = 'lg' }: { size?: 'lg' | 'sm' }): JSX.Element {
  return (
    <Link to="/" aria-label="spooool" className={size === 'sm' ? 'ds-wordmark ds-wordmark--sm' : 'ds-wordmark'}>
      spooool
    </Link>
  );
}

function AppHeader(): JSX.Element {
  return (
    <header className="app-header">
      <Wordmark size="sm" />
      <nav className="app-header__nav">
        <Link to="/upload">
          <button type="button" className="btn btn--secondary btn--sm">
            Upload
          </button>
        </Link>
      </nav>
    </header>
  );
}

const SUGGESTIONS: { title: string; helper: string; to: string }[] = [
  { title: 'Browse trending', helper: 'See what people are watching today.', to: '/' },
  { title: 'Upload a clip', helper: 'Drop in an MP4, WebM, MOV, or MKV.', to: '/upload' },
  { title: 'Open a channel', helper: 'Visit a creator and skim their library.', to: '/channel/explore' },
  { title: 'Watch something', helper: 'Jump into a video by id.', to: '/watch/demo' },
];

function Home(): JSX.Element {
  return (
    <main className="app-main app-main--narrow stack-lg fade-in">
      <section className="stack-sm" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 'var(--space-8)' }}>
        <Wordmark />
        <p className="ds-meta" style={{ maxWidth: 420 }}>
          A video host that respects your time. Upload, stream, share — no friction.
        </p>
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

export default function App(): JSX.Element {
  return (
    <div className="app-shell">
      <AppHeader />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/watch/:id" element={<Watch />} />
        <Route path="/upload" element={<Upload />} />
        <Route path="/channel/:username" element={<Channel />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
