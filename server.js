import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // povolíme CORS pro frontend

// Jednoduchá proxy: /proxy?url=ENCODED_URL
app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing url param" });

    // Timeout (rychlejší failover)
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);

    const upstream = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
    clearTimeout(t);

    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream fetch failed", status: upstream.status });
    }

    const ct = upstream.headers.get("content-type") || "text/xml; charset=utf-8";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=60");

    const text = await upstream.text();
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: "Proxy error", detail: String(e) });
  }
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("FameFilter Proxy OK");
});

app.listen(PORT, () => console.log(`Proxy listening on :${PORT}`));
