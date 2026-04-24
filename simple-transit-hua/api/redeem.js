/**
 * 代理上游 https://api.redpanda-lab.xyz/api/token/redeem-coupon，
 * 以同源方式为前端提供「API Key + 兑换码」的充值能力，避免浏览器端 CORS 失败。
 *
 * 入参：POST JSON { apiKey: string, couponCode: string }
 * 出参：透传上游的 { success: boolean, message: string }
 */

const REDEEM_URL = "https://api.redpanda-lab.xyz/api/token/redeem-coupon";

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, payload) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  setCorsHeaders(res);
  res.status(status).end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  let buf;
  try {
    buf = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  } catch (e) {
    throw new Error("读取请求体失败: " + (e instanceof Error ? e.message : String(e)));
  }
  const raw = buf.toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

/**
 * 兑换码清洗：用户粘贴的可能形如 `claude-50-XXXXXXXX`，
 * 仅提取「最后一个短横线之后」的子串作为真实兑换码；若无短横线则原样返回。
 */
function sanitizeCoupon(raw) {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const idx = trimmed.lastIndexOf("-");
  return idx >= 0 ? trimmed.slice(idx + 1).trim() : trimmed;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { success: false, message: "Method Not Allowed. Use POST." });
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return json(res, 400, {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const couponRaw = typeof body.couponCode === "string" ? body.couponCode : "";
  const coupon = sanitizeCoupon(couponRaw);

  if (!apiKey) {
    return json(res, 400, { success: false, message: "缺少 API Key。" });
  }
  if (!coupon) {
    return json(res, 400, { success: false, message: "请输入兑换码。" });
  }

  try {
    const upstream = await fetch(REDEEM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ coupon_code: coupon }),
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (data && typeof data === "object") {
      const success = data.success === true;
      const message =
        typeof data.message === "string" && data.message.trim()
          ? data.message
          : success
            ? "充值成功"
            : "充值失败";
      return json(res, 200, { success, message });
    }

    return json(res, 502, {
      success: false,
      message: `上游响应异常（HTTP ${upstream.status}）`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json(res, 500, { success: false, message: "服务器内部错误：" + message });
  }
}
