# NoteFall

Turn piano sheet music into **crystal notes falling onto the right keys**, compose like in MuseScore, then export a video. Runs on Mac, Windows and iPad.

**Try it in the browser: https://fonghtdev.github.io/NoteFall/** (on an iPad: open it in Safari, then Share > Add to Home Screen).

## Features

- **Falling notes**: open a sheet-music PDF, MIDI, MP3, WAV or FLAC; notes fall onto the 88 keys and each key presses and lights up when a note lands. Three looks: Black, Crystal, Your photo.
- **Composer**: a two-staff score editor with voices, chords, grace notes, arpeggios, tremolo, key and time signatures, tempo, repeats and endings. Drag, copy and paste like in an office app, zoom with auto-fit, and bars widen themselves when notes crowd. Open a sheet-music PDF to edit it; save MusicXML, MIDI or PDF.
- **Sound**: a modelled grand piano (string resonance, soundboard, reverb), SoundFont (.sf2) libraries (load your own, or download the free GeneralUser GS from the *Thư viện đàn* dialog) and a metronome that follows the piece's meter.
- **Video export**: mp4 (H.264 + AAC) at 720p or 1080p, rendered frame by frame so it is smooth on any machine; the metronome is never in the video.
- **iPad**: full touch support (tap, drag, pinch to zoom, up / down / delete keys).

## Install

Download an installer from [Releases](https://github.com/fonghtdev/NoteFall/releases): `.dmg` for Mac (Intel and Apple Silicon), `Setup.exe` for Windows.

The Mac build is not notarized: the first time, right-click the app and choose Open.

## Run from source

In `app/` (Node 20 or newer; developed on the version below):

```
npm install
npm start          # build and open Electron
npm test           # vitest
npm run dist       # Mac + Windows installers into release/
```

Tests that drive the real app (Electron, controlled by environment variables):

```
NOTEFALL_SELFTEST=1 NOTEFALL_COMPOSE=1 npx electron .                      # composer (modes: falling, pdf, showcase, palette, voices)
NOTEFALL_SELFTEST=1 NOTEFALL_FILE=song.pdf NOTEFALL_EDIT=1 npx electron .  # open one file in the composer
```

## iPad

The Capacitor project is in `app/ios` (iPad only, iOS 16 or newer).

```
cd app && npx vite build && npx cap sync ios
open ios/App/App.xcodeproj
```

In Xcode: pick the *App* target, Signing & Capabilities, sign in with an Apple ID (a free account is enough to run on your own iPad), choose the device and press Run. TestFlight and the App Store need a paid Apple Developer account.

## Web (Safari / any browser)

`npm run build` in `app/` also produces a web app in `app/dist` (manifest, icons, offline cache). It is published to GitHub Pages automatically on every push to `main` (`.github/workflows/pages.yml`). To host it elsewhere, serve that folder over HTTPS from any static host; on an iPad open the link in Safari and choose Share > Add to Home Screen. After the first load it works offline. No Apple account or app review needed, and a redeploy updates everyone.

## Layout

```
app/
  main.js, preload.cjs     Electron (app:// protocol, macOS menu)
  src/core/                synth, metronome, beats, sheet-music PDF reader (omr, smufl, playback, realize)
  src/editor/              composer: model, render (VexFlow), composer, io (MusicXML / PDF / MIDI)
  src/ui/                  falling-notes view, glass shader, CSS tokens, save / share
  ios/                     iOS project (Capacitor)
projectspec.md             original spec (the Python version, replaced by the Electron app)
CLAUDE.md                  notes for Claude Code: commands, conventions, decisions
```

`requirements.txt`, `pytest.ini` and `tests/` belong to the old Python version and are not used by the current app.

## Known limits

- The piano tone cannot match a real instrument without a recording of it.
- Reading a sheet-music PDF is recognition: it can be wrong on very complex scores; a bar that does not add up to the right number of beats is flagged. It reads PDFs that hold the notation as vector drawing (MuseScore, LilyPond / Mutopia). A scan or a photo has no notes inside to read, and the app says so; PDFs from other engravers (Sibelius, Finale, Dorico) are untested.

## A scanned PDF

Run an optical music recognition tool once, then open its MusicXML in NoteFall (Composer > Open):

1. Download [Audiveris](https://github.com/Audiveris/audiveris/releases) (free, Mac / Windows / Linux).
2. `Audiveris -batch -transcribe -export -output out "score.pdf"` (or open the PDF in its window and use Book > Export).
3. Open the `.mxl` / `.xml` files it writes (one per movement). Expect to fix rhythms by hand on dense pages: a 18-page Beethoven sonata scan took about 4 minutes and came out right in key, time signature and bar count, with some rhythm errors.
- Not tried on real hardware: the Windows and Intel Mac installers; on a real iPad, sound, video export, file sharing and performance are unchecked.
