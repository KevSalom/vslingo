import type { TranscriptResponse } from './types';

export const SAMPLE_VIDEO_TITLE = 'Neural networks, visually explained';
export const SAMPLE_VIDEO_URL = 'https://www.youtube.com/watch?v=aircAruvnKk';

/**
 * A short, authored study fixture for the technical sample. It is bundled with
 * the client so the complete transcript workflow remains available offline.
 */
export const SAMPLE_TRANSCRIPT: TranscriptResponse = {
  video_id: 'aircAruvnKk',
  source: 'fixture',
  segments: [
    {
      text: 'A neural network receives numbers as input.',
      start: 0,
      duration: 5.5,
    },
    {
      text: 'Its layers transform those values into progressively richer patterns.',
      start: 5.5,
      duration: 7,
    },
    {
      text: 'Each connection carries a weight that changes the strength of a signal.',
      start: 12.5,
      duration: 7.5,
    },
    {
      text: 'Training adjusts the weights so useful outputs become more likely.',
      start: 20,
      duration: 7,
    },
    {
      text: 'An activation represents how strongly one neuron responds to a pattern.',
      start: 27,
      duration: 8,
    },
    {
      text: 'The final layer turns those activations into a prediction.',
      start: 35,
      duration: 7,
    },
  ],
};
