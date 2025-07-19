import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { env } from "hono/adapter";
import type { Env } from "./types/env.js";
import { NoticeScrapeParamsSchema, scrapeNotices } from "./services/notice.js";
import { logger } from "./utils/logger.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Scraper Service is running!"));

app.post(
    "/scrape-notices",
    zValidator("json", NoticeScrapeParamsSchema),
    async (c) => {
        try {
            const validatedData = c.req.valid("json");
            const ENV = env(c);

            if (
                !ENV.NOTICE_WEBHOOK_URL ||
                !ENV.NOTICE_WEBHOOK_URL ||
                !ENV.OTP_API_URL
            ) {
                logger.error(
                    "Server is missing critical environment variables."
                );
                return c.json({ message: "Server configuration error" }, 500);
            }

            scrapeNotices({
                ...validatedData,
                ENV,
            }).catch((error) => {
                logger.error("Background scraping process failed.", {
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            });

            return c.json(
                { message: "Scraping job started successfully." },
                202
            );
        } catch (error) {
            logger.error("Failed to start scrape process.", {
                error: error instanceof Error ? error.message : String(error),
            });
            return c.json({ message: "Invalid request body" }, 400);
        }
    }
);

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 9000;
serve({ fetch: app.fetch, port }, (info) => {
    logger.info(`Server is running on http://localhost:${info.port}`);
});
