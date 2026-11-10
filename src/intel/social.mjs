/**
 * 社媒与需求信号：Yandex 建议词 + Telegram 公开频道。
 * 纯解析函数（可单测）+ 传输层（直连或经本地代理的 curl）。
 */
import { execFile } from 'node:child_process';

export function parseSuggest(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  const values = data
    .map((item) => (Array.isArray(item) ? item[0] : item))
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return [...new Set(values)];
}

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTelegramChannel(html, { channel } = {}) {
  const source = String(html ?? '');
  const blocks = source.split(/<div class="tgme_widget_message[ "]/).slice(1);
  const posts = [];
  for (const block of blocks) {
    const postMatch = block.match(/data-post="([^"]+)"/);
    const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const timeMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
    const text = textMatch ? stripTags(textMatch[1]) : '';
    if (!postMatch || !text) continue;
    posts.push({
      channel: channel ?? postMatch[1].split('/')[0],
      postId: postMatch[1],
      text: text.slice(0, 2000),
      publishedAt: timeMatch ? timeMatch[1] : null,
      url: `https://t.me/${postMatch[1]}`,
    });
  }
  return posts;
}

/** 传输：直连 fetch 或经本地代理的 curl（Node fetch 不支持 HTTP proxy）。 */
export async function httpGet(url, { proxy = null, timeoutMs = 30_000 } = {}) {
  if (!proxy) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  }
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-s', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-x', proxy, '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0', url],
      { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export function suggestUrl(part) {
  return `https://suggest.yandex.ru/suggest-ff.cgi?part=${encodeURIComponent(part)}&uil=ru&v=4&sn=10`;
}

export async function fetchSuggestions(part, { get = httpGet } = {}) {
  const body = await get(suggestUrl(part));
  return parseSuggest(body);
}

export async function fetchTelegramChannel(channel, { proxy = null, get = httpGet } = {}) {
  const html = await get(`https://t.me/s/${encodeURIComponent(channel)}`, { proxy });
  return parseTelegramChannel(html, { channel });
}
