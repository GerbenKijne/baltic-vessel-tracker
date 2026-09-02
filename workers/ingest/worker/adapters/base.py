"""Provider adapter interface (PRD SS8, SS12).

Every adapter yields raw, untrusted dicts shaped like the provider's wire
format. The parser (worker/normalize.py) is the only place a raw payload is
turned into a CanonicalAisObservation — an adapter must never construct one
directly, and the rest of the pipeline never sees a provider payload.
"""
from __future__ import annotations

import abc
from collections.abc import AsyncIterator


class Adapter(abc.ABC):
    source: str

    @abc.abstractmethod
    def stream(self) -> AsyncIterator[dict]:
        """Yield raw provider messages until the adapter is stopped or fails."""
        raise NotImplementedError
