import { chromium } from "playwright";

(async () => {
    const browser = await chromium.connectOverCDP("http://localhost:9222", {
        // slowMo: 1000,
        timeout: 1000,
    });
    const context = browser.contexts()[0];
    const page = await context.newPage();

    // 🚀 Monkey-patch attachShadow BEFORE any scripts run
    await page.addInitScript(() => {
        const orig = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) {
            if (init) init.mode = "open"; // force open
            return orig.call(this, init);
        };
    });

    // 🔗 Navigate to your page
    await page.goto(
        "https://erp.iitkgp.ac.in/TrainingPlacementSSO/AdmFilePDF.htm?type=NOTICE&year=2025-2026&id=202",
        { waitUntil: "domcontentloaded", timeout: 1000 }
    );

    // wait for the iframe to appear
    const iframeElementHandle = await page.waitForSelector("iframe");
    const frame = await iframeElementHandle.contentFrame();

    if (!frame) {
        console.error("❌ iframe not found");
        await browser.close();
        return;
    }

    console.log(`✅ iframe URL: ${frame.url()}`);

    // wait for <embed> to appear inside the iframe
    const embedHandle = await frame.waitForSelector("embed", { timeout: 1000 });

    if (!embedHandle) {
        console.error("❌ <embed> not found");
        await browser.close();
        return;
    }

    const embedSrc = await embedHandle.getAttribute("src");
    const embedType = await embedHandle.getAttribute("type");

    console.log(`✅ Found <embed>:`);
    console.log(`  src: ${embedSrc}`);
    console.log(`  type: ${embedType}`);

    await browser.close();
})();
