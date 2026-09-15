import { WelcomeChoice } from "@/components/welcome-choice";
import { getI18n } from "@/lib/i18n/server";

export default async function WelcomePage() {
  const { t } = await getI18n();
  return (
    /* Two choices side by side once there is room for both, so neither reads
       as the default; a phone stacks them. */
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[28px]">{t.clientApp.welcome.title}</h1>
      <div className="mt-5 sm:mt-6">
        <WelcomeChoice />
      </div>
    </div>
  );
}
