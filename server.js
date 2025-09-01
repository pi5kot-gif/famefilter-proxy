// server.js
import express from "express";
import cors from "cors";

// Použij globální fetch (Node 18+). Pokud běží starší Node, odkomentuj řádek níž:
// import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ----- CORS -----
app.use(cors({
  origin: "*",
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"]
}));
app.options("*", cors());

// ----- jednoduchá in-memory cache (TTL v ms) -----
const CACHE_TTL = parseInt(process.env.CACHE_TTL ?? "120000", 10); // default 120 s
const cache = new Map(); // key: url, value: { exp:number, ct:string, body:string }

function setCache(url, ct, body){
  cache.set(url, { exp: Date.now() + CACHE_TTL, ct, body });
}
function getCache(url){
  const hit = cache.get(url);
  if (!hit) return null;
  if (Date.now() > hit.exp){ cache.delete(url); return null; }
  return hit;
}

// ----- helper: validace URL -----
function isAllowedUrl(u){
  try{
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }catch{ return false; }
}

// ----- PROXY: /proxy?url=ENCODED_URL -----
app.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "Missing url param" });
    if (!isAllowedUrl(url)) return res.status(400).json({ error: "Invalid url" });

    // cache check
    const cached = getCache(url);
    if (cached){
      res.setHeader("Content-Type", cached.ct);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("X-From-Cache", "1");
      return res.status(200).send(cached.body);
    }

    // Timeout – rychlé selhání pro lepší UX
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);

    const upstream = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Přátelštější k RSS endpointům
        "User-Agent": "FameFilterProxy/1.0 (+https://famefilter.com)",
        "Accept": "application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8"
      },
      cache: "no-store"
    });
    clearTimeout(t);

    if (!upstream.ok) {
      return res.status(502).json({ error: "Upstream fetch failed", status: upstream.status });
    }

    const ct = upstream.headers.get("content-type") || "text/xml; charset=utf-8";
    const body = await upstream.text();

    // ulož do cache
    setCache(url, ct, body);

    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-From-Cache", "0");
    return res.status(200).send(body);

  } catch (e) {
    return res.status(500).json({ error: "Proxy error", detail: String(e) });
  }
});

// healthcheck
app.get("/", (_req, res) => {
  res.type("text/plain").send("FameFilter Proxy OK");
});

app.listen(PORT, () => {
  console.log(`Proxy listening on :${PORT}`);
});
