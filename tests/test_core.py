import numpy as np
import pytest
import soundfile as sf
import mido

from notefall.core import cache, postprocess
from notefall.core.models import Note
from notefall.core.transcribers import midi_file
from notefall.ui.key_state import KeyState
from notefall.ui.piano_geometry import key_rect


def test_geometry():
    assert key_rect(21, 52) == (0, 1)                      # A0: first white key
    assert key_rect(108, 52)[0] == 51                       # C8: last white key
    x, w = key_rect(22, 52)                                 # A#0 sits on the A|B boundary
    assert abs(x + w / 2 - 1) < 1e-9 and w < 1


def test_key_state():
    ks = KeyState([Note(60, 1.0, 1.0, 100)])
    assert ks.at(0.9) == {}
    assert ks.at(1.02)[60][0] == pytest.approx(0.5)
    assert ks.at(1.5)[60][0] == 1.0
    assert 0 < ks.at(2.06)[60][0] < 1.0                     # releasing
    assert ks.at(2.2) == {}


def test_postprocess():
    out = postprocess.clean([
        Note(60, 0, 0.5, 80), Note(60, 0.51, 0.5, 90),      # merge
        Note(62, 0, 0.01, 80),                              # too short
        Note(64, 0, 1, 5),                                  # too weak
        Note(10, 0, 1, 80),                                 # out of range
    ])
    assert out == [Note(60, 0, 1.01, 90)]


def test_midi_and_cache(tmp_path):
    mid = mido.MidiFile(ticks_per_beat=480)
    tr = mido.MidiTrack(); mid.tracks.append(tr)
    tr.append(mido.Message("note_on", note=60, velocity=90, time=0))
    tr.append(mido.Message("note_off", note=60, time=480))  # 1 beat @120bpm = 0.5s
    path = str(tmp_path / "a.mid"); mid.save(path)
    notes = midi_file.transcribe(path)
    assert notes == [Note(60, 0.0, 0.5, 90)]
    assert cache.load(path) is None
    cache.save(path, notes)
    assert cache.load(path) == notes


@pytest.mark.slow
def test_basic_pitch_synthetic(tmp_path):
    from notefall.core.transcribers import basic_pitch
    sr, truth = 22050, [(69, 0.5), (72, 1.5), (76, 2.5)]    # A4, C5, E5, 0.8s each
    y = np.zeros(sr * 4, dtype=np.float32)
    for pitch, s in truth:
        f = 440 * 2 ** ((pitch - 69) / 12)
        t = np.arange(int(0.8 * sr)) / sr
        i = int(s * sr)
        y[i:i + len(t)] += 0.5 * np.sin(2 * np.pi * f * t) * np.exp(-1.5 * t)
    path = str(tmp_path / "t.wav"); sf.write(path, y, sr)
    notes = postprocess.clean(basic_pitch.transcribe(path))
    for pitch, s in truth:
        near = [n for n in notes if n.pitch == pitch and abs(n.start - s) < 0.05]
        assert near, f"missing {pitch}@{s}: {notes}"
