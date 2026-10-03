#!/usr/bin/env node
/**
 * Дебаг-проба флагов qwen (VL-63, фаза Comment): какие из --json-file /
 * --json-fd реально пишут JSON в headless-режиме (позиционный промпт)?
 * Запуск: node scripts/qwen-json-probe.mjs [mode]
 * mode: json-file | json-file+json | fd | fd+json (по умолчанию все по очереди)
 */
import { spawn } from 'node:child_process';
import { openSync, closeSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tmp = join(root, '.vibelog', 'tmp');
const prompt = 'Ответь одним словом: понг';

function run(name, args, fdFile) {
  return new Promise((resolve) => {
    const stdio = fdFile
      ? ['ignore', 'pipe', 'pipe', openSync(fdFile, 'w')]
      : ['ignore', 'pipe', 'pipe'];
    const child = spawn('qwen', [prompt, '--approval-mode', 'yolo', ...args], {
      cwd: root,
      stdio,
    });
    if (fdFile) closeSync(stdio[3]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      const fdContent = fdFile && existsSync(fdFile) ? readFileSync(fdFile, 'utf-8') : '';
      console.log(`\n=== ${name} (exit=${code}) ===`);
      console.log(`stdout: ${out.slice(0, 200).replace(/\n/g, '\\n')}`);
      console.log(`stderr: ${err.slice(0, 120).replace(/\n/g, '\\n')}`);
      if (fdFile) {
        console.log(`fd-файл (${fdFile}): ${fdContent.length} байт`);
        console.log(fdContent.slice(0, 300));
      }
      resolve();
    });
  });
}

const mode = process.argv[2] || 'all';
const file1 = join(tmp, 'probe-json-file.json');
const file2 = join(tmp, 'probe-json-file+json.json');
const fdFile = join(tmp, 'probe-fd3.json');
const fdJsonFile = join(tmp, 'probe-fd3+json.json');
for (const f of [file1, file2, fdFile, fdJsonFile]) rmSync(f, { force: true });

if (mode === 'all' || mode === 'json-file') {
  await run('--json-file (без --output-format)', ['--json-file', file1], null);
}
if (mode === 'all' || mode === 'json-file+json') {
  await run('--json-file + --output-format json', ['--json-file', file2, '--output-format', 'json'], null);
}
if (mode === 'all' || mode === 'fd') {
  await run('--json-fd 3 (без --output-format)', ['--json-fd', '3'], fdFile);
}
if (mode === 'all' || mode === 'fd+json') {
  await run('--json-fd 3 + --output-format json', ['--json-fd', '3', '--output-format', 'json'], fdJsonFile);
}
