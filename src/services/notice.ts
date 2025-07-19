import z from "zod";
import { NoticeScraper } from "../playwright/notice.js";
import { ErpSession } from "../playwright/session.js";
import { AuthCredentialsSchema } from "../schema/session.js";
import type { Env } from "../types/env.js";
import type { Notice } from "../types/notice.js";
import { logger } from "../utils/logger.js";

export const NoticeScrapeParamsSchema = AuthCredentialsSchema.extend({
    lastKnownNoticeAt: z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "lastKnownNoticeAt must be a valid ISO date string",
    }),
});

type NoticeScrapeParams = z.infer<typeof NoticeScrapeParamsSchema> & {
    ENV: Env;
};

export async function scrapeNotices(params: NoticeScrapeParams): Promise<void> {
    const runLogger = logger.child({
        job: "scrapeNotices",
        rollNo: params.rollNo,
    });

    const { rollNo, password, securityAnswers, ENV, lastKnownNoticeAt } =
        params;

    let session: ErpSession | null = null;

    try {
        runLogger.info("Notice scraping job started.");

        // --- Step 1: Initialize and Login ---
        session = new ErpSession(rollNo, password, securityAnswers, ENV);
        await session.init();
        await session.login();

        runLogger.info("Session established successfully.");

        // --- Step 2: Scrape Notices ---
        const scraper = new NoticeScraper(
            session.getPage(),
            ENV,
            lastKnownNoticeAt
        );

        const newNotices = await scraper.scrape();

        if (newNotices.length === 0) {
            runLogger.info("No new notices found. Job finished successfully.");
            return;
        }

        runLogger.info(
            `Found ${newNotices.length} new notices. Preparing to post to webhook.`
        );

        // --- Step 3: Post to Webhook ---
        if (session) {
            await session.close();
            session = null;
        }

        // await fs.writeFileSync(
        //     "notices.json",
        //     JSON.stringify(newNotices, null, 2)
        // );
        await postNoticesToWebhook(ENV.NOTICE_WEBHOOK_URL, newNotices);

        runLogger.info("Successfully posted notices to webhook. Job finished.");
    } catch (error) {
        runLogger.error("The 'scrapeNotices' job failed.", {
            error: error instanceof Error ? error.stack : String(error),
        });

        throw new Error(
            `Notice scraping failed for roll number ${rollNo}. Check logs for details.`
        );
    } finally {
        if (session) {
            runLogger.info("Closing session in the 'finally' block.");
            await session.close();
        }
    }
}

async function postNoticesToWebhook(
    webhookUrl: string,
    notices: Notice[]
): Promise<void> {
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(notices),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
                `Webhook responded with ${response.status} ${response.statusText}. Body: ${errorBody}`
            );
        }
    } catch (error) {
        logger.error("Failed to post notices to webhook.", {
            webhookUrl,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
