import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'commerce-package-'));
const output = execFileSync('npm', ['pack', '--json'], { encoding: 'utf8' });
const [{ filename }] = JSON.parse(output);
execFileSync('npm', ['init', '-y'], { cwd: directory, stdio: 'ignore' });
execFileSync('npm', ['install', join(process.cwd(), filename)], {
  cwd: directory,
  stdio: 'ignore',
});
unlinkSync(filename);
execFileSync(
  'node',
  [
    '--input-type=module',
    '--eval',
    "import commerce, { createCommerceMongoose } from 'digikala-commerce-mongoose'; if (commerce !== createCommerceMongoose) process.exit(1);",
  ],
  { cwd: directory, stdio: 'inherit' },
);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
if (!manifest.exports['./nestjs'] || !manifest.exports['./testing']) {
  throw new Error('Expected NestJS and testing exports');
}
console.log('Packed artifact installs and imports in a clean consumer.');
