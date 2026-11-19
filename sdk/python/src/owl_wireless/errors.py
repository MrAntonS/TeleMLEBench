"""Exceptions raised by the OWL client."""
from __future__ import annotations

from typing import Optional


class OWLError(Exception):
    """Base class for every error raised by ``owl``."""


class NotFound(OWLError, LookupError):
    """No dataset or paper matches the given identifier."""


class Ambiguous(OWLError, LookupError):
    """The identifier matches more than one record."""


class DatasetNotReleased(OWLError):
    """OWL does not redistribute this dataset; get it from the provider."""

    def __init__(self, message: str, provider_url: Optional[str] = None):
        super().__init__(message)
        self.provider_url = provider_url


class ChecksumMismatch(OWLError):
    """A downloaded file does not match the SHA-256 in the release manifest."""

    def __init__(self, path: str, expected: str, actual: str, message: Optional[str] = None):
        super().__init__(message or (
            f"SHA-256 mismatch for {path}: manifest says {expected}, got {actual}. "
            "The partial file was deleted; retry the download."
        ))
        self.path = path
        self.expected = expected
        self.actual = actual


class NotReproduced(OWLError):
    """The paper has no validated OWL reproduction, so there is no baseline or artifact."""


class AuthenticationRequired(OWLError):
    """Server-side scoring needs an evaluation token (``OWL_TOKEN``)."""


class ScoringError(OWLError):
    """The evaluator rejected the predictions or failed."""

    def __init__(self, message: str, code: Optional[str] = None, row_number: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.row_number = row_number


class ServiceError(OWLError):
    """An OWL endpoint returned an unexpected response."""
