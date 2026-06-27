const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);

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

const handleCheckoutSession = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }

  sendJson(res, 503, { error: "Checkout is currently disabled." });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === "/api/create-checkout-session") {
    handleCheckoutSession(req, res);
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
