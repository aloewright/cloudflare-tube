import { Hono } from 'hono';

export interface SeoEnv {
  DB: D1Database;
}

export interface VideoSitemapEntry {
  thumbnail_loc: string;
  title: string;
  description: string;
  content_loc: string;
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  video?: VideoSitemapEntry;
}

const MAX_VIDEO_URLS = 5000;
const MAX_CHANNEL_URLS = 1000;
const SITEMAP_CACHE_SECONDS = 3600;
const ROBOTS_CACHE_SECONDS = 86400;
// Google video sitemap limits: title <=100 chars, description <=2048 chars.
// https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps
const VIDEO_TITLE_MAX = 100;
const VIDEO_DESCRIPTION_MAX = 2048;

export function renderRobotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" UTC. Convert to W3C
// (YYYY-MM-DDTHH:MM:SSZ). Returns undefined if the value isn't parseable so
// the caller can omit <lastmod> rather than emit a malformed date.
export function toW3CDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZ);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function truncateForSitemap(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

export function renderSitemap(urls: SitemapUrl[]): string {
  const hasVideo = urls.some((u) => u.video);
  const urlsetAttrs = hasVideo
    ? ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' +
      ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'
    : ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset${urlsetAttrs}>`,
  ];
  for (const u of urls) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(u.loc)}</loc>`);
    if (u.lastmod) lines.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`);
    if (u.changefreq) lines.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (typeof u.priority === 'number') {
      const clamped = Math.max(0, Math.min(1, u.priority));
      lines.push(`    <priority>${clamped.toFixed(1)}</priority>`);
    }
    if (u.video) {
      lines.push('    <video:video>');
      lines.push(`      <video:thumbnail_loc>${escapeXml(u.video.thumbnail_loc)}</video:thumbnail_loc>`);
      lines.push(`      <video:title>${escapeXml(truncateForSitemap(u.video.title, VIDEO_TITLE_MAX))}</video:title>`);
      lines.push(
        `      <video:description>${escapeXml(truncateForSitemap(u.video.description, VIDEO_DESCRIPTION_MAX))}</video:description>`,
      );
      lines.push(`      <video:content_loc>${escapeXml(u.video.content_loc)}</video:content_loc>`);
      lines.push('    </video:video>');
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  lines.push('');
  return lines.join('\n');
}

export const seoRoutes = new Hono<{ Bindings: SeoEnv }>();

seoRoutes.get('/robots.txt', (c) => {
  const origin = new URL(c.req.url).origin;
  return new Response(renderRobotsTxt(origin), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${ROBOTS_CACHE_SECONDS}`,
    },
  });
});

interface SitemapVideoRow {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  updated_at: string;
}

export function buildVideoSitemapEntry(args: {
  origin: string;
  row: SitemapVideoRow;
}): VideoSitemapEntry | undefined {
  const { origin, row } = args;
  if (!row.thumbnail_url) return undefined;
  // content_loc must point to the actual media bytes. The /api/videos/:id/stream
  // route serves the R2 object directly with Range support, which Google accepts.
  return {
    thumbnail_loc: row.thumbnail_url,
    title: row.title,
    description: row.description ?? '',
    content_loc: `${origin}/api/videos/${encodeURIComponent(row.id)}/stream`,
  };
}

seoRoutes.get('/sitemap.xml', async (c) => {
  const origin = new URL(c.req.url).origin;

  const [videoRows, channelRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, title, description, thumbnail_url, updated_at FROM videos
       WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'ready'
         AND (dmca_status IS NULL OR dmca_status != 'disabled')
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
      .bind(MAX_VIDEO_URLS)
      .all<SitemapVideoRow>(),
    c.env.DB.prepare(
      `SELECT u.username AS username, MAX(v.updated_at) AS updated_at
       FROM user u
       JOIN videos v ON v.user_id = u.id
       WHERE u.username IS NOT NULL
         AND v.deleted_at IS NULL AND v.hidden_at IS NULL AND v.status = 'ready'
         AND (v.dmca_status IS NULL OR v.dmca_status != 'disabled')
       GROUP BY u.username
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
      .bind(MAX_CHANNEL_URLS)
      .all<{ username: string; updated_at: string }>(),
  ]);

  const urls: SitemapUrl[] = [
    { loc: `${origin}/`, changefreq: 'hourly', priority: 1.0 },
    { loc: `${origin}/search`, changefreq: 'daily', priority: 0.8 },
  ];

  for (const row of videoRows.results ?? []) {
    urls.push({
      loc: `${origin}/watch/${encodeURIComponent(row.id)}`,
      lastmod: toW3CDate(row.updated_at),
      changefreq: 'weekly',
      priority: 0.7,
      video: buildVideoSitemapEntry({ origin, row }),
    });
  }
  for (const row of channelRows.results ?? []) {
    urls.push({
      loc: `${origin}/channel/${encodeURIComponent(row.username)}`,
      lastmod: toW3CDate(row.updated_at),
      changefreq: 'daily',
      priority: 0.6,
    });
  }

  return new Response(renderSitemap(urls), {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': `public, max-age=${SITEMAP_CACHE_SECONDS}`,
    },
  });
});
