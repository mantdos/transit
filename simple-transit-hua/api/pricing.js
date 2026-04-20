/**
 * 代理上游定价/标签接口，供前端同源访问以避免 CORS。
 */

const PRICING_API_URL = "https://api.redpanda-lab.xyz/api/pricing";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function setCacheHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  setCacheHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const response = await fetch(PRICING_API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      console.error("[/api/pricing] upstream failed:", response.status);
      return res.status(200).json({ ok: true, data: [] });
    }
    const payload = await response.json();
    const data = Array.isArray(payload && payload.data) ? payload.data : [];
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    console.error("[/api/pricing] request failed:", error);
    return res.status(200).json({ ok: true, data: [] });
  }
}
