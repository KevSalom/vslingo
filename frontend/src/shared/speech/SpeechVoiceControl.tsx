import type { EdgeVoiceId } from './types';
import { EDGE_VOICES } from './voiceCatalog';

type SpeechVoiceControlProps = {
  voice: EdgeVoiceId;
  onChange: (voice: EdgeVoiceId) => void;
  disabled?: boolean;
  id?: string;
};

export function SpeechVoiceControl({
  voice,
  onChange,
  disabled = false,
  id = 'speech-voice-select',
}: SpeechVoiceControlProps) {
  return (
    <div className="speech-voice-control">
      <label htmlFor={id}>Voz</label>
      <select
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value as EdgeVoiceId)}
        value={voice}
      >
        {EDGE_VOICES.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
    </div>
  );
}
