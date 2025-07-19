import z from "zod";

export const NoticeSchema = z.object({
    type: z.string(),
    subject: z.string(),
    company: z.string(),
    noticeText: z.string(),
    noticeAt: z.string(),
    documentUrl: z.string().nullable(),
});

export type Notice = z.infer<typeof NoticeSchema>;
