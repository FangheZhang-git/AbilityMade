const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const purchaseRequestTo = process.env.PURCHASE_REQUEST_TO || "AbilityMade@gmail.com";
const purchaseRequestFrom = process.env.PURCHASE_REQUEST_FROM || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const newsletterSegmentId = process.env.RESEND_NEWSLETTER_SEGMENT_ID || "";
const newsletterRateLimitWindowMs = 60 * 60 * 1000;
const newsletterRateLimitMax = 10;
const newsletterAttempts = new Map();

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

const getFilePath = (requestUrl) => {
  const url = new URL(requestUrl, `http://localhost:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    return null;
  }

  return filePath;
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100000) {
      req.destroy();
      reject(new Error("Request body is too large."));
    }
  });

  req.on("end", () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch {
      reject(new Error("Invalid JSON request body."));
    }
  });

  req.on("error", reject);
});

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const cleanText = (value, fallback = "") => String(value || fallback).trim().slice(0, 500);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase().slice(0, 254);

const isValidEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const getClientAddress = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
  return String(forwardedAddress || req.socket.remoteAddress || "unknown").trim().slice(0, 100);
};

const isNewsletterRateLimited = (req) => {
  const now = Date.now();

  if (newsletterAttempts.size > 1000) {
    newsletterAttempts.forEach((attempt, address) => {
      if (attempt.resetAt <= now) newsletterAttempts.delete(address);
    });
    if (newsletterAttempts.size > 2000) newsletterAttempts.clear();
  }

  const address = getClientAddress(req);
  const existingAttempt = newsletterAttempts.get(address);
  const attempt = !existingAttempt || existingAttempt.resetAt <= now
    ? { count: 0, resetAt: now + newsletterRateLimitWindowMs }
    : existingAttempt;

  attempt.count += 1;
  newsletterAttempts.set(address, attempt);

  return attempt.count > newsletterRateLimitMax;
};

const resendRequest = async (pathname, options = {}) => fetch(`https://api.resend.com${pathname}`, {
  ...options,
  headers: {
    Authorization: `Bearer ${resendApiKey}`,
    "Content-Type": "application/json",
    ...options.headers,
  },
});

const getProviderError = async (response) => {
  try {
    return await response.text();
  } catch {
    return "Could not read provider response.";
  }
};

const getNewsletterSubscriberEmail = (language) => {
  if (language === "zh-CN") {
    return {
      subject: "你已成功订阅 AbilityMade",
      text: [
        "你已成功订阅 AbilityMade",
        "",
        "感谢你订阅 AbilityMade 邮件。我们会不定期向你发送最新消息、新品和推广活动。",
        "",
        "访问 AbilityMade：https://abilitymade.net",
        "",
        `如果这不是你的操作，请联系 ${purchaseRequestTo}。`,
      ].join("\n"),
      html: `
        <h1>你已成功订阅 AbilityMade</h1>
        <p>感谢你订阅 AbilityMade 邮件。我们会不定期向你发送最新消息、新品和推广活动。</p>
        <p><a href="https://abilitymade.net">访问 AbilityMade</a></p>
        <p>如果这不是你的操作，请联系 <a href="mailto:${escapeHtml(purchaseRequestTo)}">${escapeHtml(purchaseRequestTo)}</a>。</p>
      `,
    };
  }

  return {
    subject: "You’re subscribed to AbilityMade",
    text: [
      "You’re subscribed to AbilityMade",
      "",
      "Thank you for subscribing to the AbilityMade newsletter. We’ll send you occasional news, new products, and promotions.",
      "",
      "Visit AbilityMade: https://abilitymade.net",
      "",
      `If you did not make this request, please contact ${purchaseRequestTo}.`,
    ].join("\n"),
    html: `
      <h1>You’re subscribed to AbilityMade</h1>
      <p>Thank you for subscribing to the AbilityMade newsletter. We’ll send you occasional news, new products, and promotions.</p>
      <p><a href="https://abilitymade.net">Visit AbilityMade</a></p>
      <p>If you did not make this request, please contact <a href="mailto:${escapeHtml(purchaseRequestTo)}">${escapeHtml(purchaseRequestTo)}</a>.</p>
    `,
  };
};

const getNewsletterHostEmail = ({ email, language, subscribedAt }) => {
  const pageLanguage = language === "zh-CN" ? "Chinese (zh-CN)" : "English (en)";
  const safeEmail = escapeHtml(email);

  return {
    subject: "New AbilityMade newsletter subscriber",
    text: [
      "New AbilityMade newsletter subscriber",
      "",
      `Email: ${email}`,
      `Signup page: ${pageLanguage}`,
      `Signup time: ${subscribedAt}`,
    ].join("\n"),
    html: `
      <h1>New AbilityMade newsletter subscriber</h1>
      <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
      <p><strong>Signup page:</strong> ${pageLanguage}</p>
      <p><strong>Signup time:</strong> ${escapeHtml(subscribedAt)}</p>
    `,
  };
};

const sendNewsletterEmail = async (label, payload) => {
  try {
    const response = await resendRequest("/emails", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Email provider rejected ${label}:`, await getProviderError(response));
    }
  } catch (error) {
    console.error(`Could not send ${label}:`, error);
  }
};

const sendNewsletterConfirmations = async ({ email, language }) => {
  if (!purchaseRequestFrom) {
    console.error("Could not send newsletter confirmations: PURCHASE_REQUEST_FROM is not configured.");
    return;
  }

  const subscriberEmail = getNewsletterSubscriberEmail(language);
  const hostEmail = getNewsletterHostEmail({
    email,
    language,
    subscribedAt: new Date().toISOString(),
  });

  await Promise.all([
    sendNewsletterEmail("newsletter subscriber confirmation", {
      from: purchaseRequestFrom,
      to: [email],
      reply_to: purchaseRequestTo,
      ...subscriberEmail,
    }),
    sendNewsletterEmail("newsletter host notification", {
      from: purchaseRequestFrom,
      to: [purchaseRequestTo],
      reply_to: email,
      ...hostEmail,
    }),
  ]);
};

const getPurchaseRequestEmail = ({ firstName, lastName, email, items, subtotal }) => {
  const safeItems = Array.isArray(items) ? items.slice(0, 50) : [];
  const itemLines = safeItems.length
    ? safeItems.map((item) => {
      const title = cleanText(item.title, "AbilityMade product");
      const quantity = Number.parseInt(item.quantity, 10) || 1;
      const price = cleanText(item.price, "$0.00");
      return `- ${title} x ${quantity} (${price})`;
    }).join("\n")
    : "- Cart details were not available.";
  const itemRows = safeItems.length
    ? safeItems.map((item) => {
      const title = escapeHtml(cleanText(item.title, "AbilityMade product"));
      const quantity = Number.parseInt(item.quantity, 10) || 1;
      const price = escapeHtml(cleanText(item.price, "$0.00"));
      return `<tr><td>${title}</td><td>${quantity}</td><td>${price}</td></tr>`;
    }).join("")
    : "<tr><td colspan=\"3\">Cart details were not available.</td></tr>";
  const text = [
    "New AbilityMade purchase request",
    "",
    `Name: ${firstName} ${lastName}`,
    `Email: ${email}`,
    "",
    "Cart:",
    itemLines,
    "",
    `Subtotal: ${subtotal}`,
  ].join("\n");
  const html = `
    <h1>New AbilityMade purchase request</h1>
    <p><strong>Name:</strong> ${escapeHtml(`${firstName} ${lastName}`)}</p>
    <p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>
    <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;">
      <thead>
        <tr><th align="left">Product</th><th align="left">Quantity</th><th align="left">Price</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p><strong>Subtotal:</strong> ${escapeHtml(subtotal)}</p>
  `;

  return { text, html };
};

const handleCheckoutSession = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }

  sendJson(res, 503, { error: "Checkout is currently disabled." });
};

const handlePurchaseRequest = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }

  let request;

  try {
    request = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const firstName = cleanText(request.firstName);
  const lastName = cleanText(request.lastName);
  const email = cleanText(request.email);
  const subtotal = cleanText(request.subtotal, "$0.00");

  if (!firstName || !lastName || !email || !email.includes("@")) {
    sendJson(res, 400, { error: "Please provide a first name, last name, and valid email address." });
    return;
  }

  if (!resendApiKey || !purchaseRequestFrom) {
    sendJson(res, 503, { error: "Email service is not configured yet." });
    return;
  }

  const { text, html } = getPurchaseRequestEmail({
    firstName,
    lastName,
    email,
    items: request.items,
    subtotal,
  });

  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: purchaseRequestFrom,
        to: [purchaseRequestTo],
        reply_to: email,
        subject: `AbilityMade purchase request from ${firstName} ${lastName}`,
        text,
        html,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Email provider rejected purchase request:", errorText);
      sendJson(res, 502, { error: "Email provider rejected the request." });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Could not send purchase request email:", error);
    sendJson(res, 502, { error: "Could not send the purchase request email." });
  }
};

const handleNewsletterSubscribe = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }

  if (isNewsletterRateLimited(req)) {
    res.setHeader("Retry-After", String(newsletterRateLimitWindowMs / 1000));
    sendJson(res, 429, { error: "rate_limited" });
    return;
  }

  let request;

  try {
    request = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }

  if (cleanText(request.website)) {
    sendJson(res, 200, { ok: true });
    return;
  }

  const email = normalizeEmail(request.email);
  if (!isValidEmail(email)) {
    sendJson(res, 400, { error: "invalid_email" });
    return;
  }

  const requestedLanguage = cleanText(request.language);
  if (requestedLanguage && !["en", "zh-CN"].includes(requestedLanguage)) {
    sendJson(res, 400, { error: "invalid_request" });
    return;
  }
  const language = requestedLanguage || "en";

  if (!resendApiKey || !newsletterSegmentId) {
    sendJson(res, 503, { error: "newsletter_unavailable" });
    return;
  }

  try {
    const createResponse = await resendRequest("/contacts", {
      method: "POST",
      body: JSON.stringify({
        email,
        unsubscribed: false,
        segments: [{ id: newsletterSegmentId }],
      }),
    });

    if (!createResponse.ok) {
      const createError = await getProviderError(createResponse);
      const contactAlreadyExists = createResponse.status === 409
        || (createResponse.status === 422 && /already exists/i.test(createError));

      if (!contactAlreadyExists) {
        console.error("Email provider rejected newsletter subscription:", createError);
        sendJson(res, 502, { error: "provider_error" });
        return;
      }

      const encodedEmail = encodeURIComponent(email);
      const encodedSegmentId = encodeURIComponent(newsletterSegmentId);
      const updateResponse = await resendRequest(`/contacts/${encodedEmail}`, {
        method: "PATCH",
        body: JSON.stringify({ unsubscribed: false }),
      });

      if (!updateResponse.ok) {
        console.error("Could not restore newsletter subscription:", await getProviderError(updateResponse));
        sendJson(res, 502, { error: "provider_error" });
        return;
      }

      const segmentResponse = await resendRequest(`/contacts/${encodedEmail}/segments/${encodedSegmentId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (!segmentResponse.ok) {
        const segmentError = await getProviderError(segmentResponse);
        const alreadyInSegment = [409, 422].includes(segmentResponse.status) && /already|exists|member/i.test(segmentError);

        if (!alreadyInSegment) {
          console.error("Could not add newsletter contact to segment:", segmentError);
          sendJson(res, 502, { error: "provider_error" });
          return;
        }
      }
    }

    await sendNewsletterConfirmations({ email, language });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("Could not save newsletter subscription:", error);
    sendJson(res, 502, { error: "provider_error" });
  }
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/api/create-checkout-session") {
    handleCheckoutSession(req, res);
    return;
  }

  if (url.pathname === "/api/purchase-request") {
    handlePurchaseRequest(req, res);
    return;
  }

  if (url.pathname === "/api/newsletter-subscribe") {
    handleNewsletterSubscribe(req, res);
    return;
  }

  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  const filePath = getFilePath(req.url);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    const resolvedPath = !statError && stats.isDirectory()
      ? path.join(filePath, "index.html")
      : filePath;

    fs.readFile(resolvedPath, (readError, data) => {
      if (readError) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      const contentType = contentTypes[path.extname(resolvedPath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, {
        "Cache-Control": "public, max-age=300",
        "Content-Type": contentType,
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      res.end(data);
    });
  });
});

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`AbilityMade is running on port ${port}`);
  });
}

module.exports = { newsletterAttempts, server };
