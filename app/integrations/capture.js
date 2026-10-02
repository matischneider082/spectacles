import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkError } from '../work.js';
import { isImage } from './images.js';

const windowsScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($env:SPECTACLES_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
`;

function runCapture(executable, args, env) {
  return spawnSync(executable, args, { encoding: 'utf8', env, timeout: 30000 });
}

export async function withCapturedScreenshot(callback, {
  platform = process.platform,
  capture = runCapture,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spectacles-capture-'));
  const file = join(dir, 'capture.png');
  try {
    let attempts;
    if (platform === 'darwin') {
      attempts = [['screencapture', ['-x', '-D', '1', file]]];
    } else if (platform === 'win32') {
      attempts = [['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsScript]]];
    } else if (platform === 'linux') {
      attempts = [['grim', [file]], ['gnome-screenshot', ['-f', file]], ['scrot', [file]]];
    } else {
      throw new WorkError(`Screen capture is not supported on ${platform}. Attach an existing image instead.`);
    }
    let result;
    for (const [command, args] of attempts) {
      result = capture(command, args, { ...process.env, SPECTACLES_SCREENSHOT_PATH: file });
      if (result.status === 0) break;
    }
    if (result.error?.code === 'ENOENT') {
      throw new WorkError('No screenshot tool found. Install grim, gnome-screenshot, or scrot; or attach an existing image.');
    }
    if (result.error) throw new WorkError(`Screenshot capture failed: ${result.error.message}`);
    if (result.status !== 0) {
      throw new WorkError(`Screenshot capture failed: ${(result.stderr || result.stdout || 'permission denied or tool unavailable').trim()}`);
    }
    try {
      if (!statSync(file).size || !isImage(file, '.png')) {
        throw new WorkError('Screenshot tool did not produce a valid PNG.');
      }
    } catch (error) {
      if (error.code === 'ENOENT') throw new WorkError('Screenshot tool did not produce a PNG.');
      throw error;
    }
    return await callback(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
