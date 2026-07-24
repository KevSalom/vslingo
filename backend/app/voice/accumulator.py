"""Sentence accumulator for breaking streaming assistant deltas into TTS sentence chunks."""

import re

ABBREVIATIONS = re.compile(
    r"\b(?:Mr|Mrs|Ms|Dr|e\.g|i\.e|vs)\.$",
    re.IGNORECASE,
)
DECIMAL_PATTERN = re.compile(r"\d\.\d$")


class SentenceAccumulator:
    """Accumulates text deltas and yields TTS-ready sentence chunks deterministically."""

    def __init__(self) -> None:
        self._buffer: str = ""

    def feed(self, delta: str) -> list[str]:
        self._buffer += delta
        segments: list[str] = []

        while True:
            match = self._find_next_cut()
            if match is None:
                break
            cut_idx = match
            segment = self._buffer[:cut_idx].strip()
            self._buffer = self._buffer[cut_idx:].lstrip()
            if segment:
                segments.append(segment)

        return segments

    def _find_next_cut(self) -> int | None:
        # When the buffer is over the limit, punctuation beyond 240 cannot bypass
        # the deterministic forced cut.
        scan_end = min(len(self._buffer) - 1, 240 if len(self._buffer) > 240 else len(self._buffer))
        for i in range(scan_end):
            char = self._buffer[i]
            next_char = self._buffer[i + 1]

            if char in ".?!" and next_char.isspace():
                prefix = self._buffer[: i + 1]
                if DECIMAL_PATTERN.search(prefix):
                    continue
                if ABBREVIATIONS.search(prefix):
                    continue
                return i + 1

        if len(self._buffer) > 240:
            for index in range(239, 159, -1):
                if self._buffer[index].isspace():
                    return index + 1
            return 240

        return None

    def flush(self) -> list[str]:
        final_seg = self._buffer.strip()
        self._buffer = ""
        if final_seg:
            return [final_seg]
        return []
