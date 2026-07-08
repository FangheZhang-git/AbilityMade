const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const purchaseRequestTo = process.env.PURCHASE_REQUEST_TO || "AbilityMade@gmail.com";
const purchaseRequestFrom = process.env.PURCHASE_REQUEST_FROM || "";
const resendApiKey = process.env.RESEND_API_KEY || "";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
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

server.listen(port, "0.0.0.0", () => {
  console.log(`AbilityMade is running on port ${port}`);
});
