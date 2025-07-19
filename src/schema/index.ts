import { z } from "zod";
import { parseAndValidateDate } from "../utils/parseDate.js";
import { AuthCredentialsSchema } from "./session.js";

export const GetNoticesQuerySchema = z.object({
    since: z
        .string()
        .optional()
        .default("01-01-2023 00:00")
        .transform(parseAndValidateDate),
    limit: z.coerce.number().int().positive().max(200).default(50),
    page: z.coerce.number().int().positive().default(1),
});

export const GetOtpParamsSchema = AuthCredentialsSchema.pick({
    rollNo: true,
});

export const GetOtpQuerySchema = z.object({
    requestedAt: z.iso.datetime({
        message: "requestedAt must be a valid ISO date string.",
    }),
});

export const NoticeWebhookPayloadSchema = z.object({
    type: z.string().min(1),
    subject: z.string().min(1),
    company: z.string().min(1),
    noticeText: z.string().min(1),
    noticeAt: z.string().transform(parseAndValidateDate), // Transforms raw date to ISO string
    documentUrl: z.url().optional().or(z.literal("")),
});

export const NoticesWebhookSchema = z.array(NoticeWebhookPayloadSchema);
