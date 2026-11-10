/**
 * Screen 服务：OZON 情报大屏（类 WorldMonitor）。
 *  - GET /           1920×1080 大屏 HTML（前端走 SSE，失败回退轮询）
 *  - GET /api/state  当前快照 JSON（可给其它看板/监控系统直接消费）
 *  - GET /events     SSE 推送
 *  - GET /healthz    存活探针
 */
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildScreenState, renderScreenHtml } from '../render/screen.mjs';

export function createScreenServer({ db, endpoints = null, port = 8289, host = '127.0.0.1', demo = false, sseIntervalMs = 5000 }) {
  const clients = new Set();
  const snapshot = () => buildScreenState({ db, endpoints, demo });
  const timer = setInterval(() => {
    if (clients.size === 0) return;
    let payload;
    try {
      payload = JSON.stringify(snapshot());
    } catch {
      return;
    }
    for (const client of clients) {
      try {
        client.write('event: state\ndata: ' + payload + '\n\n');
      } catch {
        clients.delete(client);
      }
    }
  }, sseIntervalMs);
  timer.unref?.();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://' + host + ':' + port);
    try {
      if (url.pathname === '/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        response.write('event: state\ndata: ' + JSON.stringify(snapshot()) + '\n\n');
        clients.add(response);
        request.on('close', () => clients.delete(response));
        return;
      }
      if (url.pathname === '/api/state') {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(snapshot()));
        return;
      }
      if (url.pathname === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end('ok');
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(renderScreenHtml(snapshot()));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('screen error: ' + String(error?.message ?? error));
    }
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve('http://' + host + ':' + port));
      }),
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        for (const client of clients) {
          try {
            client.end();
          } catch {
            // 已断开的连接忽略
          }
        }
        clients.clear();
        server.close(() => resolve());
      }),
  };
}

export function writeScreenSnapshot({ db, endpoints = null, reportsDir, demo = false, date = new Date().toISOString().slice(0, 10) }) {
  const state = buildScreenState({ db, endpoints, demo });
  mkdirSync(reportsDir, { recursive: true });
  const htmlPath = join(reportsDir, 'screen.html');
  const statePath = join(reportsDir, 'screen-' + date + '.json');
  writeFileSync(htmlPath, renderScreenHtml(state), 'utf8');
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return { htmlPath, statePath, state };
}
