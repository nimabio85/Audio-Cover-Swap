const path = require('node:path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
sharp(path.join(root, 'build', 'icon.svg'))
  .resize(512, 512)
  .png()
  .toFile(path.join(root, 'build', 'icon.png'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
