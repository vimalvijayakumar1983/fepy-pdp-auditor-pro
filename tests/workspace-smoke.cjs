const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(
  require.resolve("playwright", {
    paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()],
  }),
);
const AxeBuilder = require("@axe-core/playwright").default;
const base = "http://127.0.0.1:3120";
const password = "synthetic-test-password-only";
const secret = "synthetic-test-session-secret-32-characters-only";
async function ready(url) {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Test service did not become ready: " + url);
}
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fepy-workspace-"));
  const output =
    process.env.FEPY_TEST_ARTIFACT_DIR ||
    path.join(os.tmpdir(), "fepy-workspace-validation");
  await fs.mkdir(output, { recursive: true });
  const worker = spawn(
    "python",
    [
      "-m",
      "uvicorn",
      "workspace-fixture:app",
      "--app-dir",
      "tests",
      "--host",
      "127.0.0.1",
      "--port",
      "3121",
    ],
    {
      env: {
        ...process.env,
        AUDITOR_DATA_DIR: dir,
        AUDITOR_WORKER_TOKEN: "synthetic-worker-test-token",
        OPENAI_API_KEY: "",
        BROWSER_USE_API_KEY: "",
        FEPY_AUDITOR_ACCESS_APPROVED: "",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let workerErrors = "";
  worker.stderr.on("data", (d) => (workerErrors += d));
  const server = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "start", "--port", "3120"],
    {
      env: {
        ...process.env,
        AUDITOR_WORKER_URL: "http://127.0.0.1:3121",
        AUDITOR_WORKER_TOKEN: "synthetic-worker-test-token",
        AUDITOR_APP_PASSWORD: password,
        AUDITOR_SESSION_SECRET: secret,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let appErrors = "";
  server.stderr.on("data", (d) => (appErrors += d));
  let browser;
  try {
    await Promise.all([
      ready(base + "/login"),
      ready("http://127.0.0.1:3121/health"),
    ]);
    assert.equal((await fetch(base + "/api/workspace")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://untrusted.example",
          },
          body: JSON.stringify({ password }),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/api/workspace", {
          headers: { Cookie: "fepy-workspace-session=forged" },
        })
      ).status,
      401,
    );
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(),
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (r) => {
      if (r.status() >= 400 && r.url().startsWith(base))
        console.error(
          "UI failed request",
          r.status(),
          r.url(),
          await r.text().catch(() => ""),
        );
    });
    await page.goto(base + "/workspace");
    await page.getByLabel("Workspace password").fill(password);
    await page.getByRole("button", { name: "Enter workspace" }).click();
    await page
      .getByRole("button", { name: "Create your first project" })
      .waitFor();
    await page
      .getByRole("button", { name: "Create your first project" })
      .click();
    await page
      .getByLabel("Project name")
      .fill("Validation project · synthetic records");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Local synthetic data. No FEPY access or paid AI.");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .last()
      .click();
    await page
      .getByRole("button", { name: "New audit", exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("button", { name: "New audit", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Import catalog CSV" }).click();
    await page
      .getByLabel("Product CSV", { exact: true })
      .fill(
        "sku,product_url,title_en,brand,model_number,price_aed,currency,stock_status,description_en,specs_inline\nDEMO-ADH-02,https://www.fepy.com/demo-adhesive,Demo construction adhesive · synthetic validation record,Demo,DEMO-150,20,AED,in_stock,Synthetic description for testing only.,Pack: 380 g",
      );
    await page
      .getByRole("button", { name: "Save products to library" })
      .click();
    await page
      .getByText("Demo construction adhesive · synthetic validation record", {
        exact: true,
      })
      .waitFor();
    const projects = await (
      await context.request.get(base + "/api/workspace")
    ).json();
    const projectId = projects.projects[0].id;
    const saved = await context.request.post(
      base + `/api/workspace/projects/${projectId}/audits`,
      { headers: { Origin: base }, data: { jobId: "a".repeat(32) } },
    );
    assert.equal(saved.status(), 201, await saved.text());
    await page.getByRole("button", { name: "Refresh workspace" }).click();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByText("Demo Cordless Combi Drill · synthetic validation record", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "workspace-desktop.png"),
      fullPage: true,
    });
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    await fs.writeFile(
      path.join(output, "accessibility.json"),
      JSON.stringify(axe.violations, null, 2),
    );
    const blockers = axe.violations.filter((v) => v.id !== "color-contrast");
    assert.equal(
      blockers.length,
      0,
      JSON.stringify(
        blockers.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
    );
    await page.getByRole("button", { name: "Improvement queue" }).click();
    await page
      .getByText("Synthetic specification conflict for workflow validation", {
        exact: true,
      })
      .click();
    const reviewCard = page
      .locator(".review-card")
      .filter({
        has: page.getByRole("heading", {
          name: "Synthetic specification conflict for workflow validation",
          exact: true,
        }),
      });
    await reviewCard.getByText("Update review, owner & notes").click();
    await reviewCard
      .getByLabel("Workflow status", { exact: true })
      .selectOption("in_progress");
    await reviewCard
      .getByLabel("Owner", { exact: true })
      .fill("Product content team");
    await reviewCard
      .getByLabel("Review notes", { exact: true })
      .fill("Verify this synthetic field conflict.");
    await reviewCard
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await page.getByText("Review saved.", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Content studio" }).click();
    await page
      .getByLabel("Product title", { exact: true })
      .fill("Edited synthetic product title");
    await page
      .getByRole("button", { name: "Save content draft", exact: true })
      .click();
    await page
      .getByText("Draft saved. Your storefront has not changed.", {
        exact: true,
      })
      .waitFor();
    await page.screenshot({
      path: path.join(output, "content-studio.png"),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Evidence", exact: true }).click();
    const evidenceLink = page.getByRole("link", {
      name: /Desktop first viewport/,
    });
    assert.equal(await evidenceLink.count(), 1);
    assert.equal(
      (
        await context.request.get(
          base + (await evidenceLink.getAttribute("href")),
        )
      ).status(),
      200,
    );
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.getByLabel("Compare with audit").selectOption("a".repeat(32));
    await page
      .getByText("No captured field differences.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Close product detail" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Improvement queue" }).click();
    await page
      .locator(".queue-meta")
      .getByText("Product content team", { exact: false })
      .first()
      .waitFor();
    const exportEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export filtered plan" }).click();
    const csv = await exportEvent;
    assert.match(
      await fs.readFile(await csv.path(), "utf8"),
      /Product content team/,
    );
    const projectData = await (
      await context.request.get(base + `/api/workspace/projects/${projectId}`)
    ).json();
    const productId = projectData.products.find(
      (p) => p.sku === "DEMO-TOOL-01",
    ).id;
    const product = await (
      await context.request.get(base + `/api/workspace/products/${productId}`)
    ).json();
    assert.equal(
      product.findings.find((f) => f.code === "fixture_fact_conflict").status,
      "in_progress",
    );
    assert.equal(
      product.row.title_en,
      "Demo Cordless Combi Drill · synthetic validation record",
    );
    assert.equal(
      product.drafts.title_en.value,
      "Edited synthetic product title",
    );
    assert.equal(
      (
        await context.request.put(
          base + `/api/workspace/products/${productId}/drafts`,
          {
            headers: { Origin: base },
            data: { revision: 1, fields: { title_en: "stale overwrite" } },
          },
        )
      ).status(),
      409,
    );
    assert.equal(
      (
        await context.request.post(base + "/api/catalog-live", {
          headers: { Origin: base },
          data: {
            urls: ["https://www.fepy.com/demo-cordless-drill"],
            projectId,
            detailed: false,
            referenceUrls: [],
          },
        })
      ).status(),
      409,
    );
    assert.equal(
      (
        await context.request.post(
          base + `/api/workspace/projects/${projectId}/products`,
          {
            headers: { Origin: "https://untrusted.example" },
            data: { rows: [{ sku: "UNSAFE" }] },
          },
        )
      ).status(),
      403,
    );
    const backupEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export workspace", exact: true })
      .click();
    const backup = await backupEvent;
    const report = JSON.parse(await fs.readFile(await backup.path(), "utf8"));
    assert.equal(report.audits.length, 1);
    assert.equal(report.products.length, 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.screenshot({
      path: path.join(output, "mobile-before-check.png"),
      fullPage: true,
    });
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter(
          (e) =>
            e.getBoundingClientRect().right > innerWidth &&
            getComputedStyle(e).position !== "fixed",
        )
        .filter((e) => {
          let parent = e.parentElement;
          while (parent && parent !== document.body) {
            if (
              ["auto", "scroll", "hidden", "clip"].includes(
                getComputedStyle(parent).overflowX,
              )
            )
              return false;
            parent = parent.parentElement;
          }
          return true;
        })
        .slice(0, 20)
        .map((e) => ({
          tag: e.tagName,
          cls: e.className,
          width: e.getBoundingClientRect().width,
          right: e.getBoundingClientRect().right,
        })),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      JSON.stringify(overflow),
    );
    await page.screenshot({
      path: path.join(output, "workspace-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Product library", exact: true })
      .click();
    await page.getByRole("button", { name: /Open Demo Cordless/ }).click();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: path.join(output, "product-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close product detail" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await page.pdf({
      path: path.join(output, "workspace-report.pdf"),
      format: "A4",
      printBackground: true,
    });
    assert.equal(
      (
        await context.request.post(base + "/api/audit", {
          headers: { Origin: base },
          data: { url: "https://www.fepy.com/demo-cordless-drill" },
        })
      ).status(),
      410,
    );
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Enter workspace" }).waitFor();
    assert.equal(
      (await context.request.get(base + "/api/workspace")).status(),
      401,
    );
    console.log(
      "Workspace smoke passed: protected login, project creation, CSV import, saved audits, durable review and drafts, evidence access, version comparison, conflict handling, site-access gate, exports, mobile layout, PDF and logout. Synthetic local records only.",
    );
    console.log(
      "Accessibility contrast issues:",
      axe.violations
        .filter((v) => v.id === "color-contrast")
        .reduce((n, v) => n + v.nodes.length, 0),
    );
  } catch (e) {
    console.error("Worker diagnostics:", workerErrors.slice(-2000));
    console.error("App diagnostics:", appErrors.slice(-2000));
    throw e;
  } finally {
    if (browser) await browser.close();
    server.kill();
    worker.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
