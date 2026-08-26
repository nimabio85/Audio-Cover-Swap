# CoverSwap

CoverSwap is a Windows desktop app for replacing album artwork, editing common
audio tags, and converting audio or video media into verified audio files. It
runs locally; your media is not uploaded anywhere.

## Safety first

CoverSwap never edits an original audio stream in place. Before an edit it:

1. fully decodes the original audio;
2. writes the change to a temporary file beside the original;
3. fully decodes the result;
4. atomically swaps the verified result into place;
5. restores the untouched original if the swap or final verification fails.

Conversions are also fully decoded before they are finalized, and existing
destination files are never overwritten. A corrupt or unsupported source is
reported as an error and left unchanged.

No program can promise support for literally every audio codec or repair an
already-damaged source. The table below is the tested release contract.

## Format support

| Operation | Tested formats |
| --- | --- |
| Replace cover art | MP3, WAV/WAVE, FLAC, M4A, M4B |
| Edit text metadata | MP3, WAV/WAVE, FLAC, M4A, M4B, OGG/OGA, Opus, WMA, AIFF/AIF, WavPack |
| Conversion output | MP3, WAV, FLAC, M4A/AAC, OGG Vorbis, raw AAC, Opus |
| Conversion input | Any scanned audio/video file that the bundled FFmpeg build can decode |

Additional recognized audio inputs include AAC, AMR, AC-3/E-AC-3, RealAudio,
APE, TTA, DSF/DFF, Musepack, AU/SND, CAF, VOC, W64/RF64, 8SVX, and Speex.
Formats that cannot safely store embedded artwork are clearly labeled `Tags
only` or `Convert only` in the app instead of being modified optimistically.

## Install on Windows

Download either the installer or portable `.exe` from the repository's
Releases page. Windows 10 and Windows 11 (64-bit) are the supported targets.

The downloadable app bundles FFmpeg and does not require Node.js.

## Development

Requirements: Node.js 22 or newer and Windows.

```powershell
npm ci
npm run check
npm start
```

Run the browser-hosted development mode with `npm run start:web`. Build the
Windows installer and portable executable with:

```powershell
npm run dist
```

Artifacts are written to `release/`.

## Release verification

Before v1.0.0 was published, its audio pipeline passed 24 generated-fixture
checks covering every advertised conversion output, every cover-writable
format, the metadata container matrix, collision handling, full decode
verification, and byte-for-byte preservation of rejected corrupt inputs.

## License

MIT. FFmpeg and packaged dependencies retain their own licenses.
