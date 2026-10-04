"""Tests for the embedding chunking helper."""
import unittest.mock

from src import pipeline


def test_short_text_single_chunk():
    chunks = pipeline._chunk_text("hello world")
    assert len(chunks) == 1
    assert chunks[0] == "hello world"


def test_empty_text_no_chunks():
    assert pipeline._chunk_text("") == []
    assert pipeline._chunk_text("   \n\n  ") == []


def test_long_text_overlapping_chunks():
    text = " ".join(f"word{i}" for i in range(1000))
    chunks = pipeline._chunk_text(text, chunk_words=200, overlap=40)
    assert len(chunks) > 1
    # Chunks must overlap by ~40 words
    first_words = set(chunks[0].split())
    second_words = set(chunks[1].split())
    overlap = first_words & second_words
    assert len(overlap) >= 30  # allow some tolerance


def test_encode_long_text_returns_vector():
    """encode_long_text should return a list of floats with expected dim."""
    # test_api.py mocks sentence_transformers in sys.modules to avoid protobuf
    # init cost; restore the real module here so we can actually encode text.
    import importlib
    import sys
    if isinstance(sys.modules.get("sentence_transformers"), unittest.mock.MagicMock):
        for k in [k for k in list(sys.modules) if k.startswith("sentence_transformers")]:
            del sys.modules[k]
        import sentence_transformers  # real module
    from src import pipeline
    pipeline._embedding_model = None
    vec = pipeline.encode_long_text("hello world this is a test")
    assert isinstance(vec, list)
    assert all(isinstance(x, float) for x in vec)
    # all-MiniLM-L6-v2 produces 384-dim vectors
    assert len(vec) == 384
