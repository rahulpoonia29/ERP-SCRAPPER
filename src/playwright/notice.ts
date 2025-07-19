import { type Locator, type Page } from "playwright";
import type { Env } from "../types/env.js";
import type { Notice } from "../types/notice.js";
import { logger } from "../utils/logger.js";
import { uploadDocumentToStorage } from "../utils/uploadDocument.js";
import path from "path";
import * as fs from "fs/promises";

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

    constructor(private page: Page, ENV: Env, lastKnownNoticeAt: string) {
        this.LAST_NOTICE_AT = lastKnownNoticeAt;
    }

    public async scrape(): Promise<Notice[]> {
        if (!this.page || !this.NOTICES_URL) {
            throw new Error("Page or NOTICES_URL is not configured.");
        }

        const notices: Notice[] = [];
        try {
            logger.info("Starting notice scraping process.", {
                url: this.NOTICES_URL,
            });
            await this.page.goto(this.NOTICES_URL, {
                waitUntil: "domcontentloaded",
            });

            logger.info("Waiting for the notices grid to be visible.");
            await this.page.waitForSelector(this.SELECTORS.GRID, {
                state: "visible",
                timeout: 10000,
            });

            const rows = await this.page.locator(this.SELECTORS.ROW).all();
            logger.info(`Found ${rows.length} notice rows to process.`);

            if (rows.length === 0) return notices;

            const lastKnownDate = new Date(this.LAST_NOTICE_AT);

            for (const [index, row] of rows.entries()) {
                const noticeAtText = (
                    await row
                        .locator('[aria-describedby="grid54_noticeat"]')
                        .textContent()
                )?.trim();
                if (!noticeAtText) {
                    logger.warn("Skipping row due to missing notice date.", {
                        rowIndex: index + 1,
                    });
                    continue;
                }

                const [datePart, timePart] = noticeAtText.split(" ");
                const [day, month, year] = datePart.split("-");
                const noticeDate = new Date(
                    `${year}-${month}-${day}T${timePart}`
                );

                if (noticeDate <= lastKnownDate) {
                    logger.info(
                        "Reached notices older than last known date. Stopping scrape.",
                        { lastKnownDate }
                    );
                    break;
                }

                try {
                    const notice = await this._processRow(row);
                    notices.push(notice);
                    logger.info("Successfully scraped notice.", {
                        rowIndex: index + 1,
                        company: notice.company,
                    });
                } catch (rowError) {
                    logger.error("Failed to process a row.", {
                        rowIndex: index + 1,
                        error:
                            rowError instanceof Error
                                ? rowError.stack
                                : String(rowError),
                    });
                }
            }
            logger.info(
                `Scraping complete. Found ${notices.length} new notices.`
            );
            return notices;
        } catch (error) {
            logger.error(
                "A critical error occurred during the main scraping process.",
                {
                    error: error instanceof Error ? error.stack : String(error),
                }
            );
            throw error;
        }
    }

    private async _processRow(row: Locator): Promise<Notice> {
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

        const noticeText = await this._extractNoticeText(row);
        const protectedDocumentUrl = await this._extractDocumentUrl(row);

        if (!protectedDocumentUrl) {
            return {
                type,
                subject,
                company,
                noticeAt: noticeTime,
                noticeText,
                documentUrl: null,
            };
        }

        const documentUrl = await this._uploadDocument(
            protectedDocumentUrl,
            `${company}_${subject}.pdf`
        );
        return {
            type,
            subject,
            company,
            noticeAt: noticeTime,
            noticeText,
            documentUrl,
        };
    }

    private async _extractNoticeText(row: Locator): Promise<string> {
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

            const lines = rawHtml.split(/<br\s*\/?>/i);
            const noticeContent = lines
                .slice(4)
                .join("\n")
                .replace(/<[^>]+>/g, "")
                .trim();

            await dialog.locator(this.SELECTORS.CLOSE_BUTTON).click();
            await dialog.waitFor({ state: "hidden", timeout: 5000 });

            return noticeContent;
        } catch (error) {
            logger.warn(
                "Failed to extract full notice text from dialog, falling back to title.",
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                }
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

    private async _extractDocumentUrl(row: Locator): Promise<string | null> {
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

            return documentSrc ? new URL(documentSrc).toString() : null;
        } catch (error) {
            logger.warn("Could not extract document URL.", {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private async _uploadDocument(
        protectedDocumentUrl: string,
        filename: string
    ): Promise<string | null> {
        const newPage = await this.page.context().newPage();
        try {
            const pdfResponsePromise = new Promise<Buffer>(
                (resolve, reject) => {
                    newPage.on("response", async (response) => {
                        const regex =
                            /chrome\-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/[0-9a-f\-]{8,}/;
                        const url = response.url();

                        if (!regex.test(url)) return;

                        try {
                            const responseBuffer = await response.body();

                            if (!responseBuffer) {
                                reject(
                                    new Error("No response buffer received.")
                                );
                                return;
                            }

                            logger.info("Received document response", {
                                url,
                                size: `${(responseBuffer.length / 1024).toFixed(
                                    2
                                )} KB`,
                                contentType: response.headers()["content-type"],
                            });

                            resolve(responseBuffer);
                        } catch (err) {
                            reject(err);
                        }
                    });
                }
            );

            await newPage.goto(protectedDocumentUrl, {
                waitUntil: "networkidle",
                timeout: 10000,
            });

            await newPage.waitForLoadState("networkidle");
            const pdfBuffer = await pdfResponsePromise;

            const documentUrl = await uploadDocumentToStorage(
                pdfBuffer,
                filename
            );

            return documentUrl;
        } catch (error) {
            logger.error("Failed to download or upload the document.", {
                url: protectedDocumentUrl,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        } finally {
            await newPage.close();
        }
    }
}
