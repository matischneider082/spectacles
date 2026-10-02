import { closeSync, openSync, readSync } from 'node:fs';

export const imageTypes = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function isImage(file, ext) {
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(12);
  let bytes;
  try {
    bytes = readSync(fd, header, 0, header.length, 0);
  } finally {
    closeSync(fd);
  }
  if (ext === '.png') return bytes >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (ext === '.jpg' || ext === '.jpeg') return bytes >= 3 && header.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (ext === '.webp') return bytes >= 12 && header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
