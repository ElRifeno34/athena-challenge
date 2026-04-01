import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());

function createServer() {
  const server = new McpServer({ name: "vuln-explorer", version: "1.0.0" });

  server.tool(
    "get_vulnerabilities",
    "Fetches real CVE vulnerability data from NVD by keyword, severity or vendor",
    {
      keyword: z.string().describe("Search keyword e.g. microsoft, apache, linux"),
      severity: z.string().default("").describe("Filter by severity: CRITICAL, HIGH, MEDIUM, LOW or empty for all"),
    },
    async ({ keyword, severity }) => {
      try {
        let url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=10`;
        if (severity) url += `&cvssV3Severity=${severity}`;

        const response = await fetch(url, {
          headers: { "User-Agent": "athena-vuln-explorer/1.0" }
        });
        const data = await response.json();
        const vulns = data.vulnerabilities || [];

        const html = `<!DOCTYPE html>
<html>
<head>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui; padding: 16px; font-size: 13px; }
h2 { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
.row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
.btn { padding: 5px 12px; border-radius: 20px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; font-size: 12px; }
.btn.active, .btn:hover { background: #6366f1; color: white; border-color: #6366f1; }
.card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 8px; cursor: pointer; }
.card:hover { background: #f9fafb; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 8px; }
.CRITICAL { background: #fee2e2; color: #dc2626; }
.HIGH { background: #ffedd5; color: #ea580c; }
.MEDIUM { background: #fef9c3; color: #ca8a04; }
.LOW { background: #dcfce7; color: #16a34a; }
.detail { display: none; margin-top: 8px; color: #6b7280; line-height: 1.5; }
.cve-id { font-weight: 700; color: #6366f1; }
.count { color: #6b7280; font-size: 12px; margin-bottom: 8px; }
input { padding: 6px 10px; border-radius: 8px; border: 1px solid #e5e7eb; font-size: 12px; width: 150px; }
</style>
</head>
<body>
<h2>🔐 Vulnerability Explorer — ${keyword}</h2>
<div class="count">${vulns.length} CVEs found</div>
<div class="row">
  <span>Filter:</span>
  <button class="btn active" onclick="filter('ALL',this)">All</button>
  <button class="btn" onclick="filter('CRITICAL',this)">🔴 Critical</button>
  <button class="btn" onclick="filter('HIGH',this)">🟠 High</button>
  <button class="btn" onclick="filter('MEDIUM',this)">🟡 Medium</button>
  <button class="btn" onclick="filter('LOW',this)">🟢 Low</button>
  <input id="search" placeholder="Search CVE..." oninput="render()" />
</div>
<div id="list"></div>
<script>
const D = ${JSON.stringify(vulns)};
let currentFilter = 'ALL';
function getSeverity(v) {
  try { return v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity || v.cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseSeverity || 'N/A'; } catch(e) { return 'N/A'; }
}
function getScore(v) {
  try { return v.cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore || v.cve.metrics?.cvssMetricV30?.[0]?.cvssData?.baseScore || 'N/A'; } catch(e) { return 'N/A'; }
}
function filter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}
function toggle(id) {
  const el = document.getElementById('detail-'+id);
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}
function render() {
  const search = document.getElementById('search').value.toLowerCase();
  let d = [...D];
  if(currentFilter !== 'ALL') d = d.filter(v => getSeverity(v) === currentFilter);
  if(search) d = d.filter(v => v.cve.id.toLowerCase().includes(search) || (v.cve.descriptions?.[0]?.value||'').toLowerCase().includes(search));
  document.getElementById('list').innerHTML = d.map((v,i) => {
    const sev = getSeverity(v);
    const score = getScore(v);
    const desc = v.cve.descriptions?.[0]?.value || 'No description';
    const published = v.cve.published?.split('T')[0] || '';
    return \`<div class="card" onclick="toggle(\${i})">
      <div><span class="cve-id">\${v.cve.id}</span><span class="badge \${sev}">\${sev} \${score}</span><span style="float:right;color:#9ca3af">\${published}</span></div>
      <div id="detail-\${i}" class="detail">\${desc}</div>
    </div>\`;
  }).join('') || '<p style="color:#9ca3af">No results</p>';
}
render();
</script>
</body>
</html>`;

        return {
          content: [{
            type: "resource",
            resource: {
              uri: "ui://widget/vulns",
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
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => Math.random().toString(36).slice(2) });
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