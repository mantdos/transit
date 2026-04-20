/**
 * 聚合上游 https://api.redpanda-lab.xyz/v1/models，按渠道 Key 分类返回模型 id 列表。
 */

const MODELS_API_URL = "https://api.redpanda-lab.xyz/v1/models";

const CODEX_API_KEY = "sk-c8I5x26EICr1wTj0C6BMJO6exHLps80N7szOsSXTxbQ0fpEQ";
const CLAUDE_API_KEY = "sk-JyX6iM0qDRhuELxG25VwGd1EonlrB06VyjeV4I4N217YI8Ci";
const GEMINI_API_KEY = "sk-8h575vqxTlZ41Nw6PXON9wbqPfn8KGIorywmOJtuUKwz0iBi";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function setCacheHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
}

function normalizeIds(payload, kind) {
  const list = Array.isArray(payload && payload.data) ? payload.data : [];
  const raw = list
    .map((item) => (item && typeof item.id === "string" ? item.id : ""))
    .filter(Boolean);

  const filtered = raw.filter((id) => {
    const x = id.toLowerCase();
    if (kind === "claude") return x.includes("claude");
    if (kind === "gemini") return x.includes("gemini");
    if (kind === "codex") {
      return x.includes("gpt") || /^o[0-9]/.test(x) || x.includes("codex") || x.includes("davinci");
    }
    return false;
  });
  return filtered.length ? filtered : raw;
}

async function fetchModelsByKey(apiKey) {
  const response = await fetch(MODELS_API_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Upstream request failed with status ${response.status}`);
  }
  return response.json();
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
    const [codexResult, claudeResult, geminiResult] = await Promise.allSettled([
      fetchModelsByKey(CODEX_API_KEY),
      fetchModelsByKey(CLAUDE_API_KEY),
      fetchModelsByKey(GEMINI_API_KEY),
    ]);

    const codex = codexResult.status === "fulfilled" ? normalizeIds(codexResult.value, "codex") : [];
    const claude = claudeResult.status === "fulfilled" ? normalizeIds(claudeResult.value, "claude") : [];
    const gemini = geminiResult.status === "fulfilled" ? normalizeIds(geminiResult.value, "gemini") : [];

    if (codexResult.status === "rejected") {
      console.error("[/api/models] codex upstream failed:", codexResult.reason);
    }
    if (claudeResult.status === "rejected") {
      console.error("[/api/models] claude upstream failed:", claudeResult.reason);
    }
    if (geminiResult.status === "rejected") {
      console.error("[/api/models] gemini upstream failed:", geminiResult.reason);
    }

    return res.status(200).json({
      ok: true,
      data: {
        claude,
        gemini,
        codex,
      },
    });
  } catch (error) {
    console.error("[/api/models] request failed:", error);
    return res.status(200).json({
      ok: true,
      data: {
        claude: [],
        gemini: [],
        codex: [],
      },
    });
  }
}
