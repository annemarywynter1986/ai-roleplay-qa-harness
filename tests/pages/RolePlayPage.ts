import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export class RolePlayPage {
  readonly page: Page;
  readonly userSelect: Locator;
  readonly loginButton: Locator;
  readonly whoami: Locator;
  readonly personaSelect: Locator;
  readonly focusSelect: Locator;
  readonly startButton: Locator;
  readonly repInput: Locator;
  readonly sendButton: Locator;
  readonly endButton: Locator;
  readonly transcript: Locator;
  readonly score: Locator;
  readonly sessionId: Locator;
  readonly feedbackItems: Locator;
  readonly historyItems: Locator;
  readonly badgeLabel: Locator;
  readonly xp: Locator;

  constructor(page: Page) {
    this.page = page;
    const t = (id: string) => page.getByTestId(id);
    this.userSelect = t('login-user');
    this.loginButton = t('login-btn');
    this.whoami = t('whoami');
    this.personaSelect = t('persona-select');
    this.focusSelect = t('focus-select');
    this.startButton = t('start-btn');
    this.repInput = t('rep-input');
    this.sendButton = t('send-btn');
    this.endButton = t('end-btn');
    this.transcript = t('transcript');
    this.score = t('score');
    this.sessionId = t('session-id');
    this.feedbackItems = t('feedback-item');
    this.historyItems = t('history-item');
    this.badgeLabel = t('badge-label');
    this.xp = t('xp');
  }

  async goto() {
    await this.page.goto('/');
  }

  async login(username: string) {
    await this.userSelect.selectOption(username);
    await this.loginButton.click();
    await expect(this.whoami).toHaveText(username);
  }

  async startSession(personaId: string, focus: string) {
    await this.personaSelect.selectOption(personaId);
    await this.focusSelect.selectOption(focus);
    await this.startButton.click();
    await expect(this.repInput).toBeVisible();
  }

  async say(text: string) {
    const before = await this.transcript.locator('p').count();
    await this.repInput.fill(text);
    await this.sendButton.click();
    await expect(this.transcript.locator('p')).toHaveCount(before + 2);
  }

  lastDoctorReply() {
    return this.transcript.locator('p.hcp').last();
  }

  async endSession() {
    await this.endButton.click();
    await expect(this.score).toHaveText(/^\d+$/);
  }
}
