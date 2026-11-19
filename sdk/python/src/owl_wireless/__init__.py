"""OWL (Open Wireless Learning) Python client.

    import owl_wireless as owl
    ds = owl.dataset("ujiindoorloc")
    split = ds.load()
    owl.paper("P62").baseline
"""
from ._version import __version__
from .data import Split
from .datasets import Dataset, DatasetInfo, ReleaseFile, ReleaseInfo, dataset, datasets
from .errors import (
    Ambiguous,
    AuthenticationRequired,
    ChecksumMismatch,
    DatasetNotReleased,
    NotFound,
    NotReproduced,
    OWLError,
    ScoringError,
    ServiceError,
)
from .papers import Artifact, ArtifactFile, Baseline, Claim, Detail, Paper, PaperInfo, paper
from .scoring import ScoreResult, score

__all__ = [
    "__version__", "datasets", "dataset", "paper", "score",
    "Dataset", "DatasetInfo", "ReleaseInfo", "ReleaseFile", "Split",
    "Paper", "PaperInfo", "Detail", "Claim", "Baseline", "Artifact", "ArtifactFile", "ScoreResult",
    "OWLError", "NotFound", "Ambiguous", "DatasetNotReleased", "ChecksumMismatch", "NotReproduced",
    "AuthenticationRequired", "ScoringError", "ServiceError",
]
