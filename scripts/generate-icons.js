import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcePath = path.join(__dirname, '..', 'landing', 'images', 'new_logo.png');
const outputDir = path.join(__dirname, '..', 'build');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const SIZE = 1024;
const CORNER_RADIUS = 180;

async function generateSquircleMask(size, radius) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
  </svg>`;
  return Buffer.from(svg);
}

async function main() {
  const iconScale = 0.82;
  const iconSize = Math.round(SIZE * iconScale);
  const iconOffset = Math.round((SIZE - iconSize) / 2);
  const cornerRadius = Math.round(CORNER_RADIUS * iconScale);

  const graphZoom = 2.6;
  const zoomedSize = Math.round(iconSize * graphZoom);

  const iconBuffer = await sharp(sourcePath)
    .resize(zoomedSize, zoomedSize, { fit: 'cover', position: 'center' })
    .extract({
      left: Math.round((zoomedSize - iconSize) / 2),
      top: Math.round((zoomedSize - iconSize) / 2),
      width: iconSize,
      height: iconSize
    })
    .png()
    .toBuffer();

  const maskBuffer = await generateSquircleMask(iconSize, cornerRadius);

  const roundedIconBuffer = await sharp(iconBuffer)
    .composite([
      { input: maskBuffer, blend: 'dest-in' }
    ])
    .png()
    .toBuffer();

  const canvasBuffer = await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .png()
  .toBuffer();

  const finalBuffer = await sharp(canvasBuffer)
    .composite([
      { input: roundedIconBuffer, left: iconOffset, top: iconOffset }
    ])
    .png()
    .toBuffer();

  await sharp(finalBuffer)
    .toFile(path.join(outputDir, 'icon.png'));

  console.log('Generated icon.png (1024x1024), icon scale:', iconScale);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
