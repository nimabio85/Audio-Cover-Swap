const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const multer = require('multer');
const NodeID3 = require('node-id3');
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const PORT = DEFAULT_PORT;
const HOST = '127.0.0.1';

// Get the bundled ffmpeg binary path
const bundledFFmpegPath = require('ffmpeg-static');
const ffmpegPath = process.resourcesPath && bundledFFmpegPath.includes('app.asar')
  ? bundledFFmpegPath.replace('app.asar', 'app.asar.unpacked')
  : bundledFFmpegPath;

// Multer setup for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, BMP, GIF) are allowed'));
    }
  }
});

app.use(express.json());
app.use((req, res, next) => {
  const host = req.get('host') || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
    return res.status(403).json({ error: 'Local access only' });
  }
  const origin = req.get('origin');
  if (origin && origin !== `http://${host}`) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const HIDDEN_BROWSER_DIRECTORIES = new Set([
  '$recycle.bin',
  '$windows.~bt',
  '$windows.~ws',
  'recovery',
  'system volume information',
]);

// Supported audio & video container extensions — ALL are writable via ffmpeg
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.aac', '.ogg', '.oga', '.opus', '.wma', '.m4a', '.m4b',
  '.amr', '.ac3', '.eac3', '.ra', '.weba', '.flac', '.wav', '.wave',
  '.aiff', '.aif', '.ape', '.wv', '.tta', '.dsf', '.dff', '.mpc',
  '.au', '.snd', '.caf', '.voc', '.w64', '.rf64', '.8svx', '.spx'
]);

// Non-audio / video media extensions that can be converted to audio files
const NON_AUDIO_MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mkv', '.mov', '.avi', '.webm', '.flv', '.wmv',
  '.ts', '.3gp', '.3gpp', '.mpg', '.mpeg', '.m2ts', '.vob', '.ogv',
  '.rm', '.rmvb', '.divx', '.asf', '.f4v', '.ogm', '.m2t', '.mts',
  '.dv', '.mxf', '.3g2', '.m2v', '.mpv'
]);

// Formats for which this app has a tested, lossless metadata/cover write path.
// Other decodable formats remain available as conversion inputs.
const COVER_WRITABLE_EXTENSIONS = new Set([
  '.mp3', '.wav', '.wave', '.flac', '.m4a', '.m4b'
]);
const METADATA_WRITABLE_EXTENSIONS = new Set([
  '.mp3', '.wav', '.wave', '.flac', '.m4a', '.m4b', '.ogg', '.oga',
  '.opus', '.wma', '.aiff', '.aif', '.wv'
]);

/**
 * Dynamically import music-metadata (ESM module)
 */
let musicMetadata = null;
async function getMusicMetadata() {
  if (!musicMetadata) {
    musicMetadata = await import('music-metadata');
  }
  return musicMetadata;
}

/**
 * Generate a temp file path in system temp dir
 */
function tempFile(ext) {
  return path.join(os.tmpdir(), `coverswap_${crypto.randomBytes(8).toString('hex')}${ext}`);
}

/**
 * FFmpeg chooses its muxer from the file extension, so work files keep the
 * original extension. Keeping them beside the destination also makes the
 * final rename an atomic same-volume operation.
 */
function siblingTempFile(targetPath, label = 'working') {
  const parsed = path.parse(targetPath);
  return path.join(parsed.dir, `.${parsed.name}.coverswap-${label}-${crypto.randomBytes(8).toString('hex')}${parsed.ext}`);
}

async function runFFmpeg(args, timeout = 120000) {
  return execFileAsync(ffmpegPath, ['-hide_banner', '-nostdin', ...args], {
    timeout,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** Fully decode the first audio stream. A successful container write alone
 * does not prove that the resulting audio is readable. */
async function verifyAudioFile(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size < 44) {
    throw new Error('Output is empty or too small to be valid audio');
  }

  await runFFmpeg([
    '-v', 'error',
    '-xerror',
    '-i', filePath,
    '-map', '0:a:0',
    '-f', 'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], 10 * 60 * 1000);
}

/**
 * Replace a file without ever writing into the original. If anything fails,
 * the untouched original is restored and the recovery copy is retained when
 * automatic restoration is impossible.
 */
async function commitVerifiedReplacement(originalPath, candidatePath) {
  await verifyAudioFile(candidatePath);
  const backupPath = siblingTempFile(originalPath, 'recovery');
  let originalMoved = false;

  try {
    await fsp.rename(originalPath, backupPath);
    originalMoved = true;
    await fsp.rename(candidatePath, originalPath);
    await verifyAudioFile(originalPath);
    await fsp.unlink(backupPath);
  } catch (error) {
    try { await fsp.unlink(originalPath); } catch {}
    if (originalMoved) {
      try { await fsp.rename(backupPath, originalPath); } catch (restoreError) {
        error.message += `; original recovery copy remains at ${backupPath}: ${restoreError.message}`;
      }
    }
    throw error;
  }
}

const reservedOutputPaths = new Set();

async function reserveAvailableOutputPath(outputDir, baseName, extension) {
  for (let index = 0; ; index++) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(outputDir, `${baseName}${suffix}${extension}`);
    const reservationKey = path.resolve(candidate).toLowerCase();
    if (reservedOutputPaths.has(reservationKey)) continue;
    reservedOutputPaths.add(reservationKey);
    try {
      await fsp.access(candidate);
      reservedOutputPaths.delete(reservationKey);
    } catch {
      return candidate;
    }
  }
}

/**
 * Helper to escape regex special characters
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper to get ffmpeg -metadata arguments from metadataOptions
 */
async function getFFmpegMetadataArgs(audioPath, metadataOptions) {
  if (!metadataOptions) return [];

  const metaArgs = [];
  if (metadataOptions.mode === 'set' && metadataOptions.set) {
    if ('title' in metadataOptions.set) metaArgs.push('-metadata', `title=${metadataOptions.set.title}`);
    if ('artist' in metadataOptions.set) metaArgs.push('-metadata', `artist=${metadataOptions.set.artist}`);
    if ('performerInfo' in metadataOptions.set) {
      metaArgs.push('-metadata', `album_artist=${metadataOptions.set.performerInfo}`);
      metaArgs.push('-metadata', `albumartist=${metadataOptions.set.performerInfo}`);
      metaArgs.push('-metadata', `TPE2=${metadataOptions.set.performerInfo}`);
    }
    if ('album' in metadataOptions.set) metaArgs.push('-metadata', `album=${metadataOptions.set.album}`);
  } else if (metadataOptions.mode === 'replace' && metadataOptions.replace) {
    const { findText, replaceText = '', targets = [], caseSensitive = false } = metadataOptions.replace;
    if (findText && targets.length > 0) {
      const mm = await getMusicMetadata();
      let existing = {};
      try {
        const parsed = await mm.parseFile(audioPath, { skipCovers: true });
        existing = parsed.common || {};
      } catch {}

      const flags = caseSensitive ? 'g' : 'gi';
      const regex = new RegExp(escapeRegExp(findText), flags);

      if (targets.includes('title') && typeof existing.title === 'string') {
        metaArgs.push('-metadata', `title=${existing.title.replace(regex, replaceText)}`);
      }
      if (targets.includes('artist') && typeof existing.artist === 'string') {
        metaArgs.push('-metadata', `artist=${existing.artist.replace(regex, replaceText)}`);
      }
      if (targets.includes('performerInfo') && typeof existing.albumartist === 'string') {
        const updated = existing.albumartist.replace(regex, replaceText);
        metaArgs.push('-metadata', `album_artist=${updated}`);
        metaArgs.push('-metadata', `albumartist=${updated}`);
        metaArgs.push('-metadata', `TPE2=${updated}`);
      }
      if (targets.includes('album') && typeof existing.album === 'string') {
        metaArgs.push('-metadata', `album=${existing.album.replace(regex, replaceText)}`);
      }
    }
  }
  return metaArgs;
}

/**
 * Replace cover art and/or metadata using ffmpeg (works for all formats)
 * Strategy: create output to temp file, then replace original
 */
// Formats that natively support attached_pic video stream mapping in FFmpeg
const ATTACHED_PIC_AUDIO_EXTS = new Set([
  '.flac', '.m4a', '.m4b'
]);

/**
 * Replace cover art and/or metadata using ffmpeg (works for all formats)
 * Strategy: create output to temp file, then replace original
 */
async function replaceCoverWithFFmpeg(audioPath, coverImagePath, metadataOptions) {
  const ext = path.extname(audioPath).toLowerCase();
  const tempOutput = siblingTempFile(audioPath);
  const supportsAttachedPic = ATTACHED_PIC_AUDIO_EXTS.has(ext);

  try {
    await verifyAudioFile(audioPath);
    if (coverImagePath && !supportsAttachedPic) {
      throw new Error(`Cover art writing is not supported for ${ext || 'this format'}; convert it to MP3, FLAC, M4A, or WAV first`);
    }
    if (metadataOptions && !METADATA_WRITABLE_EXTENSIONS.has(ext)) {
      throw new Error(`Metadata writing is not supported for ${ext || 'this format'}; convert it to a supported format first`);
    }
    const metaArgs = await getFFmpegMetadataArgs(audioPath, metadataOptions);
    let args;
    if (coverImagePath && supportsAttachedPic) {
      args = [
        '-y',
        '-i', audioPath,
        '-i', coverImagePath,
        '-map', '0:a',
        '-map', '1:v:0',
        '-c:a', 'copy',
        '-c:v', 'mjpeg',
        '-disposition:v:0', 'attached_pic',
        ...metaArgs,
        tempOutput
      ];
    } else {
      args = ['-y', '-i', audioPath, '-map', '0', '-c', 'copy', ...metaArgs, tempOutput];
    }

    await runFFmpeg(args);

    // Verify output file exists and has reasonable size
    const origStat = await fsp.stat(audioPath);
    const newStat = await fsp.stat(tempOutput);

    // Sanity check: new file should be at least 30% of original size
    if (newStat.size < origStat.size * 0.3) {
      throw new Error('Output file seems too small — possible encoding error');
    }

    // Replace original with the new file
    await commitVerifiedReplacement(audioPath, tempOutput);

    return { success: true };
  } catch (err) {
    // If the standard approach fails, try alternative strategies
    return { success: false, message: err.message || 'FFmpeg could not safely process this file' };
  } finally {
    // Clean up temp file
    try { await fsp.unlink(tempOutput); } catch {}
  }
}

/**
 * Fallback strategy for tricky formats
 */
/**
 * Helper to generate a RIFF 'LIST' ('INFO') sub-chunk for WAV files.
 * Ensures Windows Explorer, music-metadata, and hardware media players show the exact updated text tags.
 */
function createWavListInfoChunk(tags) {
  const makeInfoSub = (id, text) => {
    if (!text) return Buffer.alloc(0);
    const buf = Buffer.from(text + '\0', 'utf8');
    const sz = Buffer.alloc(4);
    sz.writeUInt32LE(buf.length, 0);
    const pad = buf.length % 2 !== 0 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([Buffer.from(id, 'ascii'), sz, buf, pad]);
  };

  const subs = [];
  if (tags.title) subs.push(makeInfoSub('INAM', tags.title));
  if (tags.artist || tags.performerInfo) subs.push(makeInfoSub('IART', tags.artist || tags.performerInfo));
  if (tags.album) subs.push(makeInfoSub('IPRD', tags.album));

  if (subs.length === 0) return Buffer.alloc(0);

  const infoBody = Buffer.concat([Buffer.from('INFO', 'ascii'), ...subs]);
  const listSz = Buffer.alloc(4);
  listSz.writeUInt32LE(infoBody.length, 0);
  const pad = infoBody.length % 2 !== 0 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from('LIST', 'ascii'), listSz, infoBody, pad]);
}

/**
 * Replace cover art and/or metadata for WAV files via RIFF 'id3 ' and 'LIST' ('INFO') sub-chunks.
 * Safely walks and strips existing 'id3 ' and 'LIST INFO' chunks from anywhere in the file without disturbing 'fmt ' or 'data'.
 * Keeps 'RIFF' header at byte 0 so 100% of players play it natively.
 */
async function replaceCoverWithWavRIFF(audioPath, imageBuffer, imageMime, metadataOptions) {
  const tempOutput = siblingTempFile(audioPath);
  try {
    await verifyAudioFile(audioPath);
    const buf = await fsp.readFile(audioPath);

    const riffOffset = buf.indexOf(Buffer.from('RIFF'));
    if (riffOffset === -1 || buf.slice(riffOffset + 8, riffOffset + 12).toString('ascii') !== 'WAVE') {
      throw new Error('Not a valid RIFF WAV file');
    }

    // Read any existing ID3 tags before stripping chunks
    const existingTags = NodeID3.read(buf) || {};

    // Walk all RIFF sub-chunks after 'RIFF <sz> WAVE' (offset riffOffset + 12)
    const preservedChunks = [];
    let offset = riffOffset + 12;

    while (offset + 8 <= buf.length) {
      const chunkId = buf.slice(offset, offset + 4).toString('ascii');
      const chunkSize = buf.readUInt32LE(offset + 4);
      const chunkTotalSize = 8 + chunkSize + (chunkSize % 2 !== 0 ? 1 : 0);

      if (offset + chunkTotalSize > buf.length) {
        // Truncated chunk or malformed size at end of file; stop safely
        break;
      }

      const lowerId = chunkId.toLowerCase();
      // Drop any existing 'id3 ' chunk wherever it is located
      if (lowerId === 'id3 ') {
        offset += chunkTotalSize;
        continue;
      }

      // Drop any existing 'LIST' sub-chunk if its type is 'INFO'
      if (chunkId === 'LIST' && chunkSize >= 4 && buf.slice(offset + 8, offset + 12).toString('ascii') === 'INFO') {
        offset += chunkTotalSize;
        continue;
      }

      // Preserve all audio chunks ('fmt ', 'data', 'bext', etc.) in exact order
      preservedChunks.push(buf.slice(offset, offset + chunkTotalSize));
      offset += chunkTotalSize;
    }

    const tags = {
      ...existingTags,
    };

    if (imageBuffer && imageMime) {
      tags.image = {
        mime: imageMime || 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: imageBuffer
      };
    }

    if (metadataOptions) {
      if (metadataOptions.mode === 'set' && metadataOptions.set) {
        if ('title' in metadataOptions.set) tags.title = metadataOptions.set.title;
        if ('artist' in metadataOptions.set) tags.artist = metadataOptions.set.artist;
        if ('performerInfo' in metadataOptions.set) tags.performerInfo = metadataOptions.set.performerInfo;
        if ('album' in metadataOptions.set) tags.album = metadataOptions.set.album;
      } else if (metadataOptions.mode === 'replace' && metadataOptions.replace) {
        const { findText, replaceText = '', targets = [], caseSensitive = false } = metadataOptions.replace;
        if (findText && targets.length > 0) {
          const flags = caseSensitive ? 'g' : 'gi';
          const regex = new RegExp(escapeRegExp(findText), flags);
          for (const target of targets) {
            if (typeof tags[target] === 'string' && tags[target]) {
              tags[target] = tags[target].replace(regex, replaceText);
            }
          }
        }
      }
    }

    const listInfoChunk = createWavListInfoChunk(tags);

    const id3Buf = NodeID3.create(tags);
    const fcc = Buffer.from('id3 ', 'binary');
    const sz = Buffer.alloc(4);
    sz.writeUInt32LE(id3Buf.length, 0);
    const pad = (id3Buf.length % 2 !== 0) ? Buffer.alloc(1) : Buffer.alloc(0);
    const id3Chunk = Buffer.concat([fcc, sz, id3Buf, pad]);

    const wavePayload = Buffer.concat([...preservedChunks, listInfoChunk, id3Chunk]);
    const riffHdr = Buffer.from('524946460000000057415645', 'hex');
    riffHdr.writeUInt32LE(wavePayload.length + 4, 4);

    const finalWav = Buffer.concat([riffHdr, wavePayload]);

    await fsp.writeFile(tempOutput, finalWav);
    await commitVerifiedReplacement(audioPath, tempOutput);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    try { await fsp.unlink(tempOutput); } catch {}
  }
}

/**
 * Replace cover art and/or metadata using node-id3 (for MP3 — fast, no temp file)
 */
async function replaceCoverWithID3(audioPath, imageBuffer, imageMime, metadataOptions) {
  const tempOutput = siblingTempFile(audioPath);
  try {
    await verifyAudioFile(audioPath);
    await fsp.copyFile(audioPath, tempOutput);
    const tags = NodeID3.read(tempOutput) || {};

  if (imageBuffer && imageMime) {
    tags.image = {
      mime: imageMime,
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: imageBuffer,
    };
  }

  if (metadataOptions) {
    if (metadataOptions.mode === 'set' && metadataOptions.set) {
      if ('title' in metadataOptions.set) tags.title = metadataOptions.set.title;
      if ('artist' in metadataOptions.set) tags.artist = metadataOptions.set.artist;
      if ('performerInfo' in metadataOptions.set) tags.performerInfo = metadataOptions.set.performerInfo;
      if ('album' in metadataOptions.set) tags.album = metadataOptions.set.album;
    } else if (metadataOptions.mode === 'replace' && metadataOptions.replace) {
      const { findText, replaceText = '', targets = [], caseSensitive = false } = metadataOptions.replace;
      if (findText && targets.length > 0) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(escapeRegExp(findText), flags);
        for (const target of targets) {
          if (typeof tags[target] === 'string' && tags[target]) {
            tags[target] = tags[target].replace(regex, replaceText);
          }
        }
      }
    }
  }

    const success = NodeID3.update(tags, tempOutput);
    if (!success) throw new Error('Failed to write ID3 tags');
    await commitVerifiedReplacement(audioPath, tempOutput);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message || 'Failed to safely write ID3 tags' };
  } finally {
    try { await fsp.unlink(tempOutput); } catch {}
  }
}

/**
 * Convert a non-audio/video media file to an audio file in target output directory using FFmpeg
 */
async function convertFileToAudio(inputPath, outputDir, format = 'mp3', bitrate = '320k', coverTempPath, metadataOptions) {
  let candidatePath = null;
  let outputPath = null;
  try {
    const baseName = path.parse(inputPath).name;
    const cleanFormat = format.toLowerCase().replace('.', '');
    const allowedFormats = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']);
    if (!allowedFormats.has(cleanFormat)) {
      throw new Error(`Unsupported output format: ${cleanFormat}`);
    }
    const outExt = `.${cleanFormat}`;
    outputPath = await reserveAvailableOutputPath(outputDir, baseName, outExt);
    candidatePath = siblingTempFile(outputPath);

    await verifyAudioFile(inputPath);

    const args = [
      '-y',
      '-i', inputPath
    ];

    const canAttachPic = coverTempPath && ['.mp3', '.flac', '.m4a'].includes(outExt);

    if (canAttachPic) {
      args.push('-i', coverTempPath);
      args.push('-map', '0:a');
      args.push('-map', '1:v');
      args.push('-c:v', 'mjpeg');
      args.push('-disposition:v:0', 'attached_pic');
    } else {
      args.push('-map', '0:a');
      args.push('-vn'); // Extract audio stream only
    }

    // Select audio codec & bitrate
    if (cleanFormat === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', bitrate || '320k');
    } else if (cleanFormat === 'wav') {
      args.push('-c:a', 'pcm_s16le');
    } else if (cleanFormat === 'flac') {
      args.push('-c:a', 'flac');
    } else if (cleanFormat === 'm4a' || cleanFormat === 'aac') {
      args.push('-c:a', 'aac', '-b:a', bitrate || '256k');
    } else if (cleanFormat === 'ogg') {
      args.push('-c:a', 'libvorbis', '-b:a', '192k');
    } else if (cleanFormat === 'opus') {
      args.push('-c:a', 'libopus', '-b:a', bitrate || '192k');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '320k');
    }

    // Attach metadata tags if provided
    const metaArgs = await getFFmpegMetadataArgs(inputPath, metadataOptions);
    args.push(...metaArgs);

    args.push(candidatePath);

    await runFFmpeg(args, 10 * 60 * 1000);
    await verifyAudioFile(candidatePath);
    await fsp.rename(candidatePath, outputPath);
    candidatePath = null;

    return { success: true, outputPath };
  } catch (err) {
    return { success: false, message: err.message || 'Conversion failed' };
  } finally {
    if (outputPath) reservedOutputPaths.delete(path.resolve(outputPath).toLowerCase());
    if (candidatePath) {
      try { await fsp.unlink(candidatePath); } catch {}
    }
  }
}

// ──────────────── API ROUTES ────────────────

/**
 * Browse a directory and return its contents
 */
app.post('/api/browse', async (req, res) => {
  try {
    const { dirPath } = req.body;

    if (!dirPath) {
      return res.json({ error: 'No path provided' });
    }

    const resolvedPath = path.resolve(dirPath);

    try {
      const stat = await fsp.stat(resolvedPath);
      if (!stat.isDirectory()) {
        return res.json({ error: 'Path is not a directory' });
      }
    } catch {
      return res.json({ error: 'Path does not exist' });
    }

    const entries = await fsp.readdir(resolvedPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') || HIDDEN_BROWSER_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(resolvedPath, entry.name);
      if (entry.isDirectory()) {
        items.push({ name: entry.name, path: fullPath, type: 'directory' });
      }
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    const parentDir = path.dirname(resolvedPath);

    res.json({
      currentPath: resolvedPath,
      parentPath: parentDir !== resolvedPath ? parentDir : null,
      items
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

/**
 * Get available drives (Windows)
 */
app.get('/api/drives', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    // Use PowerShell instead of deprecated wmic
    const output = execSync(
      'powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
      { encoding: 'utf-8' }
    );
    const drives = output.split('\n')
      .map(line => line.trim())
      .filter(line => /^[A-Z]:\\\\?$/.test(line))
      .map(drive => {
        const normalized = drive.endsWith('\\') ? drive : drive + '\\';
        return { name: normalized, path: normalized, type: 'drive' };
      });
    res.json({ drives: drives.length > 0 ? drives : [{ name: 'C:\\', path: 'C:\\', type: 'drive' }] });
  } catch {
    res.json({ drives: [{ name: 'C:\\', path: 'C:\\', type: 'drive' }] });
  }
});

/**
 * Scan a directory for audio files
 */
app.post('/api/scan', async (req, res) => {
  try {
    const { dirPath, recursive } = req.body;

    if (!dirPath) {
      return res.json({ error: 'No path provided' });
    }

    const resolvedPath = path.resolve(dirPath);
    const mm = await getMusicMetadata();

    const audioFiles = [];
    const nonAudioFiles = [];
    let totalFilesScanned = 0;
    const skippedExtensions = {};  // Track which non-audio extensions were found

    async function scanDir(dir) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && recursive) {
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          totalFilesScanned++;
          const ext = path.extname(entry.name).toLowerCase();
          const isAudio = AUDIO_EXTENSIONS.has(ext);
          const isMedia = NON_AUDIO_MEDIA_EXTENSIONS.has(ext);

          if (isAudio) {
            try {
              const metadata = await mm.parseFile(fullPath, { skipCovers: false });
              const cover = metadata.common.picture && metadata.common.picture[0];
              const stat = await fsp.stat(fullPath);

              audioFiles.push({
                path: fullPath,
                name: entry.name,
                ext: ext,
                size: stat.size,
                title: metadata.common.title || entry.name,
                artist: metadata.common.artist || 'Unknown',
                albumartist: metadata.common.albumartist || 'Unknown',
                album: metadata.common.album || 'Unknown',
                hasCover: !!cover,
                coverMime: cover ? cover.format : null,
                writable: COVER_WRITABLE_EXTENSIONS.has(ext) || METADATA_WRITABLE_EXTENSIONS.has(ext),
                coverWritable: COVER_WRITABLE_EXTENSIONS.has(ext),
                metadataWritable: METADATA_WRITABLE_EXTENSIONS.has(ext),
              });
            } catch (parseErr) {
              audioFiles.push({
                path: fullPath,
                name: entry.name,
                ext: ext,
                size: 0,
                title: entry.name,
                artist: 'Unknown',
                album: 'Unknown',
                hasCover: false,
                coverMime: null,
                writable: false,
                coverWritable: false,
                metadataWritable: false,
                error: 'Could not read metadata'
              });
            }
          }

          // If not audio OR if it's a video/media container, collect in nonAudioFiles for conversion option
          if (isAudio || isMedia) {
            let fileSize = 0;
            try {
              const stat = await fsp.stat(fullPath);
              fileSize = stat.size;
            } catch {}

            nonAudioFiles.push({
              path: fullPath,
              name: entry.name,
              ext: ext || '(no ext)',
              size: fileSize,
              isMedia: isMedia
            });
          }

          if (!isAudio) {
            // Track skipped extensions
            const key = ext || '(no extension)';
            skippedExtensions[key] = (skippedExtensions[key] || 0) + 1;
          }
        }
      }
    }

    await scanDir(resolvedPath);

    res.json({
      path: resolvedPath,
      totalFilesScanned,
      totalAudioFiles: audioFiles.length,
      totalNonAudioFiles: nonAudioFiles.length,
      skippedFiles: totalFilesScanned - audioFiles.length,
      skippedExtensions,
      files: audioFiles,
      nonAudioFiles
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

/**
 * Get cover art for a specific file
 */
app.get('/api/cover', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).send('No path provided');
    }

    const mm = await getMusicMetadata();
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const cover = metadata.common.picture && metadata.common.picture[0];

    if (!cover) {
      return res.status(404).send('No cover art found');
    }

    res.set('Content-Type', cover.format);
    res.send(cover.data);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// In-memory job storage
const jobs = new Map();

/**
 * Create a cover replacement job
 */
app.post('/api/create-job', upload.single('coverImage'), async (req, res) => {
  try {
    const { files, metadataOptions, outputDir } = req.body;
    const coverImage = req.file;

    let parsedMetadata = null;
    if (metadataOptions) {
      try { parsedMetadata = JSON.parse(metadataOptions); } catch {}
    }

    if (!coverImage && !parsedMetadata) {
      return res.json({ error: 'No cover image or text metadata provided' });
    }

    if (!files) {
      return res.json({ error: 'No files selected' });
    }

    const filePaths = JSON.parse(files);
    if (filePaths.length === 0) {
      return res.json({ error: 'Selected files list is empty' });
    }

    let resolvedOutputDir = null;
    if (typeof outputDir === 'string' && outputDir.trim()) {
      resolvedOutputDir = path.resolve(outputDir.trim());
      try {
        await fsp.mkdir(resolvedOutputDir, { recursive: true });
      } catch (mkdirErr) {
        return res.json({ error: `Cannot create replacement output directory: ${mkdirErr.message}` });
      }
    }

    let sharp;
    try { sharp = require('sharp'); } catch { sharp = null; }

    let imageBuffer = null;
    let imageMime = null;
    let coverTempPath = null;

    if (coverImage) {
      imageBuffer = coverImage.buffer;
      imageMime = coverImage.mimetype;

      if (sharp) {
        try {
          imageBuffer = await sharp(coverImage.buffer)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 92 })
            .toBuffer();
          imageMime = 'image/jpeg';
        } catch {}
      }

      coverTempPath = tempFile('.jpg');
      await fsp.writeFile(coverTempPath, imageBuffer);
    }

    const jobId = crypto.randomBytes(12).toString('hex');

    const job = {
      id: jobId,
      files: filePaths,
      coverTempPath,
      imageBuffer,
      imageMime,
      metadataOptions: parsedMetadata,
      outputDir: resolvedOutputDir,
      processed: 0,
      total: filePaths.length,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      results: [],
      status: 'pending',
      clients: []
    };

    jobs.set(jobId, job);

    res.json({ success: true, jobId, total: filePaths.length });
  } catch (err) {
    res.json({ error: err.message });
  }
});

/**
 * Create a conversion job to convert non-audio/video media files to audio files
 */
app.post('/api/create-convert-job', upload.single('coverImage'), async (req, res) => {
  try {
    const { files, outputDir, format = 'mp3', bitrate = '320k', metadataOptions } = req.body;
    const coverImage = req.file;

    if (!files) {
      return res.json({ error: 'No files provided for conversion' });
    }

    const filePaths = JSON.parse(files);
    if (!filePaths || filePaths.length === 0) {
      return res.json({ error: 'Selected files list is empty' });
    }

    if (!outputDir || typeof outputDir !== 'string' || !outputDir.trim()) {
      return res.json({ error: 'Please specify a destination folder' });
    }

    const resolvedOutputDir = path.resolve(outputDir.trim());

    // Ensure output directory exists
    try {
      await fsp.mkdir(resolvedOutputDir, { recursive: true });
    } catch (mkdirErr) {
      return res.json({ error: `Cannot create output directory: ${mkdirErr.message}` });
    }

    let parsedMetadata = null;
    if (metadataOptions) {
      try { parsedMetadata = JSON.parse(metadataOptions); } catch {}
    }

    let sharp;
    try { sharp = require('sharp'); } catch { sharp = null; }

    let imageBuffer = null;
    let imageMime = null;
    let coverTempPath = null;

    if (coverImage) {
      imageBuffer = coverImage.buffer;
      imageMime = coverImage.mimetype;

      if (sharp) {
        try {
          imageBuffer = await sharp(coverImage.buffer)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 92 })
            .toBuffer();
          imageMime = 'image/jpeg';
        } catch {}
      }

      coverTempPath = tempFile('.jpg');
      await fsp.writeFile(coverTempPath, imageBuffer);
    }

    const jobId = crypto.randomBytes(12).toString('hex');

    const job = {
      id: jobId,
      jobType: 'convert',
      files: filePaths,
      outputDir: resolvedOutputDir,
      format: format.toLowerCase().replace('.', ''),
      bitrate: bitrate || '320k',
      coverTempPath,
      imageBuffer,
      imageMime,
      metadataOptions: parsedMetadata,
      processed: 0,
      total: filePaths.length,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      results: [],
      status: 'pending',
      clients: []
    };

    jobs.set(jobId, job);

    res.json({ success: true, jobId, total: filePaths.length });
  } catch (err) {
    res.json({ error: err.message });
  }
});

/**
 * SSE Progress Stream for Job
 */
app.get('/api/job-stream/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).send('Job not found');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  job.clients.push(res);

  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res);
  });

  if (job.status === 'pending') {
    startJobProcessing(job);
  }
});

/**
 * Process job using 8 parallel worker tasks
 */
async function startJobProcessing(job) {
  job.status = 'processing';

  const CONCURRENCY = 8;
  let index = 0;

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of job.clients) {
      try { client.write(payload); } catch {}
    }
  }

  async function applyReplacementEdit(targetPath) {
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.wav' || ext === '.wave') {
      return replaceCoverWithWavRIFF(targetPath, job.imageBuffer, job.imageMime, job.metadataOptions);
    }
    if (ext === '.mp3') {
      return replaceCoverWithID3(targetPath, job.imageBuffer, job.imageMime, job.metadataOptions);
    }
    return replaceCoverWithFFmpeg(targetPath, job.coverTempPath, job.metadataOptions);
  }

  async function editOriginalOrCreateCopy(sourcePath) {
    if (!job.outputDir) return applyReplacementEdit(sourcePath);

    const parsed = path.parse(sourcePath);
    const outputPath = await reserveAvailableOutputPath(job.outputDir, parsed.name, parsed.ext);
    const reservationKey = path.resolve(outputPath).toLowerCase();
    let workingCopy = siblingTempFile(outputPath, 'edit');

    try {
      await fsp.copyFile(sourcePath, workingCopy);
      const result = await applyReplacementEdit(workingCopy);
      if (!result.success) return result;

      await verifyAudioFile(workingCopy);
      try {
        await fsp.access(outputPath);
        throw new Error(`Destination file appeared while processing: ${outputPath}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fsp.rename(workingCopy, outputPath);
      workingCopy = null;
      return { success: true, outputPath, message: `Saved edited copy to ${outputPath}` };
    } finally {
      reservedOutputPaths.delete(reservationKey);
      if (workingCopy) {
        try { await fsp.unlink(workingCopy); } catch {}
      }
    }
  }

  async function worker() {
    while (index < job.files.length) {
      const currentIndex = index++;
      const filePath = job.files[currentIndex];

      let status = 'success';
      let message = null;
      let outputPath = null;

      try {
        if (job.jobType === 'convert') {
          const result = await convertFileToAudio(
            filePath,
            job.outputDir,
            job.format,
            job.bitrate,
            job.coverTempPath,
            job.metadataOptions
          );
          status = result.success ? 'success' : 'error';
          message = result.message;
        } else {
          const result = await editOriginalOrCreateCopy(filePath);
          status = result.success ? 'success' : 'error';
          message = result.message;
          if (result.outputPath) outputPath = result.outputPath;
        }
      } catch (err) {
        status = 'error';
        message = err.message;
      }

      job.processed++;
      if (status === 'success') job.successCount++;
      else if (status === 'error') job.errorCount++;
      else job.skippedCount++;

      const resultItem = { path: filePath, outputPath, status, message };
      job.results.push(resultItem);

      broadcast('progress', {
        processed: job.processed,
        total: job.total,
        percent: Math.round((job.processed / job.total) * 100),
        item: resultItem,
        summary: {
          success: job.successCount,
          error: job.errorCount,
          skipped: job.skippedCount
        }
      });
    }
  }

  const workerCount = Math.min(CONCURRENCY, job.files.length);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);

  job.status = 'completed';

  broadcast('complete', {
    total: job.total,
    summary: {
      success: job.successCount,
      error: job.errorCount,
      skipped: job.skippedCount
    },
    results: job.results
  });

  // Cleanup temp cover file after 1 minute
  setTimeout(async () => {
    if (job.coverTempPath) {
      try { await fsp.unlink(job.coverTempPath); } catch {}
    }
    jobs.delete(job.id);
  }, 60000);
}

function startServer(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST, () => resolve(server));
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().then((server) => {
    const address = server.address();
    console.log(`\n  🎵 Audio Cover Replacer running at http://localhost:${PORT}`);
    console.log(`  📀 FFmpeg path: ${ffmpegPath}\n`);
  }).catch((error) => {
    console.error(`CoverSwap could not start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
  replaceCoverWithWavRIFF,
  replaceCoverWithID3,
  replaceCoverWithFFmpeg,
  convertFileToAudio,
  verifyAudioFile,
  COVER_WRITABLE_EXTENSIONS,
  METADATA_WRITABLE_EXTENSIONS,
};
