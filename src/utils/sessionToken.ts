import { promises as fs } from "fs";
import path from "path";
import { logger } from "./logger.js";

export async function saveSessionTokenToFile(
    sessionToken: string
): Promise<void> {
    try {
        const rootPath = process.cwd();
        const filePath = path.join(rootPath, "session.txt");
        await fs.writeFile(filePath, sessionToken, "utf8");
        logger.info(`Session token saved to ${filePath}`);
    } catch (error) {
        logger.error(
            `Failed to save session token: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        throw new Error("Failed to save session token.");
    }
}

export async function readSessionTokenFromFile(): Promise<string | null> {
    try {
        const rootPath = process.cwd();

        const filePath = path.join(rootPath, "session.txt");
        const sessionToken = await fs.readFile(filePath, "utf8");
        logger.info(`Session token read from ${filePath}`);
        return sessionToken.trim();
    } catch (error: any) {
        if (error && error.code === "ENOENT") {
            logger.info("Session token file does not exist.");
            return null;
        }
        logger.error(
            `Failed to read session token: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        throw new Error("Failed to read session token.");
    }
}
