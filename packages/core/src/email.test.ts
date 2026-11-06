import { describe, expect, it } from "vitest";
import { button, inviteEmail, signInLinkEmail, signUpLinkEmail, welcomeEmail } from "./email";

const welcome = welcomeEmail({
  setupUrl: "https://app.example/onboarding",
  homeUrl: "https://app.example/",
  privacyUrl: "https://app.example/privacy",
  freeCvs: 3,
  canReply: true,
});
const invite = inviteEmail({ signInUrl: "https://app.example/login", homeUrl: "https://app.example/" });
const signIn = signInLinkEmail();
const signUp = signUpLinkEmail();

describe("account emails", () => {
  it("keep the dark-mode rules: only hex colours, no transparency, no white text", () => {
    for (const { html } of [welcome, invite, signIn, signUp]) {
      expect(html).not.toMatch(/rgba?\(|hsla?\(|transparent/i);
      expect(html).not.toMatch(/color:\s*(#fff\b|#ffffff\b|white\b)/i);
      expect(html).toContain("prefers-color-scheme: dark");
    }
  });

  it("welcome links to setup, counts the free CVs and invites replies only when they reach someone", () => {
    expect(welcome.html).toContain('href="https://app.example/onboarding"');
    expect(welcome.html).toContain("Your first 3 CVs are free.");
    expect(welcome.text).toContain("Finish setting up: https://app.example/onboarding");
    expect(welcome.text).toContain("Your CVs only say what's true.");
    const quiet = welcomeEmail({ setupUrl: "https://a/", homeUrl: "https://a/", privacyUrl: "https://a/p", freeCvs: 0, canReply: false });
    expect(quiet.html).not.toMatch(/free\.|reply to this/i);
    expect(welcomeEmail({ setupUrl: "https://a/", homeUrl: "https://a/", privacyUrl: "https://a/p", freeCvs: 1, canReply: false }).text).toContain("Your first CV is free.");
  });

  it("invite sends people to sign in", () => {
    expect(invite.html).toContain('href="https://app.example/login"');
    expect(invite.text).toContain("https://app.example/login");
  });

  it("sign-up and sign-in templates keep Supabase's tags intact", () => {
    for (const { html } of [signIn, signUp]) {
      expect(html).toContain('href="{{ .ConfirmationURL }}"');
      expect(html).toContain('href="{{ .SiteURL }}"');
      expect(html).not.toContain(".invalid");
    }
  });

  it("tells a first sign-up apart from a returning sign-in", () => {
    expect(signUp.subject).not.toBe(signIn.subject);
    expect(signUp.html).toContain("Welcome to CV Tailor.");
    expect(signIn.html).toContain("Welcome back.");
  });

  it("say nothing about any profession, work mode or country", () => {
    for (const { html } of [welcome, invite, signIn, signUp]) {
      for (const word of [/nigeria/i, /software/i, /\bremote\b/i, /engineer/i]) expect(html).not.toMatch(word);
    }
  });

  it("refuse links that aren't http, https or mailto", () => {
    expect(button("javascript:alert(1)", "x")).toContain('href="#"');
  });
});
