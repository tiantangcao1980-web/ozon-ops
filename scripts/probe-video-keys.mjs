import { RemoteMcpClient } from 'file:///path/to/lovart-bundle/server/remote-mcp.js';
const client = new RemoteMcpClient({ timeoutMs: 120000 });
function payload(res) { if (res?.structuredContent) return res.structuredContent; const t = res?.content?.[0]?.text; if (typeof t === 'string') { try { return JSON.parse(t); } catch { return { text: t }; } } return res; }
const call = async (n, a) => payload(await client.callTool(n, a || {}));
for (const m of ['wan/wan-3-0', 'seedance/seedance-2-0']) {
  const d = await call('describe_model', { model: m });
  const props = d?.schema?.properties || {};
  console.log(m, '=>', Object.keys(props).join(', '));
  if (props.resolution) console.log('  resolution:', JSON.stringify(props.resolution).slice(0, 300));
  if (props.ratio) console.log('  ratio:', JSON.stringify(props.ratio).slice(0, 300));
  if (props.duration) console.log('  duration:', JSON.stringify(props.duration).slice(0, 300));
}
