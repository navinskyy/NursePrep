import puppeteer from "puppeteer";

const BASE_URL = "http://localhost:5173";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const results = [];

async function testPage(browser, path, name, options = {}) {
  const { reducedMotion = false, expectRedirect = false, expectAuthRedirect = false } = options;
  const label = `${name}${reducedMotion ? " (reduced-motion)" : ""}`;

  const page = await browser.newPage();
  const consoleMessages = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error" || type === "warning" || type === "log") {
      consoleMessages.push({ type, text });
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  if (reducedMotion) {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  } else {
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  }

  try {
    const url = `${BASE_URL}/${path}`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 15000 });
    await wait(1500);

    const currentUrl = page.url();
    const title = await page.title();

    const hasPageErrors = pageErrors.length > 0;
    const hasConsoleErrors = consoleMessages.some((m) => m.type === "error");
    const consoleWarnings = consoleMessages.filter((m) => m.type === "warning");
    const redirected = currentUrl.includes("login.html");

    const passed = !hasPageErrors && !hasConsoleErrors;
    results.push({ label, passed, redirected, hasPageErrors, hasConsoleErrors, pageErrors, consoleMessages });

    const status = passed ? "PASS" : "FAIL";
    const warnCount = consoleWarnings.length;
    console.log(`  ${label}: ${status} | errors: ${pageErrors.length} | console errors: ${consoleMessages.filter(m => m.type === "error").length} | warnings: ${warnCount} | redirected: ${redirected}`);

  } catch (e) {
    results.push({ label, passed: false, error: e.message });
    console.log(`  ${label}: FAIL - ${e.message}`);
  } finally {
    await page.close();
  }
}

async function testAnimationPage(browser) {
  const page = await browser.newPage();
  const animationResults = [];

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "log" && text.startsWith("[")) {
      animationResults.push(text);
    }
  });

  page.on("pageerror", (err) => {
    animationResults.push(`[FAIL] pageerror: ${err.message}`);
  });

  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await page.goto(`${BASE_URL}/qa-animation.html`, { waitUntil: "networkidle0", timeout: 15000 });
  await wait(1000);

  // Click each test button and wait for animations
  await page.click('#scaleProgress button');
  await wait(500);
  await page.click('#flipTest button');
  await wait(600);
  await page.click('#staggerTest button');
  await wait(400);
  await page.click('#confettiTest button');
  await wait(5000);

  const timerResults = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("Timer") || text.includes("Phase")) {
      timerResults.push(text);
    }
  });

  await page.click('#timerTest button');
  await wait(6000);

  const timerPassed = timerResults.some((r) => r.includes("PASS")) && timerResults.some((r) => r.includes("onTimeout"));

  const allPassed = animationResults.every((r) => !r.includes("FAIL"));
  console.log(`  Animation Tests: ${allPassed ? "PASS" : "FAIL"}`);
  if (!allPassed) {
    animationResults.forEach((r) => console.log(`    ${r}`));
  } else {
    animationResults.forEach((r) => console.log(`    ${r}`));
  }

  results.push({ label: "Animation Tests", passed: allPassed, details: animationResults });
  console.log(`  Timer Tests: ${timerPassed ? "PASS" : "FAIL"}`);
  timerResults.forEach((r) => console.log(`    ${r}`));
  results.push({ label: "Timer Tests", passed: timerPassed, details: timerResults });
  await page.close();
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  console.log("=== Puppeteer QA — NursePrep Anime.js Integration ===\n");

  // Public pages (no auth required)
  console.log("Public Pages:");
  await testPage(browser, "index.html", "Index/Landing");
  await testPage(browser, "login.html", "Login");
  await testPage(browser, "register.html", "Register");

  // Authenticated pages (should redirect to login without auth)
  console.log("\nAuthenticated Pages (expect redirect to login):");
  await testPage(browser, "dashboard.html", "Dashboard", { expectAuthRedirect: true });
  await testPage(browser, "subjects.html", "Subjects", { expectAuthRedirect: true });
  await testPage(browser, "flashcards.html", "Flashcards", { expectAuthRedirect: true });
  await testPage(browser, "review.html", "Review Mistakes", { expectAuthRedirect: true });

  // Public pages with reduced motion
  console.log("\nReduced Motion Tests:");
  await testPage(browser, "login.html", "Login", { reducedMotion: true });
  await testPage(browser, "register.html", "Register", { reducedMotion: true });
  await testPage(browser, "index.html", "Index", { reducedMotion: true });

  // Animation runtime test
  console.log("\nAnimation Runtime Tests:");
  await testAnimationPage(browser);

  await browser.close();

  console.log("\n=== QA SUMMARY ===");
  const failures = results.filter((r) => !r.passed);
  if (failures.length === 0) {
    console.log("ALL TESTS PASSED");
  } else {
    console.log(`FAIL: ${failures.length} test(s) with issues:`);
    failures.forEach((r) => {
      console.log(`  - ${r.label}`);
      if (r.pageErrors?.length) r.pageErrors.forEach((e) => console.log(`    error: ${e}`));
      if (r.consoleErrors) {
        const errs = r.consoleMessages?.filter((m) => m.type === "error");
        errs?.forEach((e) => console.log(`    console error: ${e.text}`));
      }
      if (r.error) console.log(`    exception: ${r.error}`);
    });
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("QA script crashed:", e);
  process.exit(1);
});
