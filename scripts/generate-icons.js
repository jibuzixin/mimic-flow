import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgPath = path.join(__dirname, '..', 'landing', 'images', 'logo-geo.svg');
const outputDir = path.join(__dirname, '..', 'build');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const svgBuffer = fs.readFileSync(svgPath);

sharp(svgBuffer)
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outputDir, 'icon.png'))
  .then(() => {
    console.log('Generated icon.png (1024x1024)');
  })
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
