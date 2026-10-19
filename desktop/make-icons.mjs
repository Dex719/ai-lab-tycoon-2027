// Иконки оболочки из public/favicon.svg: app/icon.png (окно) и build/icon-1024.png (из него iconutil делает icon.icns на Mac).
import sharp from 'sharp';
import fs from 'fs';

const svg = fs.readFileSync('../public/favicon.svg');
fs.mkdirSync('build', { recursive: true });
await sharp(svg, { density: 600 }).resize(512, 512).png().toFile('app/icon.png');
await sharp(svg, { density: 1200 }).resize(1024, 1024).png().toFile('build/icon-1024.png');
console.log('icons ok');
