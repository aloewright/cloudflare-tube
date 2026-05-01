import { describe, expect, it } from 'vitest';
import { VIDEO_META_CACHE_TTL_SECONDS, videoMetaCacheKey } from './index';

describe('video metadata KV cache (ALO-201)', () => {
  it('namespaces keys under video:v1:<id> so other ids cant collide', () => {
    expect(videoMetaCacheKey('abc')).toBe('video:v1:abc');
    expect(videoMetaCacheKey('abc')).not.toBe(videoMetaCacheKey('abcd'));
  });

  it('encodes the id as-is — D1 ids are URL-safe UUIDs already', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(videoMetaCacheKey(uuid)).toBe(`video:v1:${uuid}`);
  });

  it('TTL is short enough that webhook-driven status flips converge in <2 minutes', () => {
    // Webhook can transition encoding -> ready. We only cache rows where
    // status === 'ready', so the only stale-window the user sees is when
    // a separately-fetched aspect of the row changes. The 60s TTL bounds
    // that window; tighten only if we add cache for transient states.
    expect(VIDEO_META_CACHE_TTL_SECONDS).toBeLessThanOrEqual(120);
    expect(VIDEO_META_CACHE_TTL_SECONDS).toBeGreaterThanOrEqual(30);
  });

  it('produces distinct keys for similar-looking ids', () => {
    // Regression: ensure prefix 'video:v1:' is not stripped by encoding.
    const key1 = videoMetaCacheKey('1');
    const key2 = videoMetaCacheKey('12');
    const key3 = videoMetaCacheKey('123');
    expect(key1).not.toBe(key2);
    expect(key2).not.toBe(key3);
    expect(key1).not.toBe(key3);
  });

  it('returns a string for an empty id', () => {
    // Defensive: even if an empty id slips through, the key function should
    // not throw and should return a namespaced string.
    expect(typeof videoMetaCacheKey('')).toBe('string');
    expect(videoMetaCacheKey('')).toBe('video:v1:');
  });

  it('VIDEO_META_CACHE_TTL_SECONDS is exactly 60 seconds as set in this PR', () => {
    // The constant was moved from video-meta-cache.ts into index.ts in this PR.
    // This anchors the value so accidental changes are caught.
    expect(VIDEO_META_CACHE_TTL_SECONDS).toBe(60);
  });
});
