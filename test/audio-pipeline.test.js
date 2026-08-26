const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ffmpeg = require('ffmpeg-static');
const {
  convertFileToAudio,
  replaceCoverWithFFmpeg,
  replaceCoverWithID3,
  replaceCoverWithWavRIFF,
  verifyAudioFile,
} = require('../server');

const execFileAsync = promisify(execFile);
const coverPath = path.join(__dirname, '..', 'test_cover.jpg');

async function ffmpegRun(args) {
  await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
    timeout: 120000,
    windowsHide: true,
  });
}

async function makeTone(filePath, codecArgs) {
  await ffmpegRun([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.35',
    ...codecArgs,
    '-y', filePath,
  ]);
  await verifyAudioFile(filePath);
}

async function sha256(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

test('converts a valid source into every offered output format and verifies decoding', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverswap-convert-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'source.wav');
  await makeTone(input, ['-c:a', 'pcm_s16le']);

  for (const format of ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus']) {
    await t.test(format, async () => {
      const result = await convertFileToAudio(input, dir, format, '192k');
      assert.equal(result.success, true, result.message);
      await verifyAudioFile(result.outputPath);
      assert.notEqual(path.resolve(result.outputPath), path.resolve(input));
    });
  }
});

test('cover writing works for every format advertised as cover-writable', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverswap-covers-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const image = await fs.readFile(coverPath);
  const cases = [
    ['mp3', ['-c:a', 'libmp3lame'], (file) => replaceCoverWithID3(file, image, 'image/jpeg', null)],
    ['wav', ['-c:a', 'pcm_s16le'], (file) => replaceCoverWithWavRIFF(file, image, 'image/jpeg', null)],
    ['flac', ['-c:a', 'flac'], (file) => replaceCoverWithFFmpeg(file, coverPath, null)],
    ['m4a', ['-c:a', 'aac'], (file) => replaceCoverWithFFmpeg(file, coverPath, null)],
    ['m4b', ['-c:a', 'aac'], (file) => replaceCoverWithFFmpeg(file, coverPath, null)],
  ];

  for (const [extension, codecArgs, edit] of cases) {
    await t.test(extension, async () => {
      const file = path.join(dir, `cover.${extension}`);
      await makeTone(file, codecArgs);
      const result = await edit(file);
      assert.equal(result.success, true, result.message);
      await verifyAudioFile(file);
    });
  }
});

test('metadata-only stream copies remain decodable across advertised containers', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverswap-metadata-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cases = [
    ['flac', ['-c:a', 'flac']],
    ['m4a', ['-c:a', 'aac']],
    ['ogg', ['-c:a', 'libvorbis']],
    ['opus', ['-c:a', 'libopus']],
    ['wma', ['-c:a', 'wmav2']],
    ['aiff', ['-c:a', 'pcm_s16be']],
    ['wv', ['-c:a', 'wavpack']],
  ];

  for (const [extension, codecArgs] of cases) {
    await t.test(extension, async () => {
      const file = path.join(dir, `metadata.${extension}`);
      await makeTone(file, codecArgs);
      const result = await replaceCoverWithFFmpeg(file, null, {
        mode: 'set',
        set: { title: 'Verified title', artist: 'CoverSwap tests' },
      });
      assert.equal(result.success, true, result.message);
      await verifyAudioFile(file);
    });
  }
});

test('a corrupt input is rejected without changing a byte of the original', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverswap-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'broken.mp3');
  await fs.writeFile(file, crypto.randomBytes(4096));
  const before = await sha256(file);
  const result = await replaceCoverWithID3(file, await fs.readFile(coverPath), 'image/jpeg', null);
  assert.equal(result.success, false);
  assert.equal(await sha256(file), before);
});

test('conversion never overwrites an existing destination', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coverswap-collision-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'same.wav');
  const existing = path.join(dir, 'same.mp3');
  await makeTone(input, ['-c:a', 'pcm_s16le']);
  await fs.writeFile(existing, 'keep me');
  const before = await sha256(existing);
  const result = await convertFileToAudio(input, dir, 'mp3', '192k');
  assert.equal(result.success, true, result.message);
  assert.match(path.basename(result.outputPath), /^same \(1\)\.mp3$/);
  assert.equal(await sha256(existing), before);
});
