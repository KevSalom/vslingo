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
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-slate-300">
        Proveedor de voz
      </label>
      <select
        id={id}
        value={provider}
        onChange={(e) => onChange(e.target.value as SpeechProvider)}
        disabled={disabled}
        className="h-[2.15rem] rounded border border-[#3b4d60] bg-[#18212c] px-3 text-[0.82rem] font-medium text-[#f1f5f9] outline-none transition-colors hover:border-slate-500 focus:border-[#22d3ee] focus:ring-1 focus:ring-[#22d3ee] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="aws_polly" className="bg-[#18212c] text-[#f1f5f9]">
          AWS Polly Neural
        </option>
        <option value="edge_tts" className="bg-[#18212c] text-[#f1f5f9]">
          Microsoft Edge Neural
        </option>
      </select>
    </div>
  );
}
