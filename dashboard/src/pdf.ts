import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from './config';

/** Render a local page to PDF with headless Edge (installed on the server; no extra packages). */
export function renderPdf(url: string): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-pdf-'));
  const out = path.join(dir, 'out.pdf');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--virtual-time-budget=5000',
    `--print-to-pdf=${out}`,
    url,
  ];
  return new Promise((resolve, reject) => {
    execFile(config.edgePath, args, { timeout: 60000, windowsHide: true }, (err) => {
      try {
        if (fs.existsSync(out) && fs.statSync(out).size > 0) resolve(fs.readFileSync(out));
        else reject(err ?? new Error('Edge produced no PDF'));
      } finally {
        fs.rm(dir, { recursive: true, force: true }, () => undefined);
      }
    });
  });
}
