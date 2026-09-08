import Link from "next/link";
import { Logo } from "@/components/logo";
import { LanguageSelector } from "@/components/language-selector";
import { LoginForm } from "@/components/login-form";

// Full-page sign-in. Kept as a real route on purpose: email confirmation and
// password-reset links, the Google OAuth round-trip and the middleware all
// need a URL to land on. The landing page opens the same form in a modal.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="fixed right-4 top-4 z-20">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <Logo size="md" />
        </Link>
        <LoginForm />
      </div>
    </main>
  );
}
