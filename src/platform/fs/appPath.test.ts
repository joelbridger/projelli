import { describe, it, expect } from 'vitest';
import { pathsEqual, sameOrInside, relativeInside, topLevelSegment, collapseDotSegments } from './appPath';

describe('appPath dot-segment resolution', () => {
  it('relativeInside refuses a dot-segment escape disguised as a nested path (POSIX)', () => {
    // Before the fix this returned '../Other' — a pure string prefix match
    // treated '/ws/../Other' as inside '/ws' even though it denotes '/Other'.
    expect(relativeInside('/home/jane/WS', '/home/jane/WS/../Other')).toBeNull();
  });

  it('relativeInside refuses a dot-segment escape disguised as a nested path (Windows)', () => {
    expect(relativeInside('C:\\WS', 'C:\\WS\\..\\Other')).toBeNull();
  });

  it('relativeInside still resolves a legitimate nested path containing a harmless ./ segment', () => {
    expect(relativeInside('/ws', '/ws/./Clients/Acme')).toBe('Clients/Acme');
  });

  it('relativeInside resolves a path that dips into a subfolder and back out, staying inside root', () => {
    expect(relativeInside('/ws', '/ws/Clients/Acme/../Beta')).toBe('Clients/Beta');
  });

  it('sameOrInside is false for a dot-segment escape', () => {
    expect(sameOrInside('/ws', '/ws/../etc/passwd')).toBe(false);
  });

  it('pathsEqual resolves dot segments before comparing', () => {
    expect(pathsEqual('/ws/Clients/Acme', '/ws/Clients/Beta/../Acme')).toBe(true);
  });

  it('topLevelSegment returns null for a dot-segment escape', () => {
    expect(topLevelSegment('/ws', '/ws/Clients/../../etc')).toBeNull();
  });

  it('resolves a UNC child path without mangling the share name', () => {
    expect(relativeInside('//srv/share/ws', '//srv/share/ws/Clients/Acme')).toBe('Clients/Acme');
  });

  it('round-trips a bare UNC share root unchanged', () => {
    expect(pathsEqual('//srv/share', '//srv/share')).toBe(true);
    expect(sameOrInside('//srv/share', '//srv/share/ws')).toBe(true);
  });

  it('an absolute path cannot climb above a rooted root via excess ..', () => {
    // '/ws/../../etc' still starts, after clamping, at '/etc' — outside '/ws'.
    expect(relativeInside('/ws', '/ws/../../etc')).toBeNull();
  });

  describe('collapseDotSegments', () => {
    it('resolves a harmless nested ../ pair', () => {
      expect(collapseDotSegments('Clients/Acme/../Beta')).toBe('Clients/Beta');
    });

    it('leaves a leading .. in place for a relative path that climbs past its own start', () => {
      expect(collapseDotSegments('../../etc/passwd')).toBe('../../etc/passwd');
    });

    it('clamps a rooted path at its own root instead of leaving stray ..', () => {
      expect(collapseDotSegments('/ws/../../etc')).toBe('/etc');
    });
  });
});
