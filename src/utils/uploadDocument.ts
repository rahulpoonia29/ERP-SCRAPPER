import { UTApi, UTFile } from "uploadthing/server";

const utapi = new UTApi({ token: process.env.UPLOADTHING_TOKEN! });

export async function uploadDocumentToStorage(
    buffer: Buffer,
    filename: string
): Promise<string> {
    const file = new UTFile([buffer], filename);

    const result = await utapi.uploadFiles(file);

    if (!result.data?.ufsUrl) {
        throw new Error(`Upload failed for ${filename}`);
    }

    return result.data.ufsUrl;
}
