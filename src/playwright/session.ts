import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from "playwright";
import type { Env } from "../types/env.js";
import { logger } from "../utils/logger.js";
import { getOTPWithBackoff } from "../utils/getOTP.js";
import {
    readSessionTokenFromFile,
    saveSessionTokenToFile,
} from "../utils/sessionToken.js";

export class ErpSession {
    private browser!: Browser;
    private context!: BrowserContext;
    private page!: Page;
    private ENV: Env;

    private readonly URLS = {
        LOGIN: process.env.ERP_URL || "https://erp.iitkgp.ac.in",
        WELCOME:
            process.env.ERP_WELCOME_URL ||
            "https://erp.iitkgp.ac.in/IIT_ERP3/welcome.jsp",
    };

    private readonly SELECTORS = {
        USERNAME_INPUT: 'input[name="user_id"]',
        PASSWORD_INPUT: 'input[name="password"]',
        SECURITY_ANSWER_DIV: "#answer_div",
        SECURITY_QUESTION_TEXT: "#question",
        SECURITY_ANSWER_INPUT: "#answer",
        OTP_REQUEST_BUTTON: "#getotp",
        OTP_INPUT: "#email_otp1",
        LOGIN_SUBMIT_BUTTON: "#loginFormSubmitButton",
    };

    private readonly TIMEOUTS = {
        NAVIGATION: 30000,
        SELECTOR: 10000,
    };

    constructor(
        private rollNo: string,
        private password: string,
        private securityAnswers: Record<string, string>,
        ENV: Env
    ) {
        this.ENV = ENV;
    }

    public async init(): Promise<void> {
        try {
            logger.info("Initializing browser session...");

            // if (this.ENV.PLAYWRIGHT_LAUNCH_STANDALONE === "true") {
            this.browser = await chromium.launch({
                headless: true,
                // slowMo: 500,
            });
            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent:
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            });
            // } else {
            //     this.browser = await chromium.connectOverCDP(
            //         "http://localhost:9222",
            //         {
            //             slowMo: 500,
            //         }
            //     );
            //     this.context = this.browser.contexts()[0];
            // }

            this.page = await this.context.newPage();
            logger.info("Browser initialized successfully.");
        } catch (error) {
            logger.error("Failed to initialize browser.", {
                error: error instanceof Error ? error.stack : String(error),
            });
            throw error;
        }
    }

    public async login(): Promise<void> {
        if (!this.page) {
            throw new Error("Browser not initialized. Call init() first.");
        }

        try {
            // Check if session is already alive
            const isAlive = await this.isSessionAlive();
            if (isAlive) {
                logger.info("Session is already alive. Skipping login.");
                await this._saveSessionToken();
                return;
            }

            // Obtain the session token from file and check if it is valid
            const savedSessionToken = await readSessionTokenFromFile();

            if (savedSessionToken) {
                await this.context.clearCookies();
                await this.context.addCookies([
                    {
                        name: "ssoToken",
                        value: savedSessionToken,
                        path: "/",
                        domain: "erp.iitkgp.ac.in",
                    },
                ]);

                const isValidSession = await this.isSessionAlive();
                if (isValidSession) {
                    logger.info("Using existing session token. Login skipped.");
                    return;
                }
            }

            logger.info("Starting ERP login flow.");

            await this._navigateToLoginPage();
            await this._fillCredentials();
            await this._handleSecurityQuestion();
            await this._submitOtp();

            await this._saveSessionToken();

            logger.info("Login flow completed successfully.");
        } catch (error) {
            logger.error("Login flow failed.", {
                error: error instanceof Error ? error.stack : String(error),
            });
            throw new Error(
                `Login failed for roll number ${this.rollNo}. See logs for details.`
            );
        }
    }

    private async _navigateToLoginPage(): Promise<void> {
        await this.page.goto(this.URLS.LOGIN, {
            waitUntil: "domcontentloaded",
            timeout: this.TIMEOUTS.NAVIGATION,
        });
        await this.page.waitForSelector(this.SELECTORS.USERNAME_INPUT, {
            state: "visible",
            timeout: this.TIMEOUTS.SELECTOR,
        });
    }

    private async _fillCredentials(): Promise<void> {
        logger.info("Filling user credentials (username and password).");
        await this.page.fill(this.SELECTORS.USERNAME_INPUT, this.rollNo);
        await this.page.fill(this.SELECTORS.PASSWORD_INPUT, this.password);
    }

    private async _handleSecurityQuestion(): Promise<void> {
        logger.info("Handling security question.");
        await this.page.waitForSelector(this.SELECTORS.SECURITY_ANSWER_DIV, {
            state: "visible",
            timeout: this.TIMEOUTS.SELECTOR,
        });

        const question = (
            await this.page
                .locator(this.SELECTORS.SECURITY_QUESTION_TEXT)
                .first()
                .textContent()
        )?.trim();
        if (!question) {
            throw new Error("Could not extract security question text.");
        }

        const answer = this.securityAnswers[question];
        if (!answer) {
            throw new Error(
                `No answer found for security question: "${question}"`
            );
        }

        logger.info("Found matching security answer, filling it in.");
        await this.page.fill(this.SELECTORS.SECURITY_ANSWER_INPUT, answer);
    }

    private async _submitOtp(): Promise<void> {
        logger.info("Requesting and submitting OTP.");
        await this.page.click(this.SELECTORS.OTP_REQUEST_BUTTON);

        const otp = await getOTPWithBackoff(this.ENV.OTP_API_URL, this.rollNo);
        logger.info("Successfully fetched OTP.");

        await this.page.fill(this.SELECTORS.OTP_INPUT, otp.toString().trim());
        await this.page.click(this.SELECTORS.LOGIN_SUBMIT_BUTTON);
    }

    private async _saveSessionToken(): Promise<void> {
        const cookies = await this.context.cookies();
        const sessionToken = cookies.find(
            (cookie) => cookie.name === "ssoToken"
        );

        if (!sessionToken || !sessionToken.value) {
            throw new Error("Session token not found in cookies.");
        }

        await saveSessionTokenToFile(sessionToken.value);
    }

    public async isSessionAlive(): Promise<boolean> {
        // Navigationg to https://erp.iitkgp.ac.in/IIT_ERP3/welcome.jsp results in a redirect to the login page if the session is not alive.
        await this.page.goto(this.URLS.WELCOME, {
            waitUntil: "domcontentloaded",
        });

        const currentUrl = this.page.url().split("?")[0];
        console.log(currentUrl.includes(this.URLS.WELCOME));
        return currentUrl.includes(this.URLS.WELCOME);
    }

    public getPage(): Page {
        if (!this.page) {
            throw new Error(
                "Page not available. Ensure session is initialized."
            );
        }
        return this.page;
    }

    public async close(): Promise<void> {
        try {
            if (this.browser) {
                await this.browser.close();
                logger.info("Browser closed successfully.");
            }
        } catch (error) {
            logger.error("Error closing the browser.", {
                error: error instanceof Error ? error.stack : String(error),
            });
        }
    }
}
