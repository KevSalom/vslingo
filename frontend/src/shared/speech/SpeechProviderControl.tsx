import type { SpeechProvider } from './types';

type SpeechProviderControlProps = {
  provider: SpeechProvider;
  onChange: (provider: SpeechProvider) => void;
  disabled?: boolean;
  id?: string;
};

export function SpeechProviderControl({
  provider,
  onChange,
  disabled = false,
  id = 'speech-provider-select',
}: SpeechProviderControlProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-slate-300">
        Proveedor de voz
      </label>
      <select
        id={id}
        value={provider}
        onChange={(e) => onChange(e.target.value as SpeechProvider)}
        disabled={disabled}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 outline-none transition-colors hover:border-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="aws_polly">AWS Polly Neural</option>
        <option value="edge_tts">Microsoft Edge Neural</option>
      </select>
    </div>
  );
}
