import { expect, test } from 'vitest';
import { AUDIO_BOARD, HARDWARE, WAVESHARE, type ReleasePin } from '../../installer/release.ts';
import { guideSpeakers } from '../../site/getting-started.ts';

test('a missing profile stays unavailable alongside other speakers with published pins', () => {
  const release = {
    tag: 'v0.11.0',
    manifestSha256: 'a'.repeat(64),
    mediaReviewed: true,
    hardwareQualified: true,
  } satisfies ReleasePin;
  const speakers = guideSpeakers({ release, hardwareReleases: { [WAVESHARE]: release } });
  expect(speakers.map(({ hardware, releaseTag }) => [hardware, releaseTag])).toEqual([
    [AUDIO_BOARD, null],
    [WAVESHARE, 'v0.11.0'],
    [HARDWARE, 'v0.11.0'],
  ]);
});
