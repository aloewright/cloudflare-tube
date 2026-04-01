import { Button, Field, Input, Meter, Surface } from '@cloudflare/kumo';
import { FormEvent, useMemo, useState } from 'react';

const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_SIZE = 5 * 1024 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']);

async function uploadInChunks(file: File, title: string, description: string, onProgress: (value: number) => void): Promise<Response> {
  const chunkCount = Math.ceil(file.size / CHUNK_SIZE);
  let lastResponse: Response | null = null;
  let uploadId: string | null = null;

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const formData = new FormData();
    formData.set('title', title);
    formData.set('description', description);
    formData.set('file', chunk, file.name);
    formData.set('chunkIndex', String(index));
    formData.set('chunkCount', String(chunkCount));
    if (uploadId) {
      formData.set('uploadId', uploadId);
    }

    lastResponse = await fetch('/api/videos/upload', {
      method: 'POST',
      body: formData,
    });

    if (!lastResponse.ok) {
      throw new Error('Upload failed');
    }

    const responseData = (await lastResponse.json()) as { uploadId?: string };
    if (responseData.uploadId) {
      uploadId = responseData.uploadId;
    }

    onProgress(Math.round(((index + 1) / chunkCount) * 100));
  }

  if (!lastResponse) {
    throw new Error('No upload response');
  }
  return lastResponse;
}

export function Upload(): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const isValidFile = useMemo(() => {
    if (!file) {
      return false;
    }
    return file.size <= MAX_SIZE && ALLOWED_TYPES.has(file.type);
  }, [file]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!file) {
      setError('Please choose a file');
      return;
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Unsupported file type');
      return;
    }
    if (file.size > MAX_SIZE) {
      setError('File exceeds 5GB max size');
      return;
    }

    try {
      await uploadInChunks(file, title, description, setProgress);
      setStatus('Upload complete');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  return (
    <Surface className="p-4 space-y-3">
      <h1>Upload Video</h1>
      <form onSubmit={(event) => void onSubmit(event)} className="space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Video File">
          <Input
            type="file"
            accept="video/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
          />
        </Field>

        <Meter label="Upload progress" value={progress} max={100} />
        <div>{progress}%</div>

        <Button type="submit" disabled={!isValidFile}>
          Upload
        </Button>
      </form>
      {error ? <p>{error}</p> : null}
      {status ? <p>{status}</p> : null}
    </Surface>
  );
}
