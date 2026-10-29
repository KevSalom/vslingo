import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

// Reuse Astro's installed image renderer; no additional dependency is needed.
const astroRequire = createRequire(import.meta.resolve('astro/package.json'));
const sharp = astroRequire('sharp');
const publicDir = new URL('../public/', import.meta.url);
const source = await fs.readFile(new URL('app-icon.svg', publicDir), 'utf8');
const artwork = source.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)[1];
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#b85732"/>
  <g transform="translate(8 8) scale(.75)">${artwork}</g>
</svg>\n`;

await fs.writeFile(new URL('favicon.svg', publicDir), source);
await fs.writeFile(new URL('app-icon-maskable.svg', publicDir), maskable);
for (const size of [180, 192, 512]) {
  await fs.writeFile(new URL(`app-icon-${size}.png`, publicDir),
    await sharp(Buffer.from(source)).resize(size, size).png().toBuffer());
}
await fs.writeFile(new URL('app-icon-maskable-512.png', publicDir),
  await sharp(Buffer.from(maskable)).resize(512, 512).png().toBuffer());

// PNG-backed ICO includes native sizes for browser tabs and Windows shortcuts.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(Buffer.from(source)).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await fs.writeFile(new URL('favicon.ico', publicDir), Buffer.concat([directory, ...images]));
console.log('Generated SVG, PNG and ICO brand icons from app-icon.svg.');
