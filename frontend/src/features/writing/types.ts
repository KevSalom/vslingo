export const MAX_CORRECTION_TEXT_LENGTH = 1000;

export type CorrectionCategory = 'grammar' | 'spelling' | 'punctuation' | 'style';

export type Correction = {
  original: string;
  corrected: string;
  explanation: string;
  category: CorrectionCategory;
};

export type CorrectionResponse = {
  original_text: string;
  corrected_text: string;
  has_corrections: boolean;
  corrections: Correction[];
  general_feedback: string;
};

export type WritingErrorCode =
  | 'empty_text'
  | 'text_too_long'
  | 'provider_not_configured'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'invalid_provider_response'
  | 'invalid_request'
  | 'invalid_response'
  | 'network_error'
  | 'request_failed';

const CORRECTION_CATEGORIES: ReadonlySet<string> = new Set([
  'grammar',
  'spelling',
  'punctuation',
  'style',
]);

export function isCorrectionResponse(value: unknown): value is CorrectionResponse {
  if (!isRecord(value) || !Array.isArray(value.corrections)) {
    return false;
  }

  const originalText = value.original_text;
  const correctedText = value.corrected_text;
  const hasCorrections = value.has_corrections;
  const corrections = value.corrections;
  const generalFeedback = value.general_feedback;

  if (
    !isNonEmptyString(originalText) ||
    originalText.length > MAX_CORRECTION_TEXT_LENGTH ||
    !isNonEmptyString(correctedText) ||
    typeof hasCorrections !== 'boolean' ||
    !corrections.every(isCorrection) ||
    !isNonEmptyString(generalFeedback)
  ) {
    return false;
  }

  if (hasCorrections !== (corrections.length > 0)) {
    return false;
  }

  return hasCorrections
    ? correctedText !== originalText
    : correctedText === originalText;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCorrection(value: unknown): value is Correction {
  return (
    isRecord(value) &&
    isNonEmptyString(value.original) &&
    isNonEmptyString(value.corrected) &&
    isNonEmptyString(value.explanation) &&
    typeof value.category === 'string' &&
    CORRECTION_CATEGORIES.has(value.category)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
