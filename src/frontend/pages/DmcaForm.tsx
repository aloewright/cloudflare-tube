import { useState } from 'react';

// LEGAL-REVIEW: every form label, helper text, and the perjury / good-faith
// statements must match 17 U.S.C. § 512(c)(3) requirements before launch. The
// strings below are placeholders intended only to exercise the engineering
// surface and are tracked under follow-up issues.

interface SubmissionResult {
  id: string;
  status: string;
}

export function DmcaForm(): JSX.Element {
  const [videoId, setVideoId] = useState('');
  const [complainantName, setComplainantName] = useState('');
  const [complainantEmail, setComplainantEmail] = useState('');
  const [complainantAddress, setComplainantAddress] = useState('');
  const [complainantPhone, setComplainantPhone] = useState('');
  const [copyrightedWork, setCopyrightedWork] = useState('');
  const [infringingUrls, setInfringingUrls] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [perjury, setPerjury] = useState(false);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmissionResult | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const urls = infringingUrls
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await fetch('/api/dmca/submission', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          videoId,
          complainantName,
          complainantEmail,
          complainantAddress,
          complainantPhone,
          copyrightedWork,
          infringingUrls: urls,
          goodFaithSigned: goodFaith,
          perjurySigned: perjury,
          signature,
        }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
      setSubmitted((await r.json()) as SubmissionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <main className="app-main stack-lg">
        <h1 className="ds-h2">DMCA notice received</h1>
        {/* LEGAL-REVIEW: replace placeholder confirmation copy. */}
        <p className="ds-meta">
          Reference: <code>{submitted.id}</code>. We&apos;ll email a confirmation to{' '}
          {complainantEmail}.
        </p>
      </main>
    );
  }

  return (
    <main className="app-main stack-lg">
      <header className="stack-sm">
        <h1 className="ds-h2">DMCA copyright notice</h1>
        {/* LEGAL-REVIEW: must match 17 U.S.C. § 512(c)(3) requirements before launch. */}
        <p className="ds-lede">
          Use this form to report copyright infringement. Submitting a false claim may carry legal consequences.
        </p>
      </header>

      {error && <p className="status-error">{error}</p>}

      <form className="stack-sm" onSubmit={(e) => void submit(e)}>
        <label className="stack-sm">
          <span className="ds-label">Video id</span>
          <input className="input" value={videoId} onChange={(e) => setVideoId(e.target.value)} required />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Your full name</span>
          <input className="input" value={complainantName} onChange={(e) => setComplainantName(e.target.value)} required />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Email</span>
          <input className="input" type="email" value={complainantEmail} onChange={(e) => setComplainantEmail(e.target.value)} required />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Mailing address</span>
          <textarea
            className="input"
            value={complainantAddress}
            onChange={(e) => setComplainantAddress(e.target.value)}
            required
          />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Phone</span>
          <input className="input" value={complainantPhone} onChange={(e) => setComplainantPhone(e.target.value)} required />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Description of copyrighted work</span>
          <textarea
            className="input"
            value={copyrightedWork}
            onChange={(e) => setCopyrightedWork(e.target.value)}
            required
          />
        </label>
        <label className="stack-sm">
          <span className="ds-label">Infringing URL(s) — one per line</span>
          <textarea
            className="input"
            value={infringingUrls}
            onChange={(e) => setInfringingUrls(e.target.value)}
            required
          />
        </label>
        <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} required />
          {/* LEGAL-REVIEW: § 512(c)(3)(A)(v) — good-faith statement. */}
          <span className="ds-meta">
            I have a good-faith belief that the use of the material is not authorized.
          </span>
        </label>
        <label style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={perjury} onChange={(e) => setPerjury(e.target.checked)} required />
          {/* LEGAL-REVIEW: § 512(c)(3)(A)(vi) — perjury / authorized agent statement. */}
          <span className="ds-meta">
            Under penalty of perjury, the information in this notice is accurate, and I am the owner or
            authorized to act on behalf of the owner.
          </span>
        </label>
        <label className="stack-sm">
          <span className="ds-label">Electronic signature (your full name)</span>
          <input className="input" value={signature} onChange={(e) => setSignature(e.target.value)} required />
        </label>
        <button type="submit" className="btn btn--secondary" disabled={busy}>
          Submit DMCA notice
        </button>
      </form>
    </main>
  );
}
