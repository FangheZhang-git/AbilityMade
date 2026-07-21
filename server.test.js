const assert = require("node:assert/strict");
const http = require("node:http");
const { after, afterEach, before, test } = require("node:test");

process.env.RESEND_API_KEY = "test-api-key";
process.env.RESEND_NEWSLETTER_SEGMENT_ID = "test-segment-id";
process.env.PURCHASE_REQUEST_FROM = "AbilityMade <newsletter@example.com>";
process.env.PURCHASE_REQUEST_TO = "AbilityMade@gmail.com";

const originalFetch = global.fetch;
const originalConsoleError = console.error;
const { newsletterAttempts, server } = require("./server");

let serverPort;

const jsonResponse = (status, body = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const postNewsletter = (body) => new Promise((resolve, reject) => {
  const request = http.request({
    hostname: "127.0.0.1",
    port: serverPort,
    path: "/api/newsletter-subscribe",
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }, (response) => {
    let responseBody = "";
    response.on("data", (chunk) => { responseBody += chunk; });
    response.on("end", () => resolve({
      status: response.statusCode,
      body: JSON.parse(responseBody),
    }));
  });

  request.on("error", reject);
  request.end(JSON.stringify(body));
});

const getResource = (pathname) => new Promise((resolve, reject) => {
  const request = http.get({
    hostname: "127.0.0.1",
    port: serverPort,
    path: pathname,
  }, (response) => {
    response.resume();
    response.on("end", () => resolve({
      status: response.statusCode,
      contentType: response.headers["content-type"],
    }));
  });

  request.on("error", reject);
});

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  serverPort = server.address().port;
});

afterEach(() => {
  global.fetch = originalFetch;
  console.error = originalConsoleError;
  newsletterAttempts.clear();
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("saves a new contact and sends both English confirmation emails", { concurrency: false }, async () => {
  const providerCalls = [];
  global.fetch = async (url, options) => {
    providerCalls.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse(200, { id: "provider-id" });
  };

  const response = await postNewsletter({
    email: "Subscriber@Example.com",
    language: "en",
    website: "",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });

  const contactCall = providerCalls.find((call) => call.url.endsWith("/contacts"));
  assert.equal(contactCall.body.email, "subscriber@example.com");
  assert.deepEqual(contactCall.body.segments, [{ id: "test-segment-id" }]);

  const emailCalls = providerCalls.filter((call) => call.url.endsWith("/emails"));
  assert.equal(emailCalls.length, 2);
  const subscriberEmail = emailCalls.find((call) => call.body.to.includes("subscriber@example.com"));
  const hostEmail = emailCalls.find((call) => call.body.to.includes("AbilityMade@gmail.com"));
  assert.equal(subscriberEmail.body.subject, "You’re subscribed to AbilityMade");
  assert.equal(subscriberEmail.body.reply_to, "AbilityMade@gmail.com");
  assert.equal(hostEmail.body.subject, "New AbilityMade newsletter subscriber");
  assert.equal(hostEmail.body.reply_to, "subscriber@example.com");
  assert.match(hostEmail.body.text, /subscriber@example\.com/);
  assert.match(hostEmail.body.text, /English \(en\)/);
});

test("restores an existing contact and sends Chinese confirmations again", { concurrency: false }, async () => {
  const providerCalls = [];
  global.fetch = async (url, options) => {
    const call = { url, options, body: JSON.parse(options.body) };
    providerCalls.push(call);
    if (url.endsWith("/contacts") && options.method === "POST") {
      return new Response("Contact already exists", { status: 422 });
    }
    return jsonResponse(200, { id: "provider-id" });
  };

  const response = await postNewsletter({
    email: "repeat@example.com",
    language: "zh-CN",
    website: "",
  });

  assert.equal(response.status, 200);
  assert.equal(providerCalls.some((call) => call.options.method === "PATCH" && call.body.unsubscribed === false), true);
  assert.equal(providerCalls.some((call) => call.url.includes("/segments/test-segment-id")), true);

  const emailCalls = providerCalls.filter((call) => call.url.endsWith("/emails"));
  assert.equal(emailCalls.length, 2);
  const subscriberEmail = emailCalls.find((call) => call.body.to.includes("repeat@example.com"));
  const hostEmail = emailCalls.find((call) => call.body.to.includes("AbilityMade@gmail.com"));
  assert.equal(subscriberEmail.body.subject, "你已成功订阅 AbilityMade");
  assert.match(hostEmail.body.text, /Chinese \(zh-CN\)/);
});

test("keeps signup successful when confirmation delivery fails", { concurrency: false }, async () => {
  const loggedErrors = [];
  console.error = (...values) => loggedErrors.push(values.join(" "));
  global.fetch = async (url) => {
    if (url.endsWith("/contacts")) return jsonResponse(200, { id: "contact-id" });
    return new Response("Temporary email failure", { status: 500 });
  };

  const response = await postNewsletter({
    email: "saved@example.com",
    language: "en",
    website: "",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(loggedErrors.length, 2);
  assert.equal(loggedErrors.every((message) => message.includes("Temporary email failure")), true);
});

test("rejects an unsupported language before contacting Resend", { concurrency: false }, async () => {
  let providerCalled = false;
  global.fetch = async () => {
    providerCalled = true;
    return jsonResponse(200);
  };

  const response = await postNewsletter({
    email: "valid@example.com",
    language: "fr",
    website: "",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "invalid_request" });
  assert.equal(providerCalled, false);
});

test("serves the root favicon with an icon content type", { concurrency: false }, async () => {
  const response = await getResource("/favicon.ico");

  assert.equal(response.status, 200);
  assert.equal(response.contentType, "image/x-icon");
});
