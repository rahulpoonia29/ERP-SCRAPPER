import type { Page } from "playwright";

export async function clickPanelOption(
    page: Page,
    panelText: string,
    optionText: string,
    allowDisabled = false
): Promise<void> {
    const locator = page.locator(
        `.panel-heading:has(.panel-title a:text-is("${panelText}"))`
    );

    await locator.click();

    const optionLink = page.locator(`.well a:text-is("${optionText}")`);
    const classes = await optionLink.getAttribute("class");

    if (!allowDisabled && classes?.includes("text-danger")) {
        throw new Error(
            `Option "${optionText}" appears disabled (class="text-danger").`
        );
    }

    await optionLink.click();
}
