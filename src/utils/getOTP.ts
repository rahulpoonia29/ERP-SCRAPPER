// src/utils/getOTP.ts
import { logger } from "./logger.js";

interface GetOTPOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
    maxDelayMs?: number;
}

export async function getOTPWithBackoff(
    OTP_API_URL: string,
    rollNo: string,
    options: GetOTPOptions = {}
): Promise<number> {
    if (!OTP_API_URL || !rollNo) {
        throw new Error("OTP_API_URL and rollNo are required parameters.");
    }

    const {
        maxAttempts = 4,
        initialDelayMs = 10000, // 10 seconds
        backoffFactor = 2,
        maxDelayMs = 30000,
    } = options;

    const fetchLogger = logger.child({
        job: "getOTPWithBackoff",
        rollNo,
        maxAttempts,
    });

    const otpRequestTimestamp = new Date().toISOString();
    const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    fetchLogger.info("Starting OTP fetch process. Waiting for initial delay.", {
        initialDelayMs,
    });
    await sleep(initialDelayMs);

    let currentAttempt = 1;
    let currentDelayMs = 5000;
    let lastError: Error | null = null;

    while (currentAttempt <= maxAttempts) {
        const url = `${OTP_API_URL}/${encodeURIComponent(
            rollNo
        )}?requestedAt=${encodeURIComponent(otpRequestTimestamp)}`;

        fetchLogger.info(
            `Attempt ${currentAttempt}/${maxAttempts}: Requesting OTP.`,
            { url }
        );

        try {
            const response = await fetch(url);
            // const json = await response.json();
            // console.log("Response: ", json);

            if (response.ok) {
                const data = (await response.json()) as {
                    otp: number;
                    createdAt: string;
                };

                if (data && data.otp) {
                    const otp = data.otp;
                    fetchLogger.info("Successfully received OTP.", {
                        otp: otp,
                        createdAt: data.createdAt,
                    });
                    return otp;
                }

                throw new Error(
                    "API response was OK but OTP was missing or empty."
                );
            }

            if (response.status === 404) {
                fetchLogger.warn(
                    "OTP not ready yet (404 Not Found), will retry."
                );
            } else {
                const errorText = await response.text();
                throw new Error(
                    `API responded with HTTP ${response.status}: ${errorText}`
                );
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            fetchLogger.error(`Attempt ${currentAttempt} failed.`, {
                error: lastError.message,
            });
        }

        if (currentAttempt < maxAttempts) {
            fetchLogger.info(
                `Waiting ${currentDelayMs}ms before the next attempt...`
            );
            await sleep(currentDelayMs);
            currentDelayMs = Math.min(
                currentDelayMs * backoffFactor,
                maxDelayMs
            );
        }

        currentAttempt++;
    }

    const finalError = new Error(
        `Failed to get OTP after ${maxAttempts} attempts.`
    );
    if (lastError) {
        (finalError as any).cause = lastError;
    }

    fetchLogger.error("All attempts to fetch OTP failed.", {
        finalError: finalError.message,
        lastKnownCause: lastError?.message,
    });

    throw finalError;
}
