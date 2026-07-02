// Genera build/icon.ico (multi-tamaño) e icon.png a partir de build/icon.svg
// Si existe logo.png en la raíz, lo usa como fuente (tu logo real) en vez del emblema.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const _ico = require('png-to-ico');
const toIco = _ico.default || _ico;

(async () => {
  const root = __dirname;
  const realLogo = path.join(root, 'logo.png');
  const svg = path.join(root, 'build', 'icon.svg');
  const source = fs.existsSync(realLogo) ? realLogo : svg;
  console.log('Fuente del ícono:', path.basename(source));

  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = [];
  for (const s of sizes) {
    pngs.push(await sharp(source).resize(s, s, { fit: 'contain', background: { r:255,g:255,b:255,alpha:1 } }).png().toBuffer());
  }
  const ico = await toIco(pngs);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  await sharp(source).resize(512, 512, { fit: 'contain', background: { r:255,g:255,b:255,alpha:1 } }).png().toFile(path.join(root, 'icon.png'));
  console.log('OK -> build/icon.ico  +  icon.png');
})().catch(e => { console.error(e); process.exit(1); });
