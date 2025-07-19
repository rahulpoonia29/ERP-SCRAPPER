// src/utils/logger.ts
import { createLogger, format, transports } from "winston";

const { combine, timestamp, json, colorize, printf, errors } = format;

const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
        msg += `\n${JSON.stringify(metadata, null, 2)}`;
    }
    return msg;
});

const logger = createLogger({
    level: "info",
    format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        errors({ stack: true }),
        json()
    ),
    transports: [
        // new transports.File({ filename: "logs/combined.log" }),
        new transports.File({ filename: "logs/error.log", level: "error" }),
    ],
    exitOnError: false,
});

// if (process.env.NODE_ENV !== "production") {
    logger.add(
        new transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: "HH:mm:ss" }),
                consoleFormat
            ),
            level: "info",
        })
    );
// }

export { logger };
