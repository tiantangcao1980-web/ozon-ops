/**
 * Monitor 服务：本地 HTTP，两个路由
 *  - GET /            暗色看板 HTML（前端每 15s 拉 /api/state）
 *  - GET /api/state   当前快照 JSON
 *  - GET /healthz     存活探针
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { buildMonitorState, renderMonitorHtml } from '../render/monitor.mjs';

export function loadEndpoints(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function createMonitorServer({ db, endpoints = null, port = 8288, host = '127.0.0.1', sseIntervalMs = 5000 }) {
  const clients = new Set();
  const timer = setInterval(() => {
    if (clients.size === 0) return;
    let payload;
    try {
      payload = JSON.stringify(buildMonitorState({ db, endpoints }));
    } catch {
      return;
    }
    for (const client of clients) {
      try {
        client.write(`event: state\ndata: ${payload}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }, sseIntervalMs);
  timer.unref?.();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    try {
      if (url.pathname === '/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        response.write(`event: state\ndata: ${JSON.stringify(buildMonitorState({ db, endpoints }))}\n\n`);
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      if (url.pathname === '/api/state') {
        const state = buildMonitorState({ db, endpoints });
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(state));
        return;
      }
      if (url.pathname === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('ok');
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = renderMonitorHtml(buildMonitorState({ db, endpoints }));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(html);
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end(`monitor error: ${String(error?.message ?? error)}`);
    }
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(`http://${host}:${port}`));
      }),
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        for (const client of clients) {
          try {
            client.end();
          } catch {
            // 忽略已断开的连接
          }
        }
        clients.clear();
        server.close(() => resolve());
      }),
  };
}

export function writeMonitorSnapshot({ db, endpoints = null, reportsDir, date = new Date().toISOString().slice(0, 10) }) {
  const state = buildMonitorState({ db, endpoints });
  mkdirSync(reportsDir, { recursive: true });
  const htmlPath = join(reportsDir, 'monitor.html');
  const statePath = join(reportsDir, `monitor-${date}.json`);
  writeFileSync(htmlPath, renderMonitorHtml(state), 'utf8');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { htmlPath, statePath };
}
