import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

function createServer() {
  const server = new McpServer({
    name: "crypto-monitor",
    version: "1.0.0",
  });

  server.tool(
    "get_crypto_data",
    "Fetches real-time cryptocurrency market data",
    {
      coins: z.string().describe("Comma-separated coin ids e.g. bitcoin,ethereum,solana"),
      currency: z.string().default("usd").describe("Currency: usd, eur, cad"),
    },
    async ({ coins, currency }) => {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&ids=${coins}&order=market_cap_desc&sparkline=false&price_change_percentage=1h,24h,7d`
        );
        const data = await response.json();

        const html = `<!DOCTYPE html>
<html>
<head>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui; padding: 16px; }
h2 { font-size: 16px; font-weight: 700; margin-bottom: 12px; }
.row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
select, .btn { padding: 6px 12px; border-radius: 20px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; font-size: 13px; }
.btn.active, .btn:hover { background: #6366f1; color: white; border-color: #6366f1; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
td { padding: 10px 8px; border-bottom: 1px solid #f3f4f6; }
tr:hover { background: #f9fafb; }
</style>
</head>
<body>
<h2>🪙 Crypto Market Monitor</h2>
<div class="row">
  <select id="sort" onchange="render()">
    <option value="market_cap">Market Cap</option>
    <option value="price">Price</option>
    <option value="change24h">24h Change</option>
    <option value="volume">Volume</option>
  </select>
  <button class="btn active" onclick="filter('all',this)">All</button>
  <button class="btn" onclick="filter('gainers',this)">🟢 Gainers</button>
  <button class="btn" onclick="filter('losers',this)">🔴 Losers</button>
</div>
<table>
  <thead><tr><th>Asset</th><th>Price</th><th>1h%</th><th>24h%</th><th>7d%</th><th>Mkt Cap</th><th>Volume</th></tr></thead>
  <tbody id="body"></tbody>
</table>
<script>
const D = ${JSON.stringify(data)};
let f = 'all';
function filter(t, b) { f=t; document.querySelectorAll('.btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); render(); }
function render() {
  const s = document.getElementById('sort').value;
  let d = [...D];
  if(f==='gainers') d=d.filter(c=>c.price_change_percentage_24h>0);
  if(f==='losers') d=d.filter(c=>c.price_change_percentage_24h<0);
  d.sort((a,b)=>{
    if(s==='price') return b.current_price-a.current_price;
    if(s==='change24h') return b.price_change_percentage_24h-a.price_change_percentage_24h;
    if(s==='volume') return b.total_volume-a.total_volume;
    return b.market_cap-a.market_cap;
  });
  document.getElementById('body').innerHTML=d.map(c=>{
    const c24=(c.price_change_percentage_24h||0).toFixed(2);
    const c7=(c.price_change_percentage_7d_in_currency||0).toFixed(2);
    const c1=(c.price_change_percentage_1h_in_currency||0).toFixed(2);
    return \`<tr>
      <td><div style="display:flex;align-items:center;gap:6px"><img src="\${c.image}" width="20" height="20" style="border-radius:50%"/><strong>\${c.name}</strong><span style="color:#9ca3af;font-size:11px">\${c.symbol.toUpperCase()}</span></div></td>
      <td><strong>$\${c.current_price.toLocaleString()}</strong></td>
      <td style="color:\${c1>=0?'#16a34a':'#dc2626'}">\${c1}%</td>
      <td style="color:\${c24>=0?'#16a34a':'#dc2626'}">\${c24}%</td>
      <td style="color:\${c7>=0?'#16a34a':'#dc2626'}">\${c7}%</td>
      <td>$\${(c.market_cap/1e9).toFixed(2)}B</td>
      <td>$\${(c.total_volume/1e9).toFixed(2)}B</td>
    </tr>\`;
  }).join('');
}
render();
</script>
</body>
</html>`;

        return {
          content: [{
            type: "resource",
            resource: {
              uri: "ui://widget/crypto",
              mimeType: "text/html+skybridge",
              text: html,
            },
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }] };
      }
    }
  );
  return server;
}

const transports = {};

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => Math.random().toString(36).slice(2),
  });
  const server = createServer();
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId) return res.status(200).json({ status: "ok" });
  const transport = transports[sessionId];
  if (!transport) return res.status(404).send("Session not found");
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const transport = transports[sessionId];
  if (!transport) return res.status(404).send("Session not found");
  await transport.handleRequest(req, res);
});

app.listen(3000, () => console.log(`MCP server running on http://localhost:3000/mcp`));