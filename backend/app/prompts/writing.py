"""Prompt contract and few-shot messages for Writing Studio corrections."""

import json
from typing import Final, Literal, TypedDict


class WritingPromptMessage(TypedDict):
    """One provider-neutral chat message used by the Writing adapter."""

    role: Literal["system", "user", "assistant"]
    content: str


WRITING_SYSTEM_PROMPT: Final = """
You are VSLingo's English writing coach for Spanish-speaking software developers.
Review the user's English at B1-B2 level using natural American English.

For every change:
- preserve the submitted text exactly in original_text;
- return a complete, natural corrected_text in English;
- classify each change as grammar, spelling, punctuation, or style;
- explain each change clearly and briefly in Spanish;
- give concise general_feedback in Spanish, including what was done well.

Do not invent technical facts or change the user's intended meaning. Treat common,
grammatically correct contractions as natural English. If the text is already correct,
return it unchanged, set has_corrections to false, and return an empty corrections list.
Return only the JSON object. Do not wrap it in Markdown or add commentary.
""".strip()

WRITING_SCHEMA_TEMPLATE: Final = """
The response must contain exactly this structure:
{
  "original_text": "the exact English text submitted by the user",
  "corrected_text": "the complete corrected English text",
  "has_corrections": true or false,
  "corrections": [
    {
      "original": "the original word or phrase",
      "corrected": "the corrected word or phrase",
      "explanation": "a brief explanation in Spanish",
      "category": "grammar" or "spelling" or "punctuation" or "style"
    }
  ],
  "general_feedback": "brief, encouraging feedback in Spanish"
}
All fields are required. has_corrections must be true exactly when corrections is non-empty.
When has_corrections is false, corrected_text must equal original_text exactly.
""".strip()

WRITING_FEW_SHOT_USER_WITH_ERRORS: Final = (
    "I am agree with you, but she don't write very good."
)
WRITING_FEW_SHOT_ASSISTANT_WITH_ERRORS: Final[dict[str, object]] = {
    "original_text": "I am agree with you, but she don't write very good.",
    "corrected_text": "I agree with you, but she doesn't write very well.",
    "has_corrections": True,
    "corrections": [
        {
            "original": "am agree",
            "corrected": "agree",
            "explanation": (
                "En inglés, 'agree' es un verbo y no requiere el auxiliar 'am'. "
                "Decimos 'I agree' directamente."
            ),
            "category": "grammar",
        },
        {
            "original": "don't",
            "corrected": "doesn't",
            "explanation": (
                "Con la tercera persona del singular usamos el auxiliar negativo "
                "'doesn't'."
            ),
            "category": "grammar",
        },
        {
            "original": "good",
            "corrected": "well",
            "explanation": (
                "Para describir cómo se realiza una acción usamos el adverbio "
                "'well' en lugar del adjetivo 'good'."
            ),
            "category": "style",
        },
    ],
    "general_feedback": (
        "Buen intento: la idea se entiende. Revisa la tercera persona del singular "
        "y el uso de adverbios para describir acciones."
    ),
}

WRITING_FEW_SHOT_USER_CORRECT: Final = (
    "She has been working as a software engineer for five years."
)
WRITING_FEW_SHOT_ASSISTANT_CORRECT: Final[dict[str, object]] = {
    "original_text": "She has been working as a software engineer for five years.",
    "corrected_text": "She has been working as a software engineer for five years.",
    "has_corrections": False,
    "corrections": [],
    "general_feedback": (
        "La oración es gramaticalmente correcta, clara y natural. Buen trabajo."
    ),
}


def build_writing_messages(text: str) -> list[WritingPromptMessage]:
    """Build the system, few-shot and final user turns in provider order."""

    return [
        {
            "role": "system",
            "content": f"{WRITING_SYSTEM_PROMPT}\n\n{WRITING_SCHEMA_TEMPLATE}",
        },
        {"role": "user", "content": WRITING_FEW_SHOT_USER_WITH_ERRORS},
        {
            "role": "assistant",
            "content": json.dumps(
                WRITING_FEW_SHOT_ASSISTANT_WITH_ERRORS,
                ensure_ascii=False,
            ),
        },
        {"role": "user", "content": WRITING_FEW_SHOT_USER_CORRECT},
        {
            "role": "assistant",
            "content": json.dumps(
                WRITING_FEW_SHOT_ASSISTANT_CORRECT,
                ensure_ascii=False,
            ),
        },
        {"role": "user", "content": text},
    ]
