// Packs the extension into dist/n8n-module-manager-<version>.zip, with manifest.json at the root of the zip.
// That zip is what you share, upload to the Chrome Web Store, or (unzipped) load in chrome://extensions.
// No dependencies: a small zip writer on top of node:zlib.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const extDir = join(root, 'extension');

const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  console.error(`Version mismatch: manifest.json ${manifest.version}, package.json ${pkg.version}. Make them the same first.`);
  process.exit(1);
}

// Every file under extension/, except hidden files (.DS_Store and the like), plus the LICENSE.
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(extDir)
  .map((p) => ({ name: relative(extDir, p).split(sep).join('/'), path: p }))
  .concat([{ name: 'LICENSE', path: join(root, 'LICENSE') }])
  .sort((a, b) => a.name.localeCompare(b.name));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const locals = [];
const centrals = [];
let offset = 0;
for (const f of files) {
  const data = readFileSync(f.path);
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f.name, 'utf8');
  const crc = crc32(data);
  const { time, date } = dosTime(statSync(f.path).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // names are UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42); // the other fields (extra, comment, disk, attributes) stay 0
  centrals.push(central, name);

  offset += local.length + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `n8n-module-manager-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${relative(root, out)}: ${files.length} files, ${(statSync(out).size / 1024).toFixed(0)} KB`);
