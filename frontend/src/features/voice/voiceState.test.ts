import { beforeEach, describe, expect, it } from 'vitest';
import {
  SCENARIO_LABELS,
  VOICE_STORAGE_KEY,
  createInitialVoiceState,
  loadVoicePreferences,
  saveVoicePreferences,
} from './voiceState';

describe('VoiceState and Preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default scenario daily_standup when localStorage is empty', () => {
    expect(loadVoicePreferences()).toBe('daily_standup');
  });

  it('saves and loads preferred scenario from localStorage', () => {
    saveVoicePreferences('system_design');
    expect(loadVoicePreferences()).toBe('system_design');
  });

  it('ignores corrupted localStorage data and returns default', () => {
    localStorage.setItem(VOICE_STORAGE_KEY, 'invalid json');
    expect(loadVoicePreferences()).toBe('daily_standup');
  });

  it('creates initial voice state using stored preference', () => {
    saveVoicePreferences('salary_negotiation');
    const state = createInitialVoiceState();
    expect(state.scenario).toBe('salary_negotiation');
    expect(state.turnHistory).toEqual([]);
    expect(state.activeTurn).toBeNull();
  });

  it('contains labels for all four scenarios', () => {
    expect(Object.keys(SCENARIO_LABELS)).toHaveLength(4);
    expect(SCENARIO_LABELS.free).toBe('Libre / Explorar');
  });
});
