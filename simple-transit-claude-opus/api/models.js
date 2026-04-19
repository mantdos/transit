const MODELS_API_URL = "https://api.opusclaw.me/v1/models";
const CLAUDE_API_KEY = "sk-wm1iXByhKnul7QrVCLqHKrjh9d3qnzHUBaC3r0FfXcVkhF8j";
const GEMINI_API_KEY = "sk-GL7sQpxh3OB9i7rhdjqqul9aw9dJFJzKKzBIMoCkPalFCSn5";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function setCacheHeaders(res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=60");
}

function normalizeModels(payload, keyword) {
  const list = Array.isArray(payload && payload.data) ? payload.data : [];
  return list
    .map((item) => (item && typeof item.id === "string" ? item.id : ""))
    .filter((id) => id && id.toLowerCase().indexOf(keyword) !== -1);
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
    const [claudeResult, geminiResult] = await Promise.allSettled([
      fetchModelsByKey(CLAUDE_API_KEY),
      fetchModelsByKey(GEMINI_API_KEY),
    ]);

    const claude = claudeResult.status === "fulfilled" ? normalizeModels(claudeResult.value, "claude") : [];
    const gemini = geminiResult.status === "fulfilled" ? normalizeModels(geminiResult.value, "gemini") : [];

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
      },
    });
  } catch (error) {
    console.error("[/api/models] request failed:", error);
    return res.status(200).json({
      ok: true,
      data: {
        claude: [],
        gemini: [],
      },
    });
  }
}
