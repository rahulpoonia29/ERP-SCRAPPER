// src/utils/parseDate.ts

export function parseAndValidateDate(dateStr: string): string {
    const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/);
    if (!match) {
        throw new Error("Invalid date format. Expected 'DD-MM-YYYY HH:mm'.");
    }
    const [, dd, mm, yyyy, hh, min] = match;
    // Month is 0-indexed in Date object
    const parsedDate = new Date(
        Date.UTC(
            parseInt(yyyy),
            parseInt(mm) - 1,
            parseInt(dd),
            parseInt(hh),
            parseInt(min)
        )
    );

    if (isNaN(parsedDate.getTime())) {
        throw new Error("Invalid date value provided.");
    }
    return parsedDate.toISOString();
}
