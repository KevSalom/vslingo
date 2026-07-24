"""In-memory request, connection, and provider-concurrency protections for one app process."""

import asyncio
from collections import deque
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from math import ceil
from time import monotonic


class ProviderBusyError(RuntimeError):
    """Raised when a bounded provider semaphore cannot be acquired promptly."""


@dataclass(frozen=True, slots=True)
class RateDecision:
    """Result of a deterministic sliding-window admission check."""

    allowed: bool
    retry_after_seconds: int = 0


class SlidingWindowLimiter:
    """Bounded per-key sliding-window limiter with an injectable monotonic clock."""

    def __init__(
        self,
        *,
        clock: Callable[[], float] = monotonic,
        window_seconds: float = 60.0,
    ) -> None:
        self._clock = clock
        self._window_seconds = window_seconds
        self._buckets: dict[str, deque[float]] = {}

    def check(self, key: str, limit: int) -> RateDecision:
        """Consume one slot or return a whole-second retry delay without trusting headers."""

        now = self._clock()
        self._prune(now)
        bucket = self._buckets.setdefault(key, deque())
        if len(bucket) >= limit:
            retry_after = max(1, ceil(self._window_seconds - (now - bucket[0])))
            return RateDecision(False, retry_after)
        bucket.append(now)
        return RateDecision(True)

    def _prune(self, now: float) -> None:
        expired = now - self._window_seconds
        for key, bucket in list(self._buckets.items()):
            while bucket and bucket[0] <= expired:
                bucket.popleft()
            if not bucket:
                del self._buckets[key]


class RequestLimiter:
    """Coordinate the global costly HTTP and WebSocket opening budgets by peer IP."""

    def __init__(
        self,
        *,
        max_http_requests_per_minute: int,
        max_speech_requests_per_minute: int,
        limiter: SlidingWindowLimiter | None = None,
    ) -> None:
        self._max_http = max_http_requests_per_minute
        self._max_speech = max_speech_requests_per_minute
        self._limiter = limiter or SlidingWindowLimiter()

    def check_http(self, peer_ip: str, *, speech: bool) -> RateDecision:
        """Apply the shared costly-endpoint budget and speech's stricter budget."""

        global_decision = self._limiter.check(f"http:{peer_ip}", self._max_http)
        if not global_decision.allowed:
            return global_decision
        if speech:
            return self._limiter.check(f"speech:{peer_ip}", self._max_speech)
        return RateDecision(True)

    def check_websocket(self, peer_ip: str) -> RateDecision:
        """Count each WebSocket opening against the same global costly budget."""

        return self._limiter.check(f"http:{peer_ip}", self._max_http)


class ConnectionLimiter:
    """Bound concurrent WebSocket connections globally and for one direct peer IP."""

    def __init__(
        self,
        *,
        max_connections: int,
        max_connections_per_ip: int,
        request_limiter: RequestLimiter,
    ) -> None:
        self._max_connections = max_connections
        self._max_connections_per_ip = max_connections_per_ip
        self._request_limiter = request_limiter
        self._total = 0
        self._by_ip: dict[str, int] = {}

    def try_open(self, peer_ip: str) -> bool:
        """Reserve a connection only if its rate and both count limits permit it."""

        if not self._request_limiter.check_websocket(peer_ip).allowed:
            return False
        if self._total >= self._max_connections:
            return False
        if self._by_ip.get(peer_ip, 0) >= self._max_connections_per_ip:
            return False
        self._total += 1
        self._by_ip[peer_ip] = self._by_ip.get(peer_ip, 0) + 1
        return True

    def release(self, peer_ip: str) -> None:
        """Release exactly one admitted connection and prune empty IP counters."""

        active = self._by_ip.get(peer_ip, 0)
        if active <= 0:
            return
        self._total -= 1
        if active == 1:
            del self._by_ip[peer_ip]
        else:
            self._by_ip[peer_ip] = active - 1


class ProviderGate:
    """A bounded, cancellation-safe semaphore for one expensive provider class."""

    def __init__(self, permits: int, *, acquire_timeout_seconds: float) -> None:
        self._semaphore = asyncio.Semaphore(permits)
        self._acquire_timeout_seconds = acquire_timeout_seconds

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        """Acquire one slot promptly and always release it, including cancellation."""

        acquired = False
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self._acquire_timeout_seconds)
            acquired = True
            yield
        except TimeoutError as exc:
            raise ProviderBusyError from exc
        finally:
            if acquired:
                self._semaphore.release()


@dataclass(frozen=True, slots=True)
class ProviderGates:
    """App-scoped gates injected into services and each VoiceSession."""

    stt: ProviderGate
    llm: ProviderGate
    tts: ProviderGate
    video: ProviderGate
