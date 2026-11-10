import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
const client = new RemoteMcpClient({ timeoutMs: 120000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const call = async (n, a) => payload(await client.callTool(n, a || {}));
for (const m of ['wan/wan-3-0', 'seedance/seedance-2-0', 'kling/kling-v4-flash', 'vertex/veo3-1-fast', 'wan/wan-2-6']) {
  try {
    const d = await call('describe_model', { model: m });
    console.log('==== ' + m + ' ====');
    console.log(JSON.stringify(d).slice(0, 3000));
  } catch (e) { console.log('ERR ' + m + ' ' + String(e?.message || e).slice(0, 200)); }
}
