import fs from 'node:fs';
import { httpRequest } from 'file:///path/to/lovart-bundle/server/http.js';
const out = 'assets/video-test';
fs.mkdirSync(out, { recursive: true });
const url = 'https://cdn.example.com/artifacts/example-test.mp4';
const resp = await httpRequest({ url, method: 'GET', timeoutMs: 180000 });
fs.writeFileSync(out + '/w2-clip-test.mp4', resp.body);
console.log('saved', resp.body.length);
