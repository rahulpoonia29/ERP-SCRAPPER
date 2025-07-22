import { type Locator, type Page } from "playwright";
import type { Notice } from "../types/notice.js";
import { clickPanelOption } from "../utils/clickPanel.js";
import { logger } from "../utils/logger.js";
import { uploadDocumentToStorage } from "../utils/uploadDocument.js";

export class NoticeScraper {
    private readonly LAST_NOTICE_AT: string;

    private readonly SELECTORS = {
        GRID: "#grid54",
        ROW: "#grid54 tr.jqgrow",
        VISIBLE_DIALOG: ".ui-dialog:visible",
        CLOSE_BUTTON: ".ui-dialog-titlebar-close",
        IFRAME_CONTENT: "#printableArea",
    };

    private readonly NOTICES_URL =
        "https://erp.iitkgp.ac.in/TrainingPlacementSSO/Notice.jsp";
    private readonly CDC_URL =
        "https://erp.iitkgp.ac.in/IIT_ERP3/menulist.htm?module_id=26";
    private readonly PANEL_HEADING_STUDENT = "Student";
    private readonly PANEL_OPTION_APPLICATION =
        "Application of Placement/Internship";

    constructor(private page: Page, lastKnownNoticeAt: string) {
        this.LAST_NOTICE_AT = lastKnownNoticeAt;
    }

    public async scrape(): Promise<Notice[]> {
        const notices: Notice[] = [];

        logger.info("Starting notice scraping process.");
        await this.navigateToCdcSection(this.page);

        const iframeElement = await this.page.waitForSelector(
            'iframe[name="myframe"]',
            { timeout: 5000 }
        );
        const frame = await iframeElement.contentFrame();
        if (!frame) throw new Error("Could not find the 'myframe' iframe.");

        await frame.click('a[href="Notice.jsp"]');

        await frame.waitForSelector(this.SELECTORS.GRID, {
            state: "visible",
            timeout: 5000,
        });

        await this.page.goto(this.NOTICES_URL, {
            waitUntil: "domcontentloaded",
        });

        await this.page.waitForSelector(this.SELECTORS.GRID, {
            state: "visible",
            timeout: 5000,
        });

        await this.page.waitForTimeout(20000);

        const rows = await this.page.locator(this.SELECTORS.ROW).all();

        const lastKnownDate = new Date(this.LAST_NOTICE_AT);

        for (const [index, row] of rows.entries()) {
            const noticeAtText = (
                await row
                    .locator('[aria-describedby="grid54_noticeat"]')
                    .textContent()
            )?.trim();

            if (!noticeAtText) continue;

            const [datePart, timePart] = noticeAtText.split(" ");
            const [day, month, year] = datePart.split("-");
            const noticeDate = new Date(`${year}-${month}-${day}T${timePart}`);

            if (noticeDate <= lastKnownDate) break;

            try {
                const notice = await this.processRow(row);
                notices.push(notice);
                logger.info("Successfully scraped notice.", {
                    rowIndex: index + 1,
                    company: notice.company,
                });
            } catch (err) {
                logger.error("Failed to process row.", {
                    rowIndex: index + 1,
                    error: String(err),
                });
            }
        }

        return notices;
    }

    public async navigateToCdcSection(page: Page): Promise<void> {
        await page.goto(this.CDC_URL, { waitUntil: "domcontentloaded" });

        await page.waitForSelector("#accordion", {
            state: "visible",
            timeout: 5000,
        });

        await page.click('a[href="menulist.htm?module_id=26"]');

        await clickPanelOption(
            page,
            this.PANEL_HEADING_STUDENT,
            this.PANEL_OPTION_APPLICATION
        );
    }

    private async processRow(row: Locator): Promise<Notice> {
        const type =
            (
                await row
                    .locator('[aria-describedby="grid54_type"]')
                    .textContent()
            )?.trim() || "N/A";
        const subject =
            (
                await row
                    .locator('[aria-describedby="grid54_category"]')
                    .textContent()
            )?.trim() || "N/A";
        const company =
            (
                await row
                    .locator('[aria-describedby="grid54_company"]')
                    .textContent()
            )?.trim() || "N/A";
        const noticeTime =
            (
                await row
                    .locator('[aria-describedby="grid54_noticeat"]')
                    .textContent()
            )?.trim() || "N/A";

        const noticeText = await this.extractNoticeText(row);
        const protectedDocumentUrl = await this.extractDocumentUrl(row);

        let documentUrl: string | null = null;

        if (protectedDocumentUrl) {
            documentUrl = await this.downloadAndUploadDocument(
                protectedDocumentUrl,
                `${company}_${subject}.pdf`
            );
        }

        return {
            type,
            subject,
            company,
            noticeAt: noticeTime,
            noticeText,
            documentUrl,
        };
    }

    private async extractNoticeText(row: Locator): Promise<string> {
        try {
            await row.locator('[aria-describedby="grid54_notice"] a').click();
            const dialog = this.page.locator(this.SELECTORS.VISIBLE_DIALOG);
            await dialog.waitFor({ timeout: 10000 });

            const iframe = dialog.frameLocator("iframe");
            await iframe
                .locator(this.SELECTORS.IFRAME_CONTENT)
                .waitFor({ timeout: 10000 });

            const rawHtml = await iframe
                .locator(this.SELECTORS.IFRAME_CONTENT)
                .innerHTML();
            const noticeContent = rawHtml
                .split(/<br\s*\/?>/i)
                .slice(4)
                .join("\n")
                .replace(/<[^>]+>/g, "")
                .trim();

            await dialog.locator(this.SELECTORS.CLOSE_BUTTON).click();
            await dialog.waitFor({ state: "hidden", timeout: 5000 });

            return noticeContent;
        } catch (err) {
            logger.warn(
                "Failed to extract notice text, falling back to title."
            );
            return (
                (
                    await row
                        .locator('[aria-describedby="grid54_notice"] a')
                        .getAttribute("title")
                )?.trim() || ""
            );
        }
    }

    private async extractDocumentUrl(row: Locator): Promise<string | null> {
        const downloadLink = row.locator('[aria-describedby="grid54_view1"] a');
        if ((await downloadLink.textContent())?.trim() !== "Download")
            return null;

        try {
            await downloadLink.click();
            const dialog = this.page.locator(this.SELECTORS.VISIBLE_DIALOG);
            await dialog.waitFor({ timeout: 10000 });

            const iframe = dialog.locator("iframe");
            const documentSrc = await iframe.getAttribute("src");

            await dialog.locator(this.SELECTORS.CLOSE_BUTTON).click();
            await dialog.waitFor({ state: "hidden", timeout: 5000 });

            return documentSrc || null;
        } catch (err) {
            logger.warn("Failed to extract document URL.", {
                error: String(err),
            });
            return null;
        }
    }

    private async downloadAndUploadDocument(
        pdfUrl: string,
        filename: string
    ): Promise<string | null> {
        logger.info("Downloading PDF with proper headers.", { url: pdfUrl });

        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
            Accept: "application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            Referer: this.NOTICES_URL,
            Connection: "keep-alive",
            "Sec-GPC": "1",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "iframe",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
        };

        try {
            const response = await this.page.request.get(pdfUrl, {
                headers,
                timeout: 15000,
            });

            if (!response.ok()) {
                logger.error("Failed to fetch PDF.", {
                    status: response.status(),
                    statusText: response.statusText(),
                });
                return null;
            }

            const buffer = await response.body();

            const uploadedUrl = await uploadDocumentToStorage(buffer, filename);

            logger.info("Uploaded PDF successfully.", { url: uploadedUrl });
            return uploadedUrl;
        } catch (err) {
            logger.error("Failed to download/upload PDF.", {
                error: String(err),
            });
            return null;
        }
    }
}
