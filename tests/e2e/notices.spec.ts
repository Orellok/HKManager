import type { Page } from "@playwright/test";

import { expect, test_ } from "./support/data-fixtures";

/**
 * M2.1 criterion 11(b): a one-time confirmation after a redirect (`?notice=`) is shown once,
 * however the page was reached: a redirect after a save (soft navigation), a full page load
 * (e.g. a save submitted before hydration answers with a 303) or an address opened directly.
 * An in-page Server Action, a reload or Back must not bring it back.
 */

test_.beforeEach(async ({ signIn }) => {
  await signIn({ role: "owner" });
});

function notice(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

/**
 * The notice never shows during `windowMs`. A notice is rendered about 100 ms after its page
 * mounts (RedirectNotice's announce delay), so an immediate "count is 0" could pass before
 * it appears; this keeps watching instead.
 */
async function expectNoNotice(page: Page, text: string, windowMs = 1_500) {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    expect(await notice(page, text).count(), `"${text}" showed again`).toBe(0);
    await page.waitForTimeout(100);
  }
}

/** The address without ?notice= once the notice was consumed. */
function cleanUrl(path: string): RegExp {
  return new RegExp(`${path.replaceAll("/", "\\/")}$`);
}

test_.describe("M2.1-11(b): redirect notices after a full page load", () => {
  test_(
    "CLI-1: client card: the notice shows once; archiving and a reload do not bring it back",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({ name: `הודעה ${token}` });
      const path = `/clients/${clientId}`;

      await page.goto(`${path}?notice=updated`);

      await expect(notice(page, "השינויים נשמרו.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));
      await page.getByRole("button", { name: "העברה לארכיון" }).click();
      await expect(notice(page, "הלקוח הועבר לארכיון.")).toBeVisible();
      await expectNoNotice(page, "השינויים נשמרו.");
      await expect(page).toHaveURL(cleanUrl(path));
      await page.reload();
      await expect(page.getByRole("button", { name: "שחזור מהארכיון" })).toBeVisible();
      await expectNoNotice(page, "השינויים נשמרו.");
      await expect(page).toHaveURL(cleanUrl(path));
    },
  );

  test_(
    "PRJ-1: project card: the notice shows once; archiving and a reload do not bring it back",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `הודעה ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `הודעה ${token}` });
      const path = `/projects/${projectId}`;

      await page.goto(`${path}?notice=updated`);

      await expect(notice(page, "השינויים נשמרו.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));
      await page.getByRole("button", { name: "העברה לארכיון" }).click();
      await expect(notice(page, "הפרויקט הועבר לארכיון.")).toBeVisible();
      await expectNoNotice(page, "השינויים נשמרו.");
      await expect(page).toHaveURL(cleanUrl(path));
      await page.reload();
      await expect(page.getByRole("button", { name: "שחזור מהארכיון" })).toBeVisible();
      await expectNoNotice(page, "השינויים נשמרו.");
    },
  );

  test_(
    "MS-1: milestones: the notice shows once; a move and a reload do not bring it back",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const clientId = await seedClient({ name: `הודעה ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `הודעה ${token}` });
      for (const name of ["א", "ב"]) {
        await seedMilestone({
          project_id: projectId,
          description: `${name} ${token}`,
          amount: 1,
          due_date: "2099-01-01",
        });
      }
      const path = `/projects/${projectId}`;

      await page.goto(`${path}?notice=milestone_created`);

      await expect(notice(page, "אבן הדרך נשמרה.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));
      await page.getByRole("button", { name: `למטה: א ${token}` }).click();
      await expect(page.getByRole("region", { name: "אבני דרך" }).getByRole("status")).toHaveText(
        `"א ${token}" הועברה למקום 2 מתוך 2.`,
      );
      await expectNoNotice(page, "אבן הדרך נשמרה.");
      await expect(page).toHaveURL(cleanUrl(path));
      await page.reload();
      await expect(page.getByRole("button", { name: `למטה: ב ${token}` })).toBeVisible();
      await expectNoNotice(page, "אבן הדרך נשמרה.");
      await expect(page).toHaveURL(cleanUrl(path));
    },
  );
});

test_.describe("M2.1-11(b): redirect notices and Back", () => {
  test_(
    "CLI-1: after a full page load, Back from another screen does not show the notice again",
    async ({ page, token, seedClient }) => {
      const clientId = await seedClient({ name: `חזרה ${token}` });
      const path = `/clients/${clientId}`;
      await page.goto(`${path}?notice=updated`);
      await expect(notice(page, "השינויים נשמרו.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));

      await page
        .getByRole("navigation", { name: "ניווט ראשי" })
        .getByRole("link", { name: "פרויקטים" })
        .click();
      await expect(page).toHaveURL(/\/projects$/);
      await page.goBack();

      await expect(page).toHaveURL(cleanUrl(path));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`חזרה ${token}`);
      await expectNoNotice(page, "השינויים נשמרו.");
    },
  );

  test_(
    "PRJ-1: after a save (redirect), Back from the client card does not show the notice again",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `חזרה ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `חזרה ${token}` });
      const path = `/projects/${projectId}`;
      await page.goto(`${path}/edit`);
      await page.getByRole("button", { name: "שמירת שינויים" }).click();
      await expect(notice(page, "השינויים נשמרו.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));

      await page.getByRole("link", { name: `חזרה ${token}` }).click();
      await expect(page).toHaveURL(cleanUrl(`/clients/${clientId}`));
      await page.goBack();

      await expect(page).toHaveURL(cleanUrl(path));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`חזרה ${token}`);
      await expectNoNotice(page, "השינויים נשמרו.");
    },
  );

  test_(
    "MS-1: after saving a milestone, Back from the client card does not show the notice again",
    async ({ page, token, seedClient, seedProject }) => {
      const clientId = await seedClient({ name: `לקוח ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט ${token}` });
      const path = `/projects/${projectId}`;
      await page.goto(`${path}/milestones/new`);
      await page.getByRole("textbox", { name: /^תיאור/ }).fill(`חדשה ${token}`);
      await page.getByRole("textbox", { name: /^סכום/ }).fill("1");
      await page.getByLabel(/^תאריך יעד/).fill("2099-01-01");
      await page.getByRole("button", { name: "שמירת אבן דרך" }).click();
      await expect(notice(page, "אבן הדרך נשמרה.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));

      await page.getByRole("link", { name: `לקוח ${token}` }).click();
      await expect(page).toHaveURL(cleanUrl(`/clients/${clientId}`));
      await page.goBack();

      await expect(page).toHaveURL(cleanUrl(path));
      await expect(page.getByRole("button", { name: `למטה: חדשה ${token}` })).toBeVisible();
      await expectNoNotice(page, "אבן הדרך נשמרה.");
    },
  );

  test_(
    "MS-4: after recording a payment, Back from the client card does not show the notice again",
    async ({ page, token, seedClient, seedProject, seedMilestone }) => {
      const clientId = await seedClient({ name: `לקוח ${token}` });
      const projectId = await seedProject({ client_id: clientId, name: `פרויקט ${token}` });
      await seedMilestone({
        project_id: projectId,
        description: `מקדמה ${token}`,
        amount: 1000,
        due_date: "2099-01-01",
      });
      const path = `/projects/${projectId}`;
      await page.goto(path);
      await page.getByRole("link", { name: `רשום תשלום: מקדמה ${token}` }).click();
      await expect(page.getByRole("combobox", { name: /^לקוח/ })).toBeEnabled();
      await page.getByRole("combobox", { name: /^אמצעי תשלום/ }).selectOption({ label: "מזומן" });
      await page.getByRole("button", { name: "רישום התשלום" }).click();
      await expect(notice(page, "התשלום נרשם.")).toBeVisible();
      await expect(page).toHaveURL(cleanUrl(path));

      await page.getByRole("link", { name: `לקוח ${token}` }).click();
      await expect(page).toHaveURL(cleanUrl(`/clients/${clientId}`));
      await page.goBack();

      await expect(page).toHaveURL(cleanUrl(path));
      await expect(page.getByRole("link", { name: /^עריכה: תשלום מ-/ })).toBeVisible();
      await expectNoNotice(page, "התשלום נרשם.");
    },
  );
});
