import { Redirect } from "expo-router";

// voinic://auth/callback — where Google / Apple send the person back
// (lib/oauth.ts). The browser tab hands the URL to openAuthSessionAsync; the
// router sees the same link, so it needs a screen, and this one just moves on:
// "/" is the tabs when the sign-in worked, sign-in again when it did not.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
