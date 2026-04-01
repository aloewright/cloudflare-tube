import { Button, Surface } from '@cloudflare/kumo';
import '@cloudflare/kumo/styles';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Watch } from './pages/Watch';
import { Upload } from './pages/Upload';

function Home(): JSX.Element {
  return (
    <Surface className="p-4">
      <h1>Cloudflare Tube</h1>
      <p>Browse and upload videos.</p>
      <div className="flex gap-2">
        <Link to="/upload">
          <Button>Upload</Button>
        </Link>
      </div>
    </Surface>
  );
}

function Channel(): JSX.Element {
  return (
    <Surface className="p-4">
      <h1>Channel</h1>
    </Surface>
  );
}

export default function App(): JSX.Element {
  return (
    <div data-theme="cloudflare">
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
