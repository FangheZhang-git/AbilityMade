const express = require("express");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const port = process.env.PORT || 3000;
const publicRoot = __dirname;

const SHIPPING_THRESHOLD_CENTS = 12000;
const STANDARD_SHIPPING_CENTS = 900;

const products = {
  "frame-clutch-black-vine": {
    name: "Ceramic Mug - Emerald Hill",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_BLACK_VINE",
  },
  "frame-clutch-white-gold": {
    name: "Ceramic Mug - Baba House",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_WHITE_GOLD",
  },
  "frame-clutch-black-gold": {
    name: "Ceramic Mug - Singapore City",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_BLACK_GOLD",
  },
  "frame-clutch-blue-bunny": {
    name: "Thermal Tumblers - Joy",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_BLUE_BUNNY",
  },
  "frame-clutch-color-stripe": {
    name: "Thermal Tumblers - Yellow Orchid",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_COLOR_STRIPE",
  },
  "frame-clutch-floral-stripe": {
    name: "Thermal Tumblers - Whale Family",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_FLORAL_STRIPE",
  },
  "frame-clutch-mint-flower": {
    name: "Thermal Tumblers - Floral Bloom",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_FRAME_CLUTCH_MINT_FLOWER",
  },
  "diamond-painting-purple-flowers": {
    name: "Diamond Painting - Purple Flowers",
    amount: 4500,
    priceEnv: "STRIPE_PRICE_DIAMOND_PAINTING_PURPLE_FLOWERS",
  },
  "diamond-painting-colorful-floral": {
    name: "Diamond Painting - Colorful Floral",
    amount: 4500,
    priceEnv: "STRIPE_PRICE_DIAMOND_PAINTING_COLORFUL_FLORAL",
  },
  "diamond-painting-framed-portrait": {
    name: "Diamond Painting - Framed Portrait",
    amount: 4500,
    priceEnv: "STRIPE_PRICE_DIAMOND_PAINTING_FRAMED_PORTRAIT",
  },
  "diamond-painting-starry-bunny": {
    name: "Diamond Painting - Starry Bunny",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_DIAMOND_PAINTING_STARRY_BUNNY",
  },
  "beaded-sculpture-green-tree": {
    name: "Ceramic Mug - Emerald Hill",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_SCULPTURE_GREEN_TREE",
  },
  "beaded-sculpture-red-fruit": {
    name: "Ceramic Mug - Baba House",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_SCULPTURE_RED_FRUIT",
  },
  "beaded-sculpture-yellow-flowers": {
    name: "Ceramic Mug - Singapore City",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_SCULPTURE_YELLOW_FLOWERS",
  },
  "beaded-sculpture-yellow-basket": {
    name: "Thermal Tumblers - Joy",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_BEADED_SCULPTURE_YELLOW_BASKET",
  },
  "beaded-bracelet-shell-strand-white": {
    name: "Ceramic Mug - Emerald Hill",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_BRACELET_SHELL_STRAND_WHITE",
  },
  "beaded-bracelet-shell-strand-gold": {
    name: "Ceramic Mug - Baba House",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_BRACELET_SHELL_STRAND_GOLD",
  },
  "beaded-bracelet-shell-strand-natural": {
    name: "Ceramic Mug - Singapore City",
    amount: 2200,
    priceEnv: "STRIPE_PRICE_BEADED_BRACELET_SHELL_STRAND_NATURAL",
  },
  "beaded-bracelet-shell-loop": {
    name: "Thermal Tumblers - Joy",
    amount: 3200,
    priceEnv: "STRIPE_PRICE_BEADED_BRACELET_SHELL_LOOP",
  },
};

const getOrigin = (request) => {
  if (process.env.PUBLIC_SITE_URL) {
    return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  const protocol = request.headers["x-forwarded-proto"] || request.protocol || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  return `${protocol}://${host}`;
};

app.use(express.json({ limit: "20kb" }));

app.post("/api/create-checkout-session", async (request, response) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return response.status(500).json({ error: "Stripe secret key is not configured." });
  }

  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  if (items.length === 0) {
    return response.status(400).json({ error: "Cart is empty." });
  }

  const normalizedItems = [];
  for (const item of items) {
    const product = products[item.id];
    const quantity = Number.parseInt(item.quantity, 10);

    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return response.status(400).json({ error: "Cart contains an invalid item." });
    }

    const price = process.env[product.priceEnv];
    if (!price || price === "price_replace_me") {
      return response.status(500).json({ error: `${product.name} is missing a Stripe Price ID.` });
    }

    normalizedItems.push({
      id: item.id,
      product,
      quantity,
      price,
    });
  }

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.product.amount * item.quantity, 0);
  const origin = getOrigin(request);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: normalizedItems.map((item) => ({
        price: item.price,
        quantity: item.quantity,
      })),
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      shipping_options: [
        subtotal >= SHIPPING_THRESHOLD_CENTS
          ? {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: 0, currency: "usd" },
              display_name: "Free standard US shipping",
              delivery_estimate: {
                minimum: { unit: "business_day", value: 3 },
                maximum: { unit: "business_day", value: 7 },
              },
            },
          }
          : {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: STANDARD_SHIPPING_CENTS, currency: "usd" },
              display_name: "Standard US shipping",
              delivery_estimate: {
                minimum: { unit: "business_day", value: 3 },
                maximum: { unit: "business_day", value: 7 },
              },
            },
          },
      ],
      metadata: {
        cart: JSON.stringify(normalizedItems.map((item) => ({ id: item.id, quantity: item.quantity }))),
      },
      success_url: `${origin}/index.html?checkout=success`,
      cancel_url: `${origin}/index.html?checkout=cancelled#cart`,
    });

    return response.json({ url: session.url });
  } catch (error) {
    return response.status(500).json({ error: error.message || "Unable to create checkout session." });
  }
});

app.use(express.static(publicRoot, {
  extensions: ["html"],
  index: "index.html",
}));

app.get("/", (request, response) => {
  response.sendFile(path.join(publicRoot, "index.html"));
});

app.listen(port, () => {
  console.log(`AbilityMade storefront running on port ${port}`);
});
