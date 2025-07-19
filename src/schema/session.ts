import { z } from "zod";

export const AuthCredentialsSchema = z
    .object({
        rollNo: z
            .string()
            .regex(/^[0-9]{2}[A-Z]{2}[0-9]{5}$/, {
                message:
                    "Invalid Roll Number format. Expected format is 21CS10012.",
            })
            .transform((val) => val.trim().toUpperCase()),
        password: z.string().min(1, { message: "Password cannot be empty." }),
        securityAnswers: z
            .record(z.string(), z.string())
            .refine((obj) => Object.keys(obj).length === 3, {
                message: "Security answers must contain exactly 3 entries.",
            })
            .refine(
                (obj) =>
                    Object.entries(obj).every(
                        ([key, value]) =>
                            key.trim().length > 0 && value.trim().length > 0
                    ),
                {
                    message: "Security questions and answers cannot be empty.",
                }
            )
            .transform((obj) =>
                Object.fromEntries(
                    Object.entries(obj).map(([key, value]) => [
                        key.trim(),
                        value.trim(),
                    ])
                )
            ),
    })
    .strict();

export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;
