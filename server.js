const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Stripe = require("stripe");

const root = __dirname;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const products = {
  "frame-clutch-black-vine": {
    name: "Black Floral Frame Clutch",
    unitAmount: 8000,
    imagePath: "/assets/images/frame-clutch-black-vine.jpeg",
  },
  "frame-clutch-white-gold": {
    name: "White Gold Frame Clutch",
    unitAmount: 8000,
    imagePath: "/assets/images/frame-clutch-white-gold.jpeg",
  },
  "frame-clutch-black-gold": {
    name: "Black Gold Floral Frame Clutch",
    unitAmount: 3000,
    imagePath: "/assets/images/frame-clutch-black-gold.jpeg",
  },
  "frame-clutch-blue-bunny": {
    name: "Blue Bunny Frame Clutch",
    unitAmount: 2000,
    imagePath: "/assets/images/frame-clutch-blue-bunny.jpeg",
  },
  "frame-clutch-color-stripe": {
    name: "Color Stripe Frame Clutch",
    unitAmount: 3000,
    imagePath: "/assets/images/frame-clutch-color-stripe.jpeg",
  },
  "frame-clutch-floral-stripe": {
    name: "Floral Stripe Frame Clutch",
    unitAmount: 3500,
    imagePath: "/assets/images/frame-clutch-floral-stripe.jpeg",
  },
  "frame-clutch-mint-flower": {
    name: "Mint Floral Frame Clutch",
    unitAmount: 3000,
    imagePath: "/assets/images/frame-clutch-mint-flower.jpeg",
  },
  "diamond-painting-purple-flowers": {
    name: "Diamond Painting - Purple Flowers",
    unitAmount: 30000,
    imagePath: "/assets/images/diamond-painting-purple-flowers.png",
  },
  "diamond-painting-colorful-floral": {
    name: "Diamond Painting - Colorful Floral",
    unitAmount: 30000,
    imagePath: "/assets/images/diamond-painting-colorful-floral.png",
  },
  "diamond-painting-framed-portrait": {
    name: "Diamond Painting - Framed Portrait",
    unitAmount: 20000,
    imagePath: "/assets/images/diamond-painting-framed-portrait.png",
  },
  "diamond-painting-bunny": {
    name: "Diamond Painting - Starry Bunny",
    unitAmount: 20000,
    imagePath: "/assets/images/diamond-painting-bunny.png",
  },
  "beaded-sculpture-green-tree": {
    name: "Beaded Tree Sculpture",
    unitAmount: 10000,
    imagePath: "/assets/images/beaded-sculpture-green-tree.png",
  },
  "beaded-sculpture-red-fruit": {
    name: "Beaded Fruit Sculpture",
    unitAmount: 7000,
    imagePath: "/assets/images/beaded-sculpture-red-fruit.png",
  },
  "beaded-sculpture-yellow-flowers": {
    name: "Beaded Yellow Flower Sculpture",
    unitAmount: 10000,
    imagePath: "/assets/images/beaded-sculpture-yellow-flowers.png",
  },
  "beaded-sculpture-yellow-basket": {
    name: "Beaded Flower Basket",
    unitAmount: 8000,
    imagePath: "/assets/images/beaded-sculpture-yellow-basket.png",
  },
  "beaded-bracelet-shell-strand-white": {
    name: "White Tagua Nut Beaded Bracelet",
    unitAmount: 8000,
    imagePath: "/assets/images/beaded-bracelet-shell-strand-white.jpeg",
  },
  "beaded-bracelet-shell-strand-gold": {
    name: "Gold Shell Beaded Bracelet",
    unitAmount: 8000,
    imagePath: "/assets/images/beaded-bracelet-shell-strand-gold.jpeg",
  },
  "beaded-bracelet-shell-strand-natural": {
    name: "Natural Shell Beaded Bracelet",
    unitAmount: 8000,
    imagePath: "/assets/images/beaded-bracelet-shell-strand-natural.jpeg",
  },
  "beaded-bracelet-shell-loop": {
    name: "Looped Shell Beaded Bracelet",
    unitAmount: 8000,
    imagePath: "/assets/images/beaded-bracelet-shell-loop.jpeg",
  },
};

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
  ".webp": "image/webp",
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
    if (body.length > 100_000) {
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

const getRequestOrigin = (req) => {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  return `${protocol}://${host}`;
};

const handleCheckoutSession = async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end("Method Not Allowed");
    return;
  }

  if (!stripe) {
    sendJson(res, 500, { error: "Stripe is not configured. Add STRIPE_SECRET_KEY in Railway variables." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const lineItems = items.map((item) => {
      const product = products[item.id];
      const quantity = Math.max(1, Math.min(99, Number.parseInt(item.quantity, 10) || 1));

      if (!product) {
        throw new Error("One or more cart items are no longer available.");
      }

      return {
        quantity,
        price_data: {
          currency: "usd",
          unit_amount: product.unitAmount,
          product_data: {
            name: product.name,
            images: [`${getRequestOrigin(req)}${product.imagePath}`],
          },
        },
      };
    });

    if (lineItems.length === 0) {
      sendJson(res, 400, { error: "Your cart is empty." });
      return;
    }

    const origin = getRequestOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      billing_address_collection: "auto",
      shipping_address_collection: {
        allowed_countries: ["CN", "US"],
      },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled#cart`,
    });

    sendJson(res, 200, { url: session.url });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Unable to start checkout." });
  }
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
